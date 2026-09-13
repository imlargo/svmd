/**
 * The integration the whole design rests on (D1, D3, I10): a `.md` inside the
 * configured globs becomes a Svelte component through the official plugin, and
 * nothing had to be registered in `svelte.config.js`.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svmd, type SvmdOptions } from '@svmd/vite';
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
      // bridged; this is what the `hotUpdate` hook does (§I10).
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
