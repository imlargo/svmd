import type { SvelteAttributeLike, SvelteAttributeValuePart } from '@svmd/mdast-util-svelte';
import { escapeAttributeLiteral } from './escape.js';

/**
 * Serialise one attribute back to Svelte source, verbatim.
 *
 * Shared by the markup generator and the script merge: both have to put back
 * exactly what the author wrote, directives and modifiers included.
 */
export function stringifyAttribute(attribute: SvelteAttributeLike): string {
  if (attribute.type === 'svelteSpreadAttribute') {
    return '{...' + attribute.value + '}';
  }

  if (attribute.shorthand) return '{' + attribute.name + '}';

  if (attribute.value === null) return attribute.name;

  // A lone expression keeps its brace form: `on:click={handler}`.
  const only = attribute.value.length === 1 ? attribute.value[0] : undefined;
  if (attribute.quote === null && only?.type === 'expression') {
    return attribute.name + '={' + only.value + '}';
  }

  const quote = attribute.quote ?? '"';
  const parts = attribute.value.map((part) => stringifyPart(part, quote)).join('');
  return attribute.name + '=' + quote + parts + quote;
}

export function stringifyPart(part: SvelteAttributeValuePart, quote: '"' | "'"): string {
  return part.type === 'expression'
    ? '{' + part.value + '}'
    : escapeAttributeLiteral(part.value, quote);
}
