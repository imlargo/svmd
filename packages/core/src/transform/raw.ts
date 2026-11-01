import type { Nodes, Root } from 'hast';
import type { MergedBlock } from '../generate/script/merge.js';

/** Svelte reads a `{` in markup as an expression; as an entity it stays text. */
const BRACE = /[{}]/g;

/** An opening tag that carries `tabindex`, e.g. Shiki's scrollable `<pre tabindex="0">`. */
const TABINDEX_TAG = /<[a-zA-Z][^>]*?\stabindex\s*=/g;

/**
 * `svelte-ignore` covers the next node and its subtree, not its siblings, so it
 * goes before each tag it is about. Svelte drops comments when it compiles, so
 * the rendered markup, whitespace inside a `<pre>` included, is unchanged.
 */
const IGNORE_TABINDEX = '<!-- svelte-ignore a11y_no_noninteractive_tabindex -->';

/**
 * Whether the component's own stylesheet is scoped, and so can only reach
 * markup Svelte compiles: `{@html}` content gets no scoping class.
 */
export function hasScopedStyle(style: MergedBlock | null): boolean {
  return style !== null && !/(^|\s)global(\s|=|$)/.test(style.attributes);
}

/**
 * Turn the highlighter's and plugins' HTML into markup Svelte compiles, so a
 * scoped `<style>` in the same file reaches it.
 *
 * Otherwise that HTML is emitted as `{@html}`, which compiles about fifteen
 * times faster; this is only worth paying when a scoped stylesheet exists.
 * Braces are escaped, and a scrollable region's `tabindex`, which is correct
 * there, is not reported by Svelte's a11y check.
 */
export function rawToMarkup(tree: Root): void {
  const visit = (node: Nodes): void => {
    if (!('children' in node)) return;
    node.children = node.children.map((child) => {
      if (child.type !== 'raw') {
        visit(child);
        return child;
      }
      return {
        type: 'svelteRaw',
        value: child.value
          .replace(BRACE, (brace) => (brace === '{' ? '&#123;' : '&#125;'))
          .replace(TABINDEX_TAG, (tag) => IGNORE_TABINDEX + tag),
        ...(child.position ? { position: child.position } : {}),
      } as never;
    });
  };

  visit(tree);
}
