/**
 * Regression matrix built from the mdsvex issues listed in SPEC.md appendix C.
 *
 * Each test names the issue it stands for. They are the reason the project
 * exists, so they are asserted directly rather than snapshotted.
 */
import { compile } from '@svmd/core';
import type { Code, Root } from 'mdast';
import { compile as compileSvelte } from 'svelte/compiler';
import { visit } from 'unist-util-visit';
import { describe, expect, it } from 'vitest';

describe('mdsvex #93 — code blocks reach remark plugins as `code`, not `html`', () => {
  it('exposes lang and meta on a real code node', async () => {
    const seen: { lang: string | null; meta: string | null; value: string }[] = [];

    const collect = () => (tree: Root) => {
      visit(tree, 'code', (node: Code) => {
        seen.push({ lang: node.lang ?? null, meta: node.meta ?? null, value: node.value });
      });
    };

    await compile('```js twoslash title="a.js"\nconst a = 1;\n```\n', {
      remarkPlugins: [collect],
    });

    expect(seen).toEqual([{ lang: 'js', meta: 'twoslash title="a.js"', value: 'const a = 1;' }]);
  });
});

describe('mdsvex #289 — the info string survives to the highlighter', () => {
  it('passes lang and meta through', async () => {
    const seen: unknown[] = [];

    const result = await compile('```ts foo bar\nlet a = 1;\n```\n', {
      highlight: (input) => {
        seen.push(input);
        return `<pre data-lang="${input.lang}" data-meta="${input.meta}">ok {x}</pre>`;
      },
    });

    expect(seen).toEqual([{ lang: 'ts', meta: 'foo bar', value: 'let a = 1;' }]);
    // Highlighter output is raw HTML, so its braces are neutralised but its
    // tags are kept.
    expect(result.code).toContain('<pre data-lang="ts" data-meta="foo bar">ok &#123;x&#125;</pre>');
  });
});

describe('mdsvex #745 — metadata keeps its types', () => {
  it('round-trips nested structures', async () => {
    const result = await compile(
      ['---', 'a: 1', 'b: [x, y]', 'c:', '  d: true', '---', ''].join('\n'),
    );
    expect(result.metadata).toEqual({ a: 1, b: ['x', 'y'], c: { d: true } });
    expect(result.code).toContain('export const metadata = {a:1,b:["x","y"],c:{d:true}};');
  });

  it('emits a real Date when a schema coerces one', async () => {
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: (value: unknown) => ({
          value: { date: new Date((value as { date: string }).date) },
        }),
      },
    };

    const result = await compile('---\ndate: 2026-09-12\n---\n', { frontmatter: { schema } });
    expect(result.code).toContain(`new Date(${new Date('2026-09-12').getTime()})`);
  });
});

describe('mdsvex #777 — a variable inside a code block stays literal', () => {
  it('escapes braces in fenced and inline code', async () => {
    const result = await compile('```\n{count}\n```\n\nand `{count}` inline\n');
    expect(result.code).toContain('&#123;count&#125;');
    expect(result.code).not.toMatch(/<code[^>]*>\{count\}/);
  });
});

describe('mdsvex #815 / #555 — Svelte 5 components and HTML both work', () => {
  it('renders a component, an element and markdown in one document', async () => {
    const result = await compile(
      [
        '<script>',
        "  import Counter from './Counter.svelte';",
        '  let count = $state(0);',
        '</script>',
        '',
        '<Counter bind:count />',
        '',
        '<div class="box">',
        '',
        'Markdown **inside** an element.',
        '',
        '</div>',
        '',
      ].join('\n'),
    );

    expect(result.code).toContain('<Counter bind:count />');
    expect(result.code).toContain('<div class="box">');
    expect(result.code).toContain('<strong>inside</strong>');

    const compiled = compileSvelte(result.code, { filename: 'x.svelte', generate: 'client' });
    expect(compiled.warnings).toEqual([]);
  });
});

describe('mdsvex #485 / L3 — TypeScript survives, scripts merge', () => {
  it('keeps type annotations verbatim and merges blocks', async () => {
    const result = await compile(
      [
        '<script lang="ts">',
        '  interface Props { a: string }',
        '  let { a }: Props = $props();',
        '</script>',
        '',
        '<script lang="ts">',
        '  let b: number = 1;',
        '</script>',
        '',
        '{a}{b}',
        '',
      ].join('\n'),
    );

    expect(result.code).toContain('interface Props { a: string }');
    expect(result.code).toContain('let b: number = 1;');
    // One instance script, not two.
    expect(result.code.match(/<script lang="ts">/g)).toHaveLength(1);
  });

  it('drops an import repeated across the module and instance scopes', async () => {
    const result = await compile(
      [
        '<script module>',
        "  import { base } from './shared.js';",
        '  export const prerender = true;',
        '</script>',
        '',
        '<script>',
        "  import { base } from './shared.js';",
        '  let x = 1;',
        '</script>',
        '',
        '{base}{x}',
        '',
      ].join('\n'),
    );

    expect(result.code.match(/import \{ base \}/g)).toHaveLength(1);
    expect(() =>
      compileSvelte(result.code, { filename: 'x.svelte', generate: 'client' }),
    ).not.toThrow();
  });
});

