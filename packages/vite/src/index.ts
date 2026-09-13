import { readFile } from 'node:fs/promises';
import { createCompiler, SvmdError, type CompileOptions } from '@svmd/core';
import { createFilter, type Plugin, type ResolvedConfig } from 'vite';

export type { CompileOptions, SvmdError };
export type { Highlighter, HighlightInput, StandardSchemaV1, SvmdWarning } from '@svmd/core';

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

function isPassthrough(query: string): boolean {
  if (query === '') return false;
  const params = new URLSearchParams(query.slice(1));
  for (const key of params.keys()) {
    if (PASSTHROUGH_QUERIES.has(key)) return true;
  }
  return false;
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
  const patterns = Array.isArray(include) ? include : [include as string | RegExp];
  const extensions = extensionsOf(patterns);

  return {
    name: 'svmd',
    enforce: 'pre',

    configResolved(config: ResolvedConfig) {
      filter = createFilter(include, exclude, {
        resolve: config.root,
      });
    },

    async resolveId(source, importer, resolveOptions) {
      // Vite's dependency scanner treats any resolved id ending in `.svelte` (or
      // `.html`, `.vue`, `.astro`, `.imba`) as a real file and reads it straight
      // off disk to pull out its `<script>` block for the deps it imports —
      // that's `htmlTypesRE` in Vite's own scanner, matched against the id
      // string alone, running in place of this plugin's `load` below. The
      // shadow id is not a real file, so that read always throws `ENOENT`, on
      // every markdown file imported from a `<script>` — statically, the way
      // `svmd/content` never does, but a plain `import Post from './x.md'` does.
      //
      // `this.environment.mode` is *not* the way to detect this: the scanner
      // runs its own bundled mini-plugins in a dedicated `scan` environment,
      // but it calls out to registered plugins like this one through the real
      // dev/build environment, so `this.environment.mode` there still reads
      // `'dev'` — confirmed by logging it live against this exact repro. The
      // reliable signal is `resolveOptions.scan`: not in Vite's public
      // `ResolveIdOptions` type, but a real field on the object every
      // `resolveId` call carries while scanning, and the documented way
      // framework plugins are known to detect this phase in practice.
      //
      // Returning `{ external: true }` here is not enough: Vite's own
      // scan-only resolver (`vite:dep-scan:resolve`) calls out to this hook,
      // but then collapses whatever it returns to a bare id string before
      // deciding — on its own, from that id's extension alone — whether the
      // import is worth following further. A `.svelte`-suffixed id reads as
      // "yes" regardless of `external`, straight into the same disk read.
      // Not adding the suffix in the first place is what actually works: the
      // real `.md` path that comes back doesn't match any extension the
      // scanner treats specially, so *its* check is the one that stops here.
      // A dependency reachable only through one markdown file's own
      // `<script>` gets pre-bundled on first request rather than eagerly —
      // the one cost, and it is invisible past a single extra reload in dev.
      const scanning = (resolveOptions as { scan?: boolean }).scan === true;

      if (source.endsWith(SUFFIX)) {
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

      return { ...resolved, id: target.path + SUFFIX + target.query };
    },

    async load(id) {
      const { path } = splitId(id);
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
              ? { loc: { file: filename, line: warning.start.line, column: warning.start.column } }
              : {}),
          });
        }

        return { code: result.code, map: result.map };
      } catch (error) {
        throw toRollupError(error);
      }
    },

    /**
     * The watcher fires for `post.md`, but the module graph knows
     * `post.md.svmd.svelte`. Reconnect the two so `vite-plugin-svelte` — which
     * runs after this hook and does the real Svelte HMR — sees the module.
     */
    hotUpdate(context) {
      const { file, modules } = context;
      if (!filter(file)) return;

      const shadow = this.environment.moduleGraph.getModulesByFile(file + SUFFIX);
      if (!shadow || shadow.size === 0) return;

      return [...modules, ...shadow];
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
