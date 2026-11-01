/**
 * The integration the whole design rests on: a `.md` inside the
 * configured globs becomes a Svelte component through the official plugin, and
 * nothing had to be registered in `svelte.config.js`.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svmd, type StandardSchemaV1, type SvmdOptions } from '@svmd/vite';
import { build, type Rollup } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

// Inside the repository rather than in the OS temp directory, so that Node
// resolves `svelte` by walking up to the workspace's node_modules.
const scratch = fileURLToPath(new URL('./.tmp/', import.meta.url));
mkdirSync(scratch, { recursive: true });
const root = mkdtempSync(join(scratch, 'app-'));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

write('svelte.config.js', 'export default {};\n');

write(
  'src/content/post.md',
  ['---', 'title: Hello', '---', '', '# {title}', '', 'Body with {1 + 1}.', ''].join('\n'),
);
write('src/other/ignored.md', '# not compiled\n');
write('src/content/_draft.md', '# excluded by glob\n');

async function bundle(entry: string, options: SvmdOptions): Promise<string> {
  const result = (await build({
    root,
    logLevel: 'silent',
    plugins: [svmd(options), svelte()],
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['es'], fileName: 'out' },
    },
  })) as Rollup.RolldownOutput[];

  return result[0]!.output.map((chunk) => ('code' in chunk ? chunk.code : '')).join('\n');
}

describe('vite plugin', () => {
  it('compiles a markdown file inside the include globs', async () => {
    write(
      'src/entry-a.js',
      "import Post, { metadata } from './content/post.md';\nexport { Post, metadata };\n",
    );

    const code = await bundle('src/entry-a.js', { include: ['src/content/**/*.md'] });

    expect(code).toContain('Hello');
    // The markup went through the Svelte compiler, not through a string.
    expect(code).toContain('<h1>');
    expect(code).not.toContain('# {title}');
  });

  it('honours exclude globs', async () => {
    write('src/entry-b.js', "import Draft from './content/_draft.md';\nexport { Draft };\n");

    await expect(
      bundle('src/entry-b.js', {
        include: ['src/content/**/*.md'],
        exclude: ['**/_*.md'],
      }),
    ).rejects.toThrow();
  });

  it('leaves markdown outside the globs alone', async () => {
    write('src/entry-c.js', "import Other from './other/ignored.md';\nexport { Other };\n");

    await expect(bundle('src/entry-c.js', { include: ['src/content/**/*.md'] })).rejects.toThrow();
  });

  it('reports a compile error with the markdown position', async () => {
    write('src/content/broken.md', 'intro\n\n{#if a}\n\nbody\n');
    write('src/entry-d.js', "import Broken from './content/broken.md';\nexport { Broken };\n");

    await expect(bundle('src/entry-d.js', { include: ['src/content/**/*.md'] })).rejects.toThrow(
      /E001[\s\S]*broken\.md:3:1/,
    );
  });
}, 60_000);

