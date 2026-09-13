/**
 * The compiler around the grammar: the pipeline, hoisting, metadata bindings
 * and the shape of the component it emits.
 */
import { compile, createCompiler } from '@svmd/core';
import { compile as compileSvelte } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

describe('createCompiler', () => {
  it('compiles the same as the one-off entry point', async () => {
    const source = '---\ntitle: T\n---\n\n# {title}\n\n<C a={1} />\n';
    const compiler = createCompiler({ gfm: true });

    expect((await compiler.compile(source, 'a.md')).code).toBe(
      (await compile(source, { gfm: true, filename: 'a.md' })).code,
    );
  });

  it('reuses its pipeline across files', async () => {
    // A plugin that ran the user's plugins again per file would see the
    // counter climb once per compile, not once in total.
    let instantiated = 0;
    const plugin = () => {
      instantiated++;
      return () => {};
    };

    const compiler = createCompiler({ remarkPlugins: [plugin] });
    for (let index = 0; index < 5; index++) {
      await compiler.compile('# h\n', `f${index}.md`);
    }

    expect(instantiated).toBe(1);
  });

  it('keeps the filename out of what decides the pipeline', async () => {
    // `compile` is called with a fresh options object per file in practice;
    // that must not build a pipeline per file.
    let instantiated = 0;
    const plugin = () => {
      instantiated++;
      return () => {};
    };
    const shared = { remarkPlugins: [plugin] };

    for (let index = 0; index < 5; index++) {
      await compile('# h\n', { ...shared, filename: `f${index}.md` });
    }

    expect(instantiated).toBe(1);
  });
});

describe('hoisting', () => {
  it('lifts scripts and styles wherever they were written', async () => {
    const result = await compile(
      [
        '{#if a}',
        '<script>let x = 1;</script>',
        '{/if}',
        '',
        '<Callout>',
        '<style>p{}</style>',
        '</Callout>',
        '',
      ].join('\n'),
    );

    expect(result.code).toContain('let x = 1;');
    expect(result.code).toContain('<style>');
    // And not where they were written.
    expect(result.code).not.toMatch(/\{#if a\}[\s\S]*let x = 1;/);
  });

  it('warns when it had to lift one out of a block', async () => {
    // The script runs unconditionally, which the source does not say.
    const result = await compile('{#if a}\n<script>let x = 1;</script>\n{/if}\n', {
      filename: 'post.md',
    });

    expect(result.warnings.map((warning) => warning.code)).toEqual(['W002']);
    expect(result.warnings[0]!.start).toMatchObject({ line: 2 });
  });

  it('says nothing about one written at the top level', async () => {
    const result = await compile('<script>let x = 1;</script>\n\n# h\n');
    expect(result.warnings).toEqual([]);
  });
});

describe('metadata', () => {
  it('always exports metadata, even with no frontmatter', async () => {
    // The content layer imports it unconditionally.
    expect((await compile('# h\n')).code).toContain('export const metadata = {}');
  });

  it('binds only keys that could be variables', async () => {
    const result = await compile(
      ['---', 'title: a', '2bad: b', 'kebab-case: c', 'class: d', 'metadata: e', '---', ''].join(
        '\n',
      ),
    );

    // The keys are all in `metadata`; only `title` can also be a variable.
    expect(result.code).toContain('const { title } = metadata;');
    expect(result.code).toContain('"2bad"');
    const bindings = /const \{ (.*) \} = metadata;/.exec(result.code)![1];
    expect(bindings).toBe('title');
  });

  it('does not shadow a name the author declared', async () => {
    const result = await compile(
      '---\ntitle: a\nother: b\n---\n\n<script>let title = 1;</script>\n',
    );

    expect(result.code).toContain('const { other } = metadata;');
    expect(result.code).not.toContain('title }');
    expect(() =>
      compileSvelte(result.code, { filename: 'x.svelte', generate: 'client' }),
    ).not.toThrow();
  });

  it('omits the binding line when nothing is bindable', async () => {
    const result = await compile('---\n2bad: b\n---\n');
    expect(result.code).not.toContain('= metadata;');
  });
});

describe('the emitted component', () => {
  it('puts the parts in the order a Svelte file is written in', async () => {
    const result = await compile(
      [
        '<script module>export const a = 1;</script>',
        '<script>let b = 2;</script>',
        '',
        '# h',
        '',
        '<style>h1{}</style>',
        '',
      ].join('\n'),
    );
    const code = result.code;

    expect(code.indexOf('<script module')).toBeLessThan(code.indexOf('<script>'));
    expect(code.indexOf('<script>')).toBeLessThan(code.indexOf('<h1>'));
    expect(code.indexOf('<h1>')).toBeLessThan(code.indexOf('<style'));
  });

  it('never emits `module` twice', async () => {
    const result = await compile('<script module>export const a = 1;</script>\n');
    expect(result.code).toContain('<script module>');
    expect(result.code).not.toContain('module module');
  });

  it('keeps attributes the compiler does not itself understand', async () => {
    // Svelte warns about an attribute it does not know, which is more use
    // than it silently disappearing.
    const result = await compile('<script type="text/javascript">let a = 1;</script>\n');
    expect(result.code).toContain('type="text/javascript"');
  });
});

describe('rawComponents', () => {
  const source = [
    '<Callout>',
    '',
    '**negrita** y {value}',
    '',
    '</Callout>',
    '',
    '<Code>',
    '',
    '**literal** y {value} y [x](/y)',
    '',
    '</Code>',
    '',
  ].join('\n');

  it('parses markdown inside every component by default', async () => {
    const result = await compile(source);
    expect(result.code).toContain('<Callout>\n<p><strong>negrita</strong>');
    expect(result.code).toContain('<Code>\n<p><strong>literal</strong>');
  });

  it('hands a named component its content untouched', async () => {
    const result = await compile(source, { rawComponents: ['Code'] });

    // Markdown syntax stays literal…
    expect(result.code).toContain('**literal** y {value} y [x](/y)');
    // …and the braces are not escaped, because inside this one the author
    // is writing Svelte.
    expect(result.code).not.toContain('&#123;value&#125;');
    // Everything else is unaffected.
    expect(result.code).toContain('<Callout>\n<p><strong>negrita</strong>');
  });

  it('keeps the element where it was written', async () => {
    // Unlike `<script>` and `<style>`, which are hoisted.
    const result = await compile('# h\n\n<Code>x</Code>\n', { rawComponents: ['Code'] });
    expect(result.code.indexOf('<h1>')).toBeLessThan(result.code.indexOf('<Code>'));
  });

  it('compiles to something Svelte accepts', async () => {
    const result = await compile(source, { rawComponents: ['Code'] });
    expect(() =>
      compileSvelte(result.code, { filename: 'x.svelte', generate: 'client' }),
    ).not.toThrow();
  });

  it('takes part in deciding which pipeline to reuse', async () => {
    // Two calls that differ only here must not share a parser.
    const plain = await compile('<Code>**x**</Code>\n');
    const raw = await compile('<Code>**x**</Code>\n', { rawComponents: ['Code'] });
    expect(plain.code).not.toBe(raw.code);
  });
});
