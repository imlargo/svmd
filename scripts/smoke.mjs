// Imports the *built* dist/, not src/, so a broken build — bad bundling, a
// dropped export, an `exports` map that does not resolve — fails here even with
// a fully green vitest run. The suite runs against source through vitest
// aliases, so this is the only lane that exercises what actually ships.
//
// Plain Node, no test runner, and no syntax past what `engines` claims: CI runs
// this on the oldest supported Node, which the build toolchain itself does not.
import { compile, createCompiler, SvmdError } from '@svmd/core';
import { createContent } from '@svmd/content';
import { shikiHighlighter } from '@svmd/shiki';
import { svmd } from '@svmd/vite';
import { svelteSyntax } from '@svmd/micromark-extension-svelte';
import { svelteFromMarkdown } from '@svmd/mdast-util-svelte';

const failures = [];
const check = (name, condition) => {
  if (!condition) failures.push(name);
};

// Every published entry point resolves and exports what it claims.
check('@svmd/core exports compile', typeof compile === 'function');
check('@svmd/core exports createCompiler', typeof createCompiler === 'function');
check('@svmd/core exports SvmdError', typeof SvmdError === 'function');
check('@svmd/content exports createContent', typeof createContent === 'function');
check('@svmd/shiki exports shikiHighlighter', typeof shikiHighlighter === 'function');
check('@svmd/vite exports the plugin', typeof svmd === 'function');
check('micromark extension is callable', typeof svelteSyntax === 'function');
check('mdast extension is callable', typeof svelteFromMarkdown === 'function');

// The built compiler actually compiles: frontmatter, a component, an
// expression, a control block, and prose braces that must stay prose.
const result = await compile(
  [
    '---',
    'title: Smoke',
    '---',
    '',
    '# {metadata.title}',
    '',
    '<Note>**bold**</Note>',
    '',
    '{#if a}',
    'x',
    '{/if}',
    '',
    'Use the {#if} block in prose.',
    '',
  ].join('\n'),
  { filename: 'smoke.md' },
);

check('metadata parsed', result.metadata.title === 'Smoke');
check('heading emitted', result.code.includes('<h1>'));
check('expression passed through', result.code.includes('{metadata.title}'));
check('markdown inside a component', result.code.includes('<strong>bold</strong>'));
check('control block passed through', result.code.includes('{#if a}'));
// `{brace}` alone is a valid expression and stays; a control word in prose is
// what deny-by-default has to catch.
check('prose braces escaped', result.code.includes('&#123;#if&#125;'));
check('source map produced', typeof result.map.mappings === 'string');

// The Vite plugin is shaped like one.
const plugin = svmd({ include: ['**/*.md'] });
check('plugin has a name', plugin.name === 'svmd');
// Compilation happens behind a shadow module id, so the hooks are resolveId
// and load rather than transform.
check('plugin resolves the shadow id', typeof plugin.resolveId === 'function');
check('plugin loads the component', typeof plugin.load === 'function');

if (failures.length > 0) {
  console.error('smoke test failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`smoke test passed: ${result.code.length} bytes of Svelte from the built dist/`);
