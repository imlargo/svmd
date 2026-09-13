import { htmlBlockNames } from 'micromark-util-html-tag-name';

/**
 * Whether a tag names a component rather than an HTML element.
 *
 * Svelte's own rule: a capital first letter. A dot and a colon are the two
 * other shapes a name can take that no HTML element has — `Foo.Bar`,
 * `svelte:head`.
 */
export function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name) || name.includes('.') || name.includes(':');
}

/**
 * Whether an element alone on its line reads as a block.
 *
 * CommonMark's own list of HTML block names, plus anything that looks like a
 * component — the same intuition an author already has from writing markdown.
 */
export function isBlockName(name: string): boolean {
  return isComponentName(name) || htmlBlockNames.includes(name.toLowerCase());
}
