import { readFile } from 'node:fs/promises';
import { createCompiler, SvmdError, type CompileOptions, type EncodedSourceMap } from '@svmd/core';
import {
  createFilter,
  type EnvironmentModuleNode,
  type Plugin,
  type ResolvedConfig,
  type Rolldown,
} from 'vite';
import { kitRouteGlobs } from './kit.js';
import { remapSvelteWarnings } from './warnings.js';

export type { CompileOptions, SvmdError };
export type {
  Heading,
  Highlighter,
  HighlightInput,
  StandardSchemaV1,
  SvmdWarning,
} from '@svmd/core';

export interface SvmdOptions extends Omit<CompileOptions, 'filename'> {
  /**
   * Files to compile, as globs resolved against the Vite root. A `.md` outside
   * them stays an ordinary asset. Under SvelteKit, route files (`+page.md`) of an
   * extension in its `extensions` are added automatically.
   *
   * @default ['**\/*.md']
   */
  include?: string | RegExp | readonly (string | RegExp)[] | undefined;

  /** @default ['**\/node_modules\/**'] */
  exclude?: string | RegExp | readonly (string | RegExp)[] | undefined;
}

/**
 * Marks the module as Svelte for `@sveltejs/vite-plugin-svelte`, whose one
 * contract stable across versions is "compile what ends in `.svelte`".
 */
const SUFFIX = '.svmd.svelte';

/**
 * The metadata-only module behind `post.md?metadata`: plain JavaScript, so an
 * eager index of every file never imports a component, and the lazy body glob
 * keeps its own chunk.
 */
const METADATA_QUERY = 'metadata';
const METADATA_SUFFIX = '.svmd-metadata.js';

