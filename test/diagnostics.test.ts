/**
 * NF8: every error names the file, the line, the column and what to do.
 * These assert the catalogue in ARCHITECTURE.md §5.
 */
import { compile, SvmdError } from '@svmd/core';
import { describe, expect, it } from 'vitest';

async function failure(source: string): Promise<SvmdError> {
  try {
    await compile(source, { filename: 'post.md' });
  } catch (error) {
    if (error instanceof SvmdError) return error;
    throw error;
  }
  throw new Error('expected a compile error');
}

describe('structural errors', () => {
  it('E001 — unclosed block, pointing at the opener', async () => {
    const error = await failure('intro\n\n{#if premium}\n\nbody\n');
    expect(error.code).toBe('E001');
    expect(error.start).toMatchObject({ line: 3, column: 1 });
    expect(error.hint).toContain('{/if}');
  });

  it('E002 — closer with no opener', async () => {
    const error = await failure('{/each}\n');
    expect(error.code).toBe('E002');
    expect(error.start).toMatchObject({ line: 1 });
  });

  it('E003 — crossed nesting', async () => {
    const error = await failure('{#if a}\n<Callout>\n{/if}\n</Callout>\n');
    expect(error.code).toBe('E003');
    expect(error.start).toMatchObject({ line: 3 });
    expect(error.message).toContain('</Callout>');
  });

  it('E003 — branch in the wrong block', async () => {
    const error = await failure('{#key v}\n{:then x}\n{/key}\n');
    expect(error.code).toBe('E003');
    expect(error.hint).toContain('{#await}');
  });

  it('E005 — unclosed element', async () => {
    const error = await failure('<Callout>\n\nbody\n');
    expect(error.code).toBe('E005');
    expect(error.start).toMatchObject({ line: 1 });
  });
});

describe('frontmatter errors', () => {
  it('E006 — invalid YAML, on the offending line', async () => {
    const error = await failure('---\ntitle: "unterminated\n---\n\nbody\n');
    expect(error.code).toBe('E006');
    expect(error.start!.line).toBeGreaterThanOrEqual(2);
  });

  it('E006 — frontmatter that is not a mapping', async () => {
    const error = await failure('---\n- a\n- b\n---\n');
    expect(error.code).toBe('E006');
    expect(error.message).toContain('a list');
  });

  it('E007 — schema violation, naming the field', async () => {
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: () => ({ issues: [{ message: 'Required', path: ['title'] }] }),
      },
    };
    try {
      await compile('---\nother: 1\n---\n', {
        filename: 'post.md',
        frontmatter: { schema },
      });
      throw new Error('expected a schema error');
    } catch (caught) {
      const schemaError = caught as SvmdError;
      expect(schemaError.code).toBe('E007');
      expect(schemaError.message).toContain('title: Required');
    }
  });
});

describe('script errors', () => {
  it('E008 — the same name declared in two script blocks', async () => {
    const error = await failure(
      '<script>\nlet a = 1;\n</script>\n\n<script>\nlet a = 2;\n</script>\n',
    );
    expect(error.code).toBe('E008');
    // Both ends of the clash are named, not just the one it stopped at.
    expect(error.message).toContain('line 2');
    expect(error.start).toMatchObject({ line: 6 });
  });
});

describe('error presentation', () => {
  it('carries a code frame and Rollup-compatible location', async () => {
    const error = await failure('one\ntwo\n\n{#if a}\n\nbody\n');
    expect(error.frame).toContain('> 4 | {#if a}');
    expect(error.frame).toContain('^');
    expect(error.loc).toEqual({ file: 'post.md', line: 4, column: 1 });
    expect(error.message).toContain('post.md:4:1');
  });
});

describe('warnings', () => {
  it('W001 — indented content inside an element became a code block', async () => {
    const result = await compile(
      ['<Callout>', '', '    this looks like indented text', '', '</Callout>', ''].join('\n'),
      { filename: 'post.md' },
    );

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({ code: 'W001', filename: 'post.md' });
    expect(result.warnings[0]!.start).toMatchObject({ line: 3 });
    expect(result.warnings[0]!.hint).toContain('Four spaces');
  });

  it('does not warn about a fenced block inside an element', async () => {
    const result = await compile(
      ['<Callout>', '', '```js', 'const a = 1;', '```', '', '</Callout>', ''].join('\n'),
    );
    expect(result.warnings).toEqual([]);
  });

  it('does not warn about indented code at the top level', async () => {
    const result = await compile('prose\n\n    indented on purpose\n');
    expect(result.warnings).toEqual([]);
  });

  it('warns inside a control block branch too', async () => {
    const result = await compile('{#if a}\n\n    indented\n\n{/if}\n');
    expect(result.warnings.map((warning) => warning.code)).toEqual(['W001']);
  });
});
