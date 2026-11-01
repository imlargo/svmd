import { readFile } from 'node:fs/promises';
import { createCompiler, SvmdError, type CompileOptions, type EncodedSourceMap } from '@svmd/core';
import { createFilter, type Plugin, type ResolvedConfig, type Rolldown } from 'vite';
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
   * Files to compile. Globs are resolved against the Vite root.
   *
   * This is the whole point of the plugin: scoping happens here, never through
   * `extensions` in `svelte.config.js`, so a `.md` outside these globs stays an
   * ordinary asset and a `.md` inside `src/routes` never accidentally becomes a
   * page (D3).
   *
   * @default ['**\/*.md']
   */
  include?: string | RegExp | readonly (string | RegExp)[] | undefined;

  /** @default ['**\/node_modules\/**'] */
  exclude?: string | RegExp | readonly (string | RegExp)[] | undefined;
}

/**
 * Marks the module as Svelte for `@sveltejs/vite-plugin-svelte`.
 *
 * That plugin's one stable contract across versions is "compile what ends in
 * `.svelte`", so the module id — not the file on disk — carries the extension.
 * Source maps still point at the `.md`, and `hotUpdate` below reconnects the
 * watcher to the shadow id (§I10).
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

/** Queries whose meaning is "give me the file itself, do not compile it". */
const PASSTHROUGH_QUERIES = new Set(['raw', 'url', 'inline', 'worker', 'sharedworker']);

/**
 * The file extensions the include globs can possibly match.
 *
 * `resolveId` runs for every import in the project, so it needs a cheap way to
 * skip the ones that obviously are not markdown before paying for
 * `this.resolve`. Deriving the set from the globs — rather than hard-coding
 * `.md` — is what makes `include: ['**\/*.svx']` actually work.
 *
 * Returns `null` when the patterns do not all end in a plain extension, in
 * which case every import is resolved and the filter decides.
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

/** Markdown compiled to Svelte components, scoped by glob. */
export function svmd(options: SvmdOptions = {}): Plugin {
  const { include = ['**/*.md'], exclude = ['**/node_modules/**'], ...compileOptions } = options;
  // One compiler for the life of the plugin: building a unified pipeline
  // instantiates every plugin, and a dev server compiles the same options
  // thousands of times.
  const compiler = createCompiler(compileOptions satisfies CompileOptions);

  /**
   * Built in `configResolved` rather than here so that globs resolve against
   * the Vite root, the way every other plugin's `include` behaves. Resolving
   * them against `process.cwd()` silently matches nothing whenever the root
   * and the working directory differ — as they do under SvelteKit's `vite
   * build` from a subdirectory, and in monorepos.
   */
  let filter: (id: string) => boolean = () => false;
  /** The last source map of each compiled file, for remapping Svelte's warnings. */
  const maps = new Map<string, EncodedSourceMap>();
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

  return {
    name: 'svmd',
    enforce: 'pre',

    config() {
      // Vite 8 only: older majors scan with esbuild, and there a dependency
      // imported only from markdown is still discovered on first request.
      const meta = this.meta as { rolldownVersion?: string };
      if (!extensions || !meta.rolldownVersion) return;

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
      ...(extensions ? { filter: { id: [extensionPattern(extensions), OWN_ID] } } : {}),
      async handler(source, importer, resolveOptions) {
        // While Vite scans for dependencies (`scan` is set but not in the public
        // type), the real `.md` path goes back: the scanner would read a
        // `.svelte`-suffixed id straight off disk and fail with ENOENT. The scan
        // plugin from `config` below reads the file's imports instead.
        const scanning = (resolveOptions as { scan?: boolean }).scan === true;

        if (source.endsWith(SUFFIX) || source.endsWith(METADATA_SUFFIX)) {
          return scanning ? null : source;
        }

        const { path, query } = splitId(source);
        if (!hasKnownExtension(path, extensions) || isPassthrough(query)) return null;

        const resolved = await this.resolve(source, importer, {
          ...resolveOptions,
          skipSelf: true,
        });
        if (!resolved || resolved.external) return resolved;

        const target = splitId(resolved.id);
        if (!filter(target.path) || scanning) return resolved;

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
     * Re-key the build manifest so a `.md` that *is* a route file survives.
     *
     * SvelteKit walks the filesystem for routes, so a `+page.md` (with `.md`
     * in its `extensions`) enters its route table under that real path. After
     * the build it resolves each route to a chunk by looking that same path up
     * in Vite's manifest, read off disk — `out/server/.vite/manifest.json`.
     * The manifest is keyed by module id, and this plugin's ids carry the
     * shadow suffix, so the lookup misses and the build dies on
     * `Could not find file "src/routes/x/+page.md" in Vite manifest`: in the
     * adapter build only, never in dev, where nothing reconciles the two.
     *
     * Adding the un-suffixed key alongside the real one costs a few bytes and
     * makes the lookup land. `order: 'post'` so Vite's own manifest plugin has
     * already emitted the asset by the time this runs.
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
     * The watcher fires for `post.md`, but the module graph knows
     * `post.md.svmd.svelte`. Reconnect the two so `vite-plugin-svelte` — which
     * runs after this hook and does the real Svelte HMR — sees the module.
     */
    hotUpdate(context) {
      const { file, modules } = context;
      if (!filter(file)) return;

      const { moduleGraph } = this.environment;
      const shadows = [
        ...(moduleGraph.getModulesByFile(file + SUFFIX) ?? []),
        ...(moduleGraph.getModulesByFile(file + METADATA_SUFFIX) ?? []),
      ];
      if (shadows.length === 0) return;

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
