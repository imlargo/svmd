/**
 * Build a project that consumes the packed tarballs, the way a user would.
 *
 * The workspace hides a class of mistakes that only shows up once a package is
 * published: an `exports` map that does not resolve, a `files` list missing
 * something, a dependency that was only ever satisfied by a sibling. This
 * installs what would go to the registry into a directory that knows nothing
 * about the repository, and builds.
 *
 * Usage: node scripts/consumer-check.mjs <pack-dir> <vite-major> <plugin-major>
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [packDir, vite = '8', sveltePlugin = '7'] = process.argv.slice(2);

if (!packDir) {
  console.error('usage: consumer-check.mjs <pack-dir> [vite-major] [plugin-major]');
  process.exit(1);
}

const root = mkdtempSync(join(tmpdir(), 'svmd-consumer-'));
const run = (command, args) =>
  execFileSync(command, args, { cwd: root, stdio: 'pipe', encoding: 'utf8' });

try {
  mkdirSync(join(root, 'src/content'), { recursive: true });

  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'consumer', private: true, type: 'module' }, null, 2),
  );
  writeFileSync(join(root, 'svelte.config.js'), 'export default {};\n');
  writeFileSync(
    join(root, 'vite.config.js'),
    [
      "import { svelte } from '@sveltejs/vite-plugin-svelte';",
      "import { svmd } from '@svmd/vite';",
      '',
      'export default {',
      "  plugins: [svmd({ include: ['src/content/**/*.md'], rawComponents: ['Code'] }), svelte()],",
      "  build: { lib: { entry: 'src/main.js', formats: ['es'], fileName: 'out' }, minify: false },",
      "  logLevel: 'error'",
      '};',
      '',
    ].join('\n'),
  );

  // Exercises frontmatter, a typed script, an expression, escaping, a control
  // block, a component holding markdown, and one holding its own content.
  writeFileSync(
    join(root, 'src/content/post.md'),
    [
      '---',
      'title: Consumer',
      '---',
      '',
      '<script lang="ts">',
      '  let n: number = $state(1);',
      '</script>',
      '',
      '# {title}',
      '',
      'Prose with {n} and a literal {#if}.',
      '',
      '<Callout>',
      '',
      '**markdown** inside',
      '',
      '</Callout>',
      '',
      '<Code>',
      '**literal** inside',
      '</Code>',
      '',
      '{#if n > 0}',
      '',
      '- item {n}',
      '',
      '{/if}',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'src/main.js'),
    "import Post, { metadata } from './content/post.md';\nexport { Post, metadata };\n",
  );

  const tarballs = execFileSync('ls', [packDir], { encoding: 'utf8' })
    .split('\n')
    .filter((name) => name.endsWith('.tgz'))
    .map((name) => join(packDir, name));

  run('npm', [
    'install',
    '--silent',
    ...tarballs,
    `vite@^${vite}`,
    `@sveltejs/vite-plugin-svelte@^${sveltePlugin}`,
    'svelte@^5',
  ]);

  const resolved = (name) =>
    JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version;

  run('npx', ['vite', 'build']);

  const out = readFileSync(join(root, 'dist/out.js'), 'utf8');
  const checks = [
    ['the heading compiled', out.includes('<h1>')],
    ['frontmatter reached the template', out.includes('Consumer')],
    ['markdown parsed inside a component', out.includes('<strong>')],
    ['a raw component kept its content', out.includes('**literal** inside')],
    // Svelte decodes the `&#123;` on its way in, so what proves the escaping
    // worked is that the braces are text in the compiled output rather than a
    // block that consumed the rest of the document.
    ['prose braces stayed prose', out.includes('literal {#if}')],
  ];

  const failed = checks.filter(([, ok]) => !ok);

  console.log(
    `vite ${resolved('vite')} · vite-plugin-svelte ${resolved('@sveltejs/vite-plugin-svelte')} · svelte ${resolved('svelte')}`,
  );
  for (const [what, ok] of checks) console.log(`  ${ok ? '✓' : '✗'} ${what}`);

  if (failed.length > 0) process.exit(1);
} finally {
  rmSync(root, { recursive: true, force: true });
}