describe('L6 — markdown inside components and HTML', () => {
  it('parses markdown inside a raw HTML element, which CommonMark does not', async () => {
    const result = await compile('<div>\n\n**bold**\n\n</div>\n');
    expect(result.code).toContain('<strong>bold</strong>');
  });
});

describe('G1 / G2 — gotchas the grammar removes', () => {
  it('accepts an object literal with spaces in an attribute (G1)', async () => {
    const result = await compile('<Chart data={{ a: 1 }} />\n');
    expect(result.code).toContain('<Chart data={{ a: 1 }} />');
  });

  it('accepts a dotted component name (G2)', async () => {
    const result = await compile('<Foo.Bar />\n');
    expect(result.code).toContain('<Foo.Bar />');
  });
});

describe('escaping stays faithful to the source', () => {
  it('does not double-escape an entity in an attribute value', async () => {
    const result = await compile('<C title="a &amp; b &lt; c" />\n');
    expect(result.code).toContain('<C title="a &amp; b &lt; c" />');
  });

  it('escapes an entity that markdown already decoded', async () => {
    const result = await compile('AT&amp;T and a &lt; b\n');
    expect(result.code).toContain('<p>AT&amp;T and a &lt; b</p>');
  });

  it('leaves braces in comments alone', async () => {
    // Svelte does not evaluate expressions inside comments.
    const result = await compile('<!-- {#if a} -->\n\nafter\n');
    expect(result.code).toContain('<!-- {#if a} -->');
  });

  it('neutralises braces in highlighter output but keeps its markup', async () => {
    const result = await compile('```js\nif (a) { b() }\n```\n', {
      highlight: ({ value }) => `<pre class="shiki"><code>${value}</code></pre>`,
    });
    expect(result.code).toContain('<pre class="shiki"><code>if (a) &#123; b() &#125;</code></pre>');
  });
});

describe('a clause may end inside a line comment', () => {
  // The grammar trims a block clause, dropping the line ending that closed
  // the comment. Emitting the brace straight after would comment it out.
  it('keeps the closing brace out of the comment', async () => {
    for (const source of [
      '{#if a // why\n}\nx\n{/if}\n',
      '{@html a // why\n}\n',
      '{a // why\n}\n',
      '<C p={a // why\n} />\n',
    ]) {
      const result = await compile(source);
      expect(
        () => compileSvelte(result.code, { filename: 'x.svelte', generate: 'client' }),
        source,
      ).not.toThrow();
    }
  });
});

describe('block-level elements never end up inside a paragraph', () => {
  // Svelte rejects the nesting outright: “`</p>` attempted to close an element
  // that was already automatically closed”.
  it('splits a paragraph around a block-level element', async () => {
    const result = await compile('text <div>x</div> more\n');
    expect(result.code).toContain('<p>text </p>');
    expect(result.code).toContain('<div>x</div>');
    expect(result.code).toContain('<p> more</p>');
    expect(() =>
      compileSvelte(result.code, { filename: 'x.svelte', generate: 'client' }),
    ).not.toThrow();
  });

  it('accepts every block-level name markdown knows', async () => {
    // `table` is left out: `<table>x</table>` is the author's own invalid
    // HTML — a table holds rows, not text — and Svelte is right to say so.
    for (const name of ['div', 'section', 'blockquote', 'figure', 'aside', 'main']) {
      const result = await compile(`a <${name}>x</${name}> b\n`);
      expect(
        () => compileSvelte(result.code, { filename: 'x.svelte', generate: 'client' }),
        name,
      ).not.toThrow();
    }
  });

  it('leaves inline elements and components where they are', async () => {
    // Splitting `Click <Button>here</Button> now` would be far worse than the
    // problem it solves.
    const result = await compile('Click <Button>here</Button> now.\n');
    expect(result.code).toContain('<p>Click <Button>here</Button> now.</p>');

    const span = await compile('a <span>x</span> b\n');
    expect(span.code).toContain('<p>a <span>x</span> b</p>');
  });

  it('splits around a component named in `blockElements`', async () => {
    // What a component renders is not knowable here; shadcn's `Card` is a
    // `<div>`, so an author says so once.
    const result = await compile('text <Card>x</Card> more\n', {
      blockElements: ['Card'],
    });
    expect(result.code).toContain('<p>text </p>');
    expect(result.code).toContain('<Card>x</Card>');
    expect(result.code).toContain('<p> more</p>');
  });

  it('keeps a named component block even alone on its line', async () => {
    const result = await compile('<Card>x</Card>\n', { blockElements: ['Card'] });
    expect(result.code).not.toContain('<p>');
  });

  it('does not add whitespace inside an element that holds phrasing', async () => {
    // A newline either side of `here` would be visible in the rendered page.
    const result = await compile('<Button>here</Button>\n');
    expect(result.code).toContain('<Button>here</Button>');
  });
});