/** Ids this plugin owns once it has resolved them. */
const OWN_ID = /\.svmd(?:\.svelte|-metadata\.js)(?:[?#]|$)/;

/** Matches an id ending in one of the include extensions, query allowed. */
function extensionPattern(extensions: Set<string>): RegExp {
  const names = [...extensions].map((extension) => extension.slice(1)).join('|');
  return new RegExp(`\\.(?:${names})(?:[?#]|$)`, 'i');
}

/** The same, followed by the extension Vite appends to such a module's URL (see `withoutAppendedExtension`). */
function appendedExtensionPattern(extensions: Set<string>): RegExp {
  const names = [...extensions].map((extension) => extension.slice(1)).join('|');
  return new RegExp(`\\.(?:${names})\\.(?:svelte|js)(?:[?#]|$)`, 'i');
}

/** Queries whose meaning is "give me the file itself, do not compile it". */
const PASSTHROUGH_QUERIES = new Set(['raw', 'url', 'inline', 'worker', 'sharedworker']);

/**
 * The file extensions the include globs can match, so `include: ['**\/*.svx']`
 * compiles `.svx`. `null` when a pattern does not end in a plain extension; then
 * every import is resolved and the filter decides.
 */
function extensionsOf(patterns: readonly (string | RegExp)[]): Set<string> | null {
  const extensions = new Set<string>();

  for (const pattern of patterns) {
    if (typeof pattern !== 'string') return null;
    const match = /\.([A-Za-z0-9]+)$/.exec(pattern);
    if (!match) return null;
    extensions.add(`.${(match[1] ?? '').toLowerCase()}`);
  }

  return extensions.size > 0 ? extensions : null;
}

function hasKnownExtension(path: string, extensions: Set<string> | null): boolean {
  if (!extensions) return true;
  const dot = path.lastIndexOf('.');
  return dot !== -1 && extensions.has(path.slice(dot).toLowerCase());
}

interface SplitId {
  path: string;
  query: string;
}

function splitId(id: string): SplitId {
  const index = id.search(/[?#]/);
  return index === -1
    ? { path: id, query: '' }
    : { path: id.slice(0, index), query: id.slice(index) };
}

function queryKeys(query: string): string[] {
  return query === '' ? [] : [...new URLSearchParams(query.slice(1)).keys()];
}

function isPassthrough(query: string): boolean {
  return queryKeys(query).some((key) => PASSTHROUGH_QUERIES.has(key));
}

function isMetadataQuery(query: string): boolean {
  return queryKeys(query).includes(METADATA_QUERY);
}

/**
 * Requested by its `.md` path, a module gets the extension of its resolved id
 * appended to its URL (`/post.md` becomes `/post.md.svelte`, `/post.md?metadata`
 * becomes `/post.md.js?metadata`), and SvelteKit requests route files that way.
 * Returns the path without it, so that URL resolves again; `null` when there is none.
 */
function withoutAppendedExtension(
  path: string,
  query: string,
  extensions: Set<string> | null,
): string | null {
  const appended = isMetadataQuery(query) ? '.js' : '.svelte';
  if (!path.endsWith(appended)) return null;

  const base = path.slice(0, -appended.length);
  if (base.lastIndexOf('.') <= base.lastIndexOf('/')) return null;
  return hasKnownExtension(base, extensions) ? base : null;
}

/** Markdown compiled to Svelte components, scoped by glob. */
export function svmd(options: SvmdOptions = {}): Plugin {
  const { include = ['**/*.md'], exclude = ['**/node_modules/**'], ...compileOptions } = options;
  // One compiler for the life of the plugin: building the pipeline instantiates every plugin.
  const compiler = createCompiler(compileOptions satisfies CompileOptions);

  // Built in `configResolved`, so globs resolve against the Vite root and not the working directory.
  let filter: (id: string) => boolean = () => false;
  /** The last source map of each compiled file, for remapping Svelte's warnings. */
  const maps = new Map<string, EncodedSourceMap>();
  /** The last `?metadata` module served for each file, to tell a frontmatter edit from a body edit. */
  const metadataCodes = new Map<string, string>();
  const patterns: readonly (string | RegExp)[] =
    typeof include === 'string' || include instanceof RegExp ? [include] : include;
  const extensions = extensionsOf(patterns);

  /**
   * Turns a markdown file into the imports of its `<script>` blocks for Vite's
   * dependency scanner, so a package only markdown imports is optimized up
   * front instead of forcing a reload on first visit.
   */
  function scanPlugin(scanned: Set<string>): Rolldown.Plugin {
    return {
      name: 'svmd:dep-scan',
      load: {
        filter: { id: extensionPattern(scanned) },
        async handler(path) {
          if (!filter(path)) return { code: '', moduleType: 'js' };

          let specifiers: string[];
          try {
            specifiers = compiler.imports(await readFile(path, 'utf8'), path);
          } catch {
            // The scan only looks for imports; a broken file fails loudly where it is compiled.
            specifiers = [];
          }

          return {
            code: specifiers.map((specifier) => `import ${JSON.stringify(specifier)};`).join('\n'),
            moduleType: 'js',
          };
        },
      },
    };
  }

  async function metadataChanged(filename: string): Promise<boolean> {
    try {
      const { code } = await compiler.compileMetadata(await readFile(filename, 'utf8'), filename);
      return code !== metadataCodes.get(filename);
    } catch {
      // Invalid frontmatter: reload, so the error reaches the page from `load`.
      return true;
    }
  }

  return {
    name: 'svmd',
    enforce: 'pre',

    config() {
      // Vite 8 only: older majors scan with esbuild, and there a dependency
      // imported only from markdown is still discovered on first request.
      // Vite 6 calls this hook without a context, hence the optional `this`.
      const context = this as { meta?: { rolldownVersion?: string } } | undefined;
      if (!extensions || !context?.meta?.rolldownVersion) return;

      return {
        optimizeDeps: {
          extensions: [...extensions],
          rolldownOptions: { plugins: [scanPlugin(extensions)] },
        },
      };
    },

    configResolved(config: ResolvedConfig) {
      filter = createFilter([...patterns, ...kitRouteGlobs(config, extensions)], exclude, {
        resolve: config.root,
      });
      remapSvelteWarnings(config, SUFFIX, maps);
    },

    // Filters keep Rolldown from calling into JavaScript for every module of
    // the app; the handlers still check, for Vite versions that ignore them.
    resolveId: {
      ...(extensions
        ? {
            filter: {
              id: [extensionPattern(extensions), appendedExtensionPattern(extensions), OWN_ID],
            },
          }
        : {}),
      async handler(source, importer, resolveOptions) {
        // While Vite scans for dependencies (`scan` is set but not in the public
        // type), the real `.md` path goes back: the scanner would read a
        // `.svelte`-suffixed id straight off disk and fail with ENOENT. The scan
        // plugin from `config` below reads the file's imports instead.
        const scanning = (resolveOptions as { scan?: boolean }).scan === true;

        const split = splitId(source);

        // An id this plugin made, absolute or as the root-relative URL the
        // browser re-imports it by (`/src/post.md.svmd.svelte?t=…` on HMR).
        const suffix = [SUFFIX, METADATA_SUFFIX].find((own) => split.path.endsWith(own));
        if (suffix) {
          if (scanning) return null;
          const markdown = await this.resolve(split.path.slice(0, -suffix.length), importer, {
            ...resolveOptions,
            skipSelf: true,
          });
          if (!markdown || markdown.external) return null;
          return { ...markdown, id: splitId(markdown.id).path + suffix + split.query };
        }

        const { query } = split;
        const unappended = withoutAppendedExtension(split.path, query, extensions);
        const path = unappended ?? split.path;
        if (!hasKnownExtension(path, extensions) || isPassthrough(query)) return null;

        const resolved = await this.resolve(path + query, importer, {
          ...resolveOptions,
          skipSelf: true,
        });
        if (!resolved || resolved.external) return unappended ? null : resolved;

        const target = splitId(resolved.id);
        // A real `post.md.svelte` file is not ours to resolve.
        if (!filter(target.path)) return unappended ? null : resolved;
        if (scanning) return resolved;

        if (isMetadataQuery(target.query)) {
          return { ...resolved, id: target.path + METADATA_SUFFIX };
        }

        return { ...resolved, id: target.path + SUFFIX + target.query };
      },
    },

    load: {
      filter: { id: OWN_ID },
      async handler(id) {
        const { path } = splitId(id);

        if (path.endsWith(METADATA_SUFFIX)) {
          const filename = path.slice(0, -METADATA_SUFFIX.length);
          this.addWatchFile(filename);
          try {
            const result = await compiler.compileMetadata(
              await readFile(filename, 'utf8'),
              filename,
            );
            metadataCodes.set(filename, result.code);
            return { code: result.code, map: null };
          } catch (error) {
            throw toRollupError(error);
          }
        }

        if (!path.endsWith(SUFFIX)) return null;

        const filename = path.slice(0, -SUFFIX.length);
        this.addWatchFile(filename);

        const source = await readFile(filename, 'utf8');

        try {
          const result = await compiler.compile(source, filename);

          for (const warning of result.warnings) {
            this.warn({
              message: `[${warning.code}] ${warning.message}\n\n${warning.frame ?? ''}\n\n  ${warning.hint}`,
              ...(warning.start
                ? {
                    loc: { file: filename, line: warning.start.line, column: warning.start.column },
                  }
                : {}),
            });
          }

          maps.set(filename, result.map);
          return { code: result.code, map: result.map };
        } catch (error) {
          throw toRollupError(error);
        }
      },
    },

    /**
     * SvelteKit finds a `+page.md` route's chunk by its real path in Vite's
     * manifest, which is keyed by the suffixed id; without the extra key the
     * adapter build fails with `Could not find file … in Vite manifest`.
     * `order: 'post'` runs after Vite's manifest plugin emitted the asset.
     */
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        for (const [fileName, asset] of Object.entries(bundle)) {
          if (!fileName.endsWith('.vite/manifest.json') || asset.type !== 'asset') continue;

          const source = typeof asset.source === 'string' ? asset.source : null;
          if (!source) continue;

          const manifest = JSON.parse(source) as Record<string, unknown>;
          let patched = false;

          for (const key of Object.keys(manifest)) {
            if (!key.endsWith(SUFFIX)) continue;
            const original = key.slice(0, -SUFFIX.length);
            if (original in manifest) continue;
            manifest[original] = manifest[key];
            patched = true;
          }

          if (patched) asset.source = JSON.stringify(manifest, null, 2);
        }
      },
    },

    /**
     * The watcher fires for `post.md`, but the module graph knows the suffixed
     * ids; invalidate them and hand them to vite-plugin-svelte, which does the
     * Svelte HMR after this.
     * The `?metadata` module has no HMR boundary, so it is updated, reloading
     * the page, only when the frontmatter itself changed.
     */
    async hotUpdate(context) {
      const { file, modules } = context;
      if (!filter(file)) return;

      const { moduleGraph } = this.environment;
      const shadows = [...(moduleGraph.getModulesByFile(file + SUFFIX) ?? [])];

      const metadataModules = moduleGraph.getModulesByFile(file + METADATA_SUFFIX);
      if (metadataModules?.size && (await metadataChanged(file))) {
        shadows.push(...metadataModules);
      }

      if (shadows.length === 0) return;

      // Vite invalidated only the modules keyed by `post.md`. Without this,
      // vite-plugin-svelte re-reads the cached result, finds it unchanged and
      // skips the update, and the page falls back to a full reload.
      const seen = new Set<EnvironmentModuleNode>();
      for (const shadow of shadows) {
        moduleGraph.invalidateModule(shadow, seen, context.timestamp, true);
      }

      return [...modules, ...shadows];
    },
  };
}

/** Give Rollup the position information it already knows how to print. */
function toRollupError(error: unknown): unknown {
  if (!(error instanceof SvmdError)) return error;

  return Object.assign(error, {
    plugin: 'svmd',
    id: error.filename,
    ...(error.loc ? { loc: error.loc } : {}),
    ...(error.frame ? { frame: error.frame } : {}),
  });
}

export default svmd;
