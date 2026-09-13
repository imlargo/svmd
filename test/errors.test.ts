import { codeFrame } from '@svmd/core';
import { describe, expect, it } from 'vitest';

describe('code frame', () => {
  it('points at the reported column', () => {
    expect(codeFrame('one\ntwo\nthree\n', { line: 2, column: 2 })).toBe(
      ['  1 | one', '> 2 | two', '    |  ^', '  3 | three'].join('\n'),
    );
  });

  it('underlines the whole span when it is on one line', () => {
    const frame = codeFrame('abcdef\n', { line: 1, column: 2 }, { line: 1, column: 5 });
    expect(frame).toContain('^^^');
  });

  it('expands tabs so the caret lands under the right character', () => {
    // A caret padded with spaces under a tab-indented line points at the
    // wrong column, which is worse than no frame at all.
    const frame = codeFrame('\t\tlet a = 1;\n', { line: 1, column: 3 });
    const [line, caret] = frame.split('\n');
    expect(line).toBe('> 1 |         let a = 1;');
    expect(caret!.indexOf('^')).toBe(line!.indexOf('let'));
  });

  it('windows a long line around the caret', () => {
    const source = 'x'.repeat(400) + 'HERE' + 'y'.repeat(400);
    const frame = codeFrame(source, { line: 1, column: 401 });
    const [line, caret] = frame.split('\n');

    expect(line!.length).toBeLessThan(120);
    expect(line).toContain('…');
    expect(line!.slice(caret!.indexOf('^'))).toMatch(/^HERE/);
  });

  it('does not window a line that fits', () => {
    expect(codeFrame('short line\n', { line: 1, column: 1 })).not.toContain('…');
  });

  it('clamps the context to the file', () => {
    const frame = codeFrame('only\n', { line: 1, column: 1 });
    expect(frame.split('\n')).toHaveLength(2);
  });

  it('survives a column past the end of the line', () => {
    expect(() => codeFrame('ab\n', { line: 1, column: 99 })).not.toThrow();
  });
});