describe('metadata-only module', () => {
  write('src/content/lazy/one.md', '---\ntitle: One\n---\n\nBODY-ONE {title}\n');
  write('src/content/lazy/two.md', '---\ntitle: Two\n---\n\nBODY-TWO {title}\n');

  it('keeps every body out of an eager index of frontmatter', async () => {
    write(
      'src/entry-index.js',
      [
        "export const meta = import.meta.glob('./content/lazy/*.md', { eager: true, query: '?metadata', import: 'metadata' });",
        "export const body = import.meta.glob('./content/lazy/*.md');",
      ].join('\n'),
    );

    const { createLogger } = await import('vite');
    const logger = createLogger('silent');
    const warnings: string[] = [];
    logger.warn = (message) => void warnings.push(message);

    const result = (await build({
      root,
      customLogger: logger,
      plugins: [svmd({ include: ['src/content/**/*.md'] }), svelte()],
      build: {
        write: false,
        minify: false,
        lib: { entry: 'src/entry-index.js', formats: ['es'], fileName: 'index' },
      },
    })) as Rollup.RolldownOutput[];

    const chunks = result[0]!.output.filter((chunk) => chunk.type === 'chunk');
    const entry = chunks.find((chunk) => chunk.isEntry)!;

    expect(entry.code).toContain('One');
    expect(entry.code).toContain('Two');
    expect(entry.code).not.toContain('BODY-ONE');
    expect(entry.code).not.toContain('BODY-TWO');
    expect(chunks.filter((chunk) => /BODY-(ONE|TWO)/.test(chunk.code))).toHaveLength(2);
    expect(warnings.join('\n')).not.toContain('INEFFECTIVE_DYNAMIC_IMPORT');
  });

  it('exports the same metadata as the component, schema applied', async () => {
    const { createServer } = await import('vite');
    const schema: StandardSchemaV1<unknown, Record<string, unknown>> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) => ({ value: { ...(value as object), draft: false } }),
      },
    };
    const server = await createServer({
      root,
      logLevel: 'silent',
      server: { middlewareMode: true, hmr: false, watch: null },
      plugins: [svmd({ include: ['src/content/**/*.md'], frontmatter: { schema } }), svelte()],
    });

    try {
      const meta = await server.ssrLoadModule('/src/content/lazy/one.md?metadata');
      const full = await server.ssrLoadModule('/src/content/lazy/one.md');
      expect(Object.keys(meta)).toEqual(['metadata']);
      expect(meta.metadata).toEqual({ title: 'One', draft: false });
      expect(full.metadata).toEqual(meta.metadata);
    } finally {
      await server.close();
    }
  });
}, 60_000);

describe('Svelte warnings', () => {
  it('point at the markdown, not at the generated component', async () => {
    write(
      'src/content/warned.md',
      [
        '---',
        'title: T',
        '---',
        '',
        '# {title}',
        '',
        'Some text.',
        '',
        '<img src="/x.png">',
        '',
      ].join('\n'),
    );
    write('src/entry-warned.js', "import C from './content/warned.md';\nexport { C };\n");

    const seen: {
      code: string;
      filename: string | undefined;
      line: number | undefined;
      frame: string | undefined;
    }[] = [];
    await build({
      root,
      logLevel: 'silent',
      plugins: [
        svmd({ include: ['src/content/**/*.md'] }),
        svelte({
          onwarn: (warning) =>
            void seen.push({
              code: warning.code,
              filename: warning.filename,
              line: warning.start?.line,
              frame: warning.frame,
            }),
        }),
      ],
      build: {
        write: false,
        lib: { entry: 'src/entry-warned.js', formats: ['es'], fileName: 'warned' },
      },
    });

    const warning = seen.find((entry) => entry.code === 'a11y_missing_attribute');
    expect(warning?.filename).toMatch(/src\/content\/warned\.md$/);
    expect(warning?.line).toBe(9);
    expect(warning?.frame).toContain('<img src="/x.png">');
  });
}, 60_000);

describe('dependency scan', () => {
  it('discovers a package imported only from a markdown script', async () => {
    const { createServer } = await import('vite');

    write(
      'src/content/scanned.md',
      "<script>\n  import { visit } from 'unist-util-visit';\n</script>\n\n# {typeof visit}\n",
    );
    write('src/entry-scan.js', "import C from './content/scanned.md';\nexport { C };\n");

    const server = await createServer({
      root,
      logLevel: 'silent',
      cacheDir: join(root, '.vite-scan'),
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { entries: ['src/entry-scan.js'], force: true },
      plugins: [svmd({ include: ['src/content/**/*.md'] }), svelte()],
    });

    try {
      const optimizer = server.environments.client.depsOptimizer!;
      await optimizer.init();
      await optimizer.scanProcessing;

      expect(Object.keys(optimizer.metadata.optimized)).toContain('unist-util-visit');
    } finally {
      await server.close();
    }
  });
}, 60_000);

