/**
 * NF3: under 20 ms per file, cold, median, for a 200-line document.
 *
 * The number matters less than the shape: nothing here should be accidentally
 * quadratic, and acorn should stay off the hot path for ordinary prose (§I2).
 */
import { compile } from '@svmd/core';
import { describe, expect, it } from 'vitest';

function makeDocument(paragraphs: number): string {
  const parts = ['---', 'title: Benchmark', 'tags: [a, b, c]', '---', ''];

  for (let index = 0; index < paragraphs; index++) {
    parts.push(`## Section ${index}`, '');
    parts.push(
      `Prose with **bold**, a [link](/x), \`code\`, an expression {value${index}} and`,
      `literal braces {#if} that must be escaped. Some more text to fill the line.`,
      '',
    );
    parts.push(
      '<Callout type="info">',
      '',
      `Nested **markdown** number ${index}.`,
      '',
      '</Callout>',
      '',
    );
    parts.push('```ts', `const a${index}: number = { x: ${index} }.x;`, '```', '');
    parts.push(`{#if show${index}}`, '', `- item {index}`, '', '{/if}', '');
  }

  return parts.join('\n');
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

describe('performance', () => {
  it('compiles a 200-line document well under the budget', async () => {
    const source = makeDocument(12);
    expect(source.split('\n').length).toBeGreaterThan(200);

    // Warm the pipeline the way a dev server would be warm.
    await compile(source, { filename: 'bench.md' });

    const samples: number[] = [];
    for (let run = 0; run < 25; run++) {
      const started = performance.now();
      await compile(source, { filename: 'bench.md' });
      samples.push(performance.now() - started);
    }

    const result = median(samples);
    expect(result, `median ${result.toFixed(2)}ms`).toBeLessThan(20);
  });

  it('stays linear as documents grow', async () => {
    const small = makeDocument(10);
    const large = makeDocument(100);

    const time = async (source: string): Promise<number> => {
      await compile(source, { filename: 'bench.md' });
      const samples: number[] = [];
      for (let run = 0; run < 5; run++) {
        const started = performance.now();
        await compile(source, { filename: 'bench.md' });
        samples.push(performance.now() - started);
      }
      return median(samples);
    };

    const ratio = (await time(large)) / (await time(small));
    // Ten times the input should not cost dramatically more than ten times
    // the work; the ceiling is loose so the test is not flaky on CI.
    expect(ratio, `ratio ${ratio.toFixed(2)}x for 10x input`).toBeLessThan(25);
  });

  it('does not slow down on prose full of braces', async () => {
    const braces = Array.from(
      { length: 400 },
      (_, i) => `Line ${i} with { "json": "pasted" } and {#if} and {a, b} and an unclosed {.`,
    ).join('\n\n');

    const started = performance.now();
    await compile(braces, { filename: 'braces.md' });
    const elapsed = performance.now() - started;

    expect(elapsed, `${elapsed.toFixed(2)}ms for 400 brace-heavy lines`).toBeLessThan(200);
  });
});

describe('backtracking is bounded', () => {
  /**
   * A construct that never closes scans forward before it gives up. Without a
   * bound, a paragraph holding many of them costs O(n²) — the case that
   * measured 258 ms for four hundred lines.
   */
  async function ratioFor(build: (lines: number) => string): Promise<number> {
    const time = async (source: string): Promise<number> => {
      await compile(source, { filename: 'bench.md' });
      const samples: number[] = [];
      for (let run = 0; run < 5; run++) {
        const started = performance.now();
        await compile(source, { filename: 'bench.md' });
        samples.push(performance.now() - started);
      }
      return median(samples);
    };

    const small = await time(build(100));
    const large = await time(build(400));
    return large / Math.max(small, 0.1);
  }

  it('stays linear on a paragraph full of unclosed braces', async () => {
    const ratio = await ratioFor(
      (lines) =>
        Array.from({ length: lines }, (_, i) => `Line ${i} with a stray { brace.`).join('\n') +
        '\n',
    );
    // Quadratic would be ~16x for four times the input.
    expect(ratio, `${ratio.toFixed(1)}x for 4x the input`).toBeLessThan(8);
  });

  it('stays linear on a paragraph full of unclosed comments', async () => {
    const ratio = await ratioFor(
      (lines) =>
        Array.from({ length: lines }, (_, i) => `Line ${i} with <!-- unclosed.`).join('\n') + '\n',
    );
    expect(ratio, `${ratio.toFixed(1)}x for 4x the input`).toBeLessThan(8);
  });

  it('stays linear on a paragraph full of unclosed tags', async () => {
    const ratio = await ratioFor(
      (lines) =>
        Array.from({ length: lines }, (_, i) => `Line ${i} with <a unclosed.`).join('\n') + '\n',
    );
    expect(ratio, `${ratio.toFixed(1)}x for 4x the input`).toBeLessThan(8);
  });
});
