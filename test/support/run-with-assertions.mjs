/**
 * Compiles every fixture with micromark's development build loaded.
 *
 * That build asserts, among other things, that every `enter` has a matching
 * `exit` and that tokens nest properly — invariants a hand-written tokenizer
 * can break without producing wrong output until much later. Run as a child
 * process because the condition has to be set before any import happens.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// The built output, not the source: this runs in a plain Node process so that
// the development condition is set before micromark is first imported. Imported
// by package name, through the workspace link and the `exports` map, so a change
// in what the bundler names its output cannot silently break this.
import { compile } from '@svmd/core';

const directory = fileURLToPath(new URL('../fixtures/', import.meta.url));
const failures = [];

const extra = [
  '<C a="x {y} z" b={{a:1}} {...r} />\n',
  '<script>\n\tlet a = `${b}`;\n</script>\n\n{#if a}\nx\n{/if}\n',
  '> {#if a}\n> inner\n> {/if}\n',
  '- item\n\n  <Callout>\n\n  nested\n\n  </Callout>\n',
  '{`multi\nline`}\n',
  '<!-- c -->\n\n<style>a{b:c}</style>\n',
  '{a.replace(/[{}]/g, "")} and {total / count}\n',
  // The constructs with no upstream ancestor, where these assertions have
  // already caught a lookahead consuming with no token open.
  "{#each ['}'] as x}\nq\n{/each}\n",
  '{#if a /* } */}\nq\n{/if}\n',
  '{#if a // }\n}\nq\n{/if}\n',
  '{#key `${a}`}\nq\n{/key}\n',
  '{#if a &&\n  b}\nq\n{/if}\n',
  '{#await p}\n{:then v}\n{:catch e}\n{/await}\n',
  '{#snippet s(a, b)}\nq\n{/snippet}\n{@render s(1, 2)}\n',
  '> {#if a}\n> q\n> {/if}\n',
  '- {#if a}\n\n  q\n\n  {/if}\n',
  '<!-- a\nb -->\n\nx <!-- c --> y\n',
  '<style>\na {}\n\nb {}\n</style>\n',
  '<script lang="ts">\n\tlet a = "</scriptish>";\n</script>\n',
  '<style>p { color: red }</style>\n',
  '<a href=/a/b/c>x</a>\n\n<img src=/a.png/>\n',
  '<C class="a {b} c" {...rest} transition:fade|local />\n',
];

for (const name of readdirSync(directory).filter((file) => file.endsWith('.md'))) {
  try {
    await compile(readFileSync(directory + name, 'utf8'), { filename: name });
  } catch (error) {
    failures.push(`${name}: ${error.message.split('\n')[0]}`);
  }
}

for (const [index, source] of extra.entries()) {
  try {
    await compile(source, { filename: `extra-${index}.md` });
  } catch (error) {
    failures.push(`extra-${index}: ${error.message.split('\n')[0]}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('ok');
