/**
 * NF1: an error from the Svelte compiler must point at the line of the `.md`
 * the author wrote, not at the generated component.
 */
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { compile } from '@svmd/core';
import { describe, expect, it } from 'vitest';

/** First original position recorded for a generated line. */
function originOf(map: unknown, code: string, needle: string): { line: number; column: number } {
  const lines = code.split('\n');
  const index = lines.findIndex((line) => line.includes(needle));
  if (index === -1) throw new Error(`"${needle}" is not in the generated code`);

  const trace = new TraceMap(map as never);
  const column = lines[index]!.indexOf(needle);

  for (let probe = column; probe >= 0; probe--) {
    const position = originalPositionFor(trace, { line: index + 1, column: probe });
    if (position.line !== null) return { line: position.line, column: position.column };
  }

  throw new Error(`no mapping for the line holding "${needle}"`);
}

const source = [
  '---',
  'title: T',
  '---',
  '',
  '# The heading',
  '',
  '<script lang="ts">',
  '  const a: string = 1;',
  '</script>',
  '',
  'A paragraph.',
  '',
  '<Callout>',
  '',
  'Inside.',
  '',
  '</Callout>',
  '',
].join('\n');

describe('source maps', () => {
  it('names the markdown file as the source and embeds it', async () => {
    const result = await compile(source, { filename: 'src/post.md' });
    expect(result.map.sources).toEqual(['src/post.md']);
    expect(result.map.sourcesContent).toEqual([source]);
  });

  it('maps script lines to the markdown, line by line', async () => {
    const result = await compile(source, { filename: 'src/post.md' });
    expect(originOf(result.map, result.code, 'const a: string = 1;').line).toBe(8);
  });

  it('maps markup back to the block it came from', async () => {
    const result = await compile(source, { filename: 'src/post.md' });
    expect(originOf(result.map, result.code, '<h1>').line).toBe(5);
    expect(originOf(result.map, result.code, '<p>A paragraph.').line).toBe(11);
    expect(originOf(result.map, result.code, '<Callout>').line).toBe(13);
    expect(originOf(result.map, result.code, '<p>Inside.').line).toBe(15);
  });
});