describe('dev server', () => {
  it('serves a compiled component and re-serves it after an edit', async () => {
    const { createServer } = await import('vite');

    write('src/content/live.md', '# one\n');
    write('src/entry-live.js', "import C from './content/live.md';\nexport { C };\n");

    const server = await createServer({
      root,
      logLevel: 'silent',
      server: { middlewareMode: true, hmr: false, watch: null },
      plugins: [svmd({ include: ['src/content/**/*.md'] }), svelte()],
    });

    try {
      const client = server.environments.client;
      const first = await client.transformRequest('/src/content/live.md');
      expect(first?.code).toContain('one');

      const file = join(root, 'src/content/live.md');
      const id = file + '.svmd.svelte';

      // The module graph knows the shadow id, so the watcher path has to be
      // bridged; this is what the `hotUpdate` hook does.
      expect(client.moduleGraph.getModulesByFile(id)?.size).toBe(1);
      expect(client.moduleGraph.getModulesByFile(file)).toBeUndefined();

      write('src/content/live.md', '# two\n');
      const module = [...client.moduleGraph.getModulesByFile(id)!][0]!;
      client.moduleGraph.invalidateModule(module);

      const second = await client.transformRequest('/src/content/live.md');
      expect(second?.code).toContain('two');
      expect(second?.code).not.toContain('>one<');
    } finally {
      await server.close();
    }
  });

  it('maps a watched markdown file onto its shadow module', async () => {
    const { createServer } = await import('vite');

    write('src/content/watched.md', '# a\n');
    write('src/entry-watch.js', "import C from './content/watched.md';\nexport { C };\n");

    const plugin = svmd({ include: ['src/content/**/*.md'] });
    const server = await createServer({
      root,
      logLevel: 'silent',
      server: { middlewareMode: true, hmr: false, watch: null },
      plugins: [plugin, svelte()],
    });

    try {
      const client = server.environments.client;
      await client.transformRequest('/src/content/watched.md');

      const file = join(root, 'src/content/watched.md');
      const hotUpdate = plugin.hotUpdate as unknown as (
        this: { environment: typeof client },
        context: { file: string; modules: unknown[] },
      ) => unknown[] | undefined;

      const result = hotUpdate.call({ environment: client }, { file, modules: [] });
      expect(result).toHaveLength(1);
      expect((result![0] as { id: string }).id).toBe(file + '.svmd.svelte');

      // A file outside the globs is left to other plugins.
      expect(
        hotUpdate.call(
          { environment: client },
          { file: join(root, 'src/other/ignored.md'), modules: [] },
        ),
      ).toBeUndefined();
    } finally {
      await server.close();
    }
  });
}, 60_000);

describe('include patterns', () => {
  it('follows the extension named in the globs, not a hard-coded one', async () => {
    write('src/content/legacy.svx', '---\ntitle: Legacy\n---\n\n# {title}\n');
    write('src/entry-svx.js', "import C from './content/legacy.svx';\nexport { C };\n");

    const code = await bundle('src/entry-svx.js', { include: ['src/content/**/*.svx'] });
    expect(code).toContain('Legacy');
    expect(code).toContain('<h1>');
  });

  it('accepts several extensions at once', async () => {
    write(
      'src/entry-both.js',
      [
        "import A from './content/post.md';",
        "import B from './content/legacy.svx';",
        'export { A, B };',
      ].join('\n'),
    );

    const code = await bundle('src/entry-both.js', {
      include: ['src/content/**/*.md', 'src/content/**/*.svx'],
      exclude: ['**/_*.md', '**/broken.md'],
    });
    expect(code).toContain('Legacy');
    expect(code).toContain('Hello');
  });
}, 60_000);

