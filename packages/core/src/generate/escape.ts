/**
 * Escaping (§8.3, D5).
 *
 * Braces are the whole point. By the time a value reaches these functions the
 * grammar has already lifted every real Svelte construct out into its own node,
 * so anything still holding a `{` is text that must be shown literally. Svelte
 * decodes `&#123;` back to `{` when rendering, so nothing is lost.
 */

const TEXT_PATTERN = /[&<>{}]/g;
const TEXT_REPLACEMENTS: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '{': '&#123;',
  '}': '&#125;',
};

/** Escape a text node for use in Svelte markup. */
export function escapeText(value: string): string {
  return value.replace(TEXT_PATTERN, (character) => TEXT_REPLACEMENTS[character] ?? character);
}

const DOUBLE_QUOTED_PATTERN = /[&<>"{}]/g;
const SINGLE_QUOTED_PATTERN = /[&<>'{}]/g;
const ATTRIBUTE_REPLACEMENTS: Record<string, string> = {
  ...TEXT_REPLACEMENTS,
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape a literal run inside a quoted attribute value. */
export function escapeAttribute(value: string, quote: '"' | "'"): string {
  const pattern = quote === '"' ? DOUBLE_QUOTED_PATTERN : SINGLE_QUOTED_PATTERN;
  return value.replace(pattern, (character) => ATTRIBUTE_REPLACEMENTS[character] ?? character);
}

/**
 * Escape a literal run of a *source* attribute value, e.g. the `a &amp; b` in
 * `<C title="a &amp; b" />`.
 *
 * Unlike `escapeAttribute`, which receives text a markdown parser already
 * decoded, this text is HTML source as the author typed it: escaping its `&`
 * would turn `&amp;` into `&amp;amp;` and render the entity instead of the
 * character. Only the closing quote and `{` need neutralising — Svelte reads a
 * lone `}` in an attribute as data, and the grammar never lets a literal `{`
 * reach here in the first place.
 */
export function escapeAttributeLiteral(value: string, quote: '"' | "'"): string {
  return value.replaceAll('{', '&#123;').replaceAll(quote, quote === '"' ? '&quot;' : '&#39;');
}

const BRACE_PATTERN = /[{}]/g;

/**
 * Escape only braces, leaving markup intact.
 *
 * Used for `raw` HTML that a rehype plugin or the syntax highlighter produced:
 * the tags in it are meant to reach the browser, but a `{` inside highlighted
 * source code (`function f() {`) would otherwise be read by Svelte as the start
 * of an expression. A plugin that deliberately emits Svelte syntax opts out by
 * using a `svelteRaw` node instead.
 */
export function escapeBraces(value: string): string {
  return value.replace(BRACE_PATTERN, (character) => TEXT_REPLACEMENTS[character] ?? character);
}
