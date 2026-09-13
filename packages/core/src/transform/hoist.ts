import type { SvelteScript, SvelteStyle } from '@svmd/mdast-util-svelte';
import type { Nodes, Parent, Root, RootContent } from 'mdast';
import { createWarning, type SvmdWarning } from '../diagnostics/errors.js';

export interface HoistResult {
  scripts: SvelteScript[];
  styles: SvelteStyle[];
  warnings: SvmdWarning[];
}

/** Node types whose children are a scope the author put content inside. */
const ENCLOSING = new Set(['svelteFlowElement', 'svelteBranch', 'blockquote', 'listItem']);

/**
 * Lift every `<script>` and `<style>` out of the document.
 *
 * A component has one script and one stylesheet however many blocks were
 * written, so they are removed from the tree entirely rather than rendered
 * where they stand.
 *
 * That is unremarkable at the top level and surprising anywhere else: a
 * `<script>` inside `{#if}` does not run conditionally, it runs always, and a
 * reader has no way to tell from the source. Hence the warning — the code still
 * compiles, and it very probably does not do what its author meant.
 */
export function hoistScriptsAndStyles(
  tree: Root,
  source: string,
  filename: string | undefined,
): HoistResult {
  const scripts: SvelteScript[] = [];
  const styles: SvelteStyle[] = [];
  const warnings: SvmdWarning[] = [];

  walk(tree, false);

  return { scripts, styles, warnings };

  function walk(node: Nodes, enclosed: boolean): void {
    if (!('children' in node) || !Array.isArray(node.children)) return;

    const parent = node as Parent;
    const kept: RootContent[] = [];

    for (const child of parent.children) {
      if (child.type === 'svelteScript' || child.type === 'svelteStyle') {
        if (enclosed) warnings.push(hoistedFromInside(child, source, filename));
        if (child.type === 'svelteScript') scripts.push(child);
        else styles.push(child);
        continue;
      }

      walk(child, enclosed || ENCLOSING.has(child.type));
      kept.push(child);
    }

    parent.children = kept;
  }
}

function hoistedFromInside(
  node: SvelteScript | SvelteStyle,
  source: string,
  filename: string | undefined,
): SvmdWarning {
  const tag = node.type === 'svelteScript' ? '<script>' : '<style>';

  return createWarning({
    code: 'W002',
    message:
      '`' + tag + '` was moved to the top of the component, out of the block it was written in',
    hint:
      'A component has one script and one stylesheet, so this one runs — or applies — ' +
      'unconditionally. Move it to the top of the file to say so.',
    filename,
    source,
    ...(node.position ? { start: node.position.start, end: node.position.end } : {}),
  });
}
