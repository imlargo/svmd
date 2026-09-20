/**
 * `@svmd/shiki` is the one adapter svmd ships, and the shape every other
 * highlighter has to follow: a function of `{ value, lang, meta }` returning
 * HTML. These cover the decisions the adapter makes on its own — which theme
 * shape to pass through, and what to do with a language Shiki does not know.
 */
import { shikiHighlighter } from '@svmd/shiki';
import { describe, expect, it } from 'vitest';

describe('shikiHighlighter', () => {
  it('highlights a fenced block with a single theme', async () => {
    const highlight = await shikiHighlighter({ theme: 'github-dark', langs: ['ts'] });
    const html = await highlight({ value: 'const a = 1;', lang: 'ts', meta: null });

    expect(html).toContain('<pre');
    expect(html).toContain('shiki');
    expect(html).toContain('const');
    // A single theme is baked into the markup, not left to CSS variables.
    expect(html).toContain('style=');
  });

  it('emits CSS variables when given several themes', async () => {
    const highlight = await shikiHighlighter({
      themes: { light: 'github-light', dark: 'github-dark' },
      langs: ['ts'],
    });
    const html = await highlight({ value: 'const a = 1;', lang: 'ts', meta: null });

    expect(html).toContain('--shiki-dark');
  });

  /** An unknown info string must not fail the build over a code block. */
  it('falls back instead of throwing on a language Shiki does not know', async () => {
    const highlight = await shikiHighlighter({ theme: 'github-dark', langs: ['ts'] });
    const html = await highlight({ value: 'hello', lang: 'not-a-real-language', meta: null });

    expect(html).toContain('<pre');
    expect(html).toContain('hello');
  });

  it('uses the fallback language for a fence with no info string', async () => {
    const highlight = await shikiHighlighter({ theme: 'github-dark', langs: ['ts'] });
    const html = await highlight({ value: 'plain text', lang: null, meta: null });

    expect(html).toContain('plain text');
  });

  /** A language outside `langs` is loaded on demand rather than refused. */
  it('loads a known language that was not preloaded', async () => {
    const highlight = await shikiHighlighter({ theme: 'github-dark', langs: ['ts'] });
    const html = await highlight({ value: 'body { color: red }', lang: 'css', meta: null });

    expect(html).toContain('color');
  });
}, 60_000);