describe('resolveId', () => {
  const plugin = svmd({ include: ['src/content/**/*.md'] });

  type ResolveId = (
    this: unknown,
    source: string,
    importer: string | undefined,
    options: Record<string, unknown>,
  ) => Promise<unknown>;

  const context = {
    resolve: (source: string) => Promise.resolve({ id: join(root, source), external: false }),
  };

  function resolve(
    source: string,
    options: Record<string, unknown> = {},
    plugins: unknown[] = [],
  ): Promise<unknown> {
    (
      plugin.configResolved as unknown as (config: { root: string; plugins: unknown[] }) => void
    ).call(plugin, { root, plugins });
    const hook = plugin.resolveId as unknown as { handler: ResolveId };
    return hook.handler.call(context, source, undefined, options);
  }

  it("compiles the route files of an extension in SvelteKit's `extensions`", async () => {
    const kit = {
      name: 'vite-plugin-sveltekit-setup',
      api: { options: { extensions: ['.svelte', '.md'], files: { src: 'src', routes: null } } },
    };

    const route = (await resolve('src/routes/notes/+page.md', {}, [kit])) as { id: string };
    expect(route.id).toBe(join(root, 'src/routes/notes/+page.md.svmd.svelte'));

    // Only route files: any other markdown under src/routes stays outside the globs.
    const other = (await resolve('src/routes/notes/readme.md', {}, [kit])) as { id: string };
    expect(other.id).toBe(join(root, 'src/routes/notes/readme.md'));

    // Without `.md` in SvelteKit's extensions, nothing under src/routes is compiled.
    const outside = (await resolve('src/routes/notes/+page.md')) as { id: string };
    expect(outside.id).toBe(join(root, 'src/routes/notes/+page.md'));
  });

  it('asks Rolldown to call it only for ids it can own', () => {
    const filter = (plugin.resolveId as unknown as { filter: { id: RegExp[] } }).filter.id;
    const matches = (id: string) => filter.some((pattern) => pattern.test(id));

    expect(matches('./post.md')).toBe(true);
    expect(matches('/src/post.MD?metadata')).toBe(true);
    expect(matches('/abs/post.md.svmd.svelte')).toBe(true);
    expect(matches('/abs/post.md.svmd-metadata.js')).toBe(true);
    expect(matches('./app.ts')).toBe(false);
    expect(matches('./Card.svelte')).toBe(false);
    expect(matches('./notes.mdx')).toBe(false);
  });

  /**
   * The scanner reads any id ending in `.svelte` straight off disk, and the
   * shadow id is not a file. Regression guard for the ENOENT that only ever
   * showed up through a static `import Post from './x.md'`.
   */
  it('does not add the shadow suffix while Vite is scanning dependencies', async () => {
    const scanned = await resolve('src/content/post.md', { scan: true });
    expect((scanned as { id: string }).id).not.toContain('.svmd.svelte');

    const built = await resolve('src/content/post.md', {});
    expect((built as { id: string }).id).toContain('.svmd.svelte');
  });

  it('hands an already-suffixed id back, except while scanning', async () => {
    const id = join(root, 'src/content/post.md.svmd.svelte');
    expect(await resolve(id, {})).toBe(id);
    expect(await resolve(id, { scan: true })).toBeNull();
  });

  /** `?raw` and friends mean "the file itself", so compiling it would be wrong. */
  it('leaves passthrough queries to Vite', async () => {
    for (const query of ['?raw', '?url', '?inline', '?worker']) {
      // `null` is the passthrough: the id is left for Vite's own handling.
      expect(await resolve('src/content/post.md' + query, {})).toBeNull();
    }
  });
}, 60_000);

describe('build manifest', () => {
  /**
   * SvelteKit resolves a route to its chunk by looking the real file path up
   * in the manifest it reads off disk, so a `.md` that *is* a route file
   * (`+page.md`) needs its un-suffixed key present or the adapter build dies
   * on `Could not find file ... in Vite manifest` — in the build only, never
   * in dev, where nothing reconciles the two.
   */
  it('keys a compiled file under its real path as well as the shadow id', async () => {
    write('src/routes/notes/+page.md', '---\ntitle: Notes\n---\n\n# {title}\n');

    const result = await build({
      root,
      logLevel: 'silent',
      plugins: [svmd({ include: ['src/routes/**/+page.md'] }), svelte()],
      build: {
        write: false,
        minify: false,
        manifest: true,
        ssr: true,
        rollupOptions: { input: { page: join(root, 'src/routes/notes/+page.md') } },
      },
    });

    const output = (Array.isArray(result) ? result[0]! : (result as Rollup.RolldownOutput)).output;
    const asset = output.find((chunk) => chunk.type === 'asset');
    const manifest = JSON.parse((asset as { source: string }).source) as Record<
      string,
      { file: string }
    >;

    const shadow = 'src/routes/notes/+page.md.svmd.svelte';
    expect(manifest[shadow]).toBeDefined();
    expect(manifest['src/routes/notes/+page.md']).toEqual(manifest[shadow]);
  });
}, 60_000);
