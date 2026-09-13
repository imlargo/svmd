import type { Nodes, Parent, Root } from 'mdast';
import { createWarning, type SvmdWarning } from './errors.js';

/** Node types whose children are markdown the author wrote by hand. */
const SVELTE_PARENTS = new Set(['svelteFlowElement', 'svelteBranch']);

/**
 * Diagnostics that are worth saying out loud but must not fail a build.
 *
 * Right now there is exactly one, and it is the single most common way to lose
 * an afternoon writing this kind of markdown.
 */
export function collectWarnings(
  tree: Root,
  source: string,
  filename: string | undefined,
): SvmdWarning[] {
  const warnings: SvmdWarning[] = [];
  const lines = source.split('\n');

  const walk = (node: Nodes, insideSvelte: boolean): void => {
    if (insideSvelte && node.type === 'code' && isIndentedCode(node, lines)) {
      warnings.push(
        createWarning({
          code: 'W001',
          message: 'Indented content inside `<' + '…>` was parsed as a code block, not as markdown',
          hint:
            'Four spaces start a code block in CommonMark. Remove the indentation, ' +
            'or use a fenced block if a code block is what you meant.',
          filename,
          source,
          ...(node.position ? { start: node.position.start, end: node.position.end } : {}),
        }),
      );
    }

    if (!('children' in node) || !Array.isArray(node.children)) return;
    const nested = insideSvelte || SVELTE_PARENTS.has(node.type);
    for (const child of (node as Parent).children) walk(child, nested);
  };

  walk(tree, false);
  return warnings;
}

/**
 * An indented code block cannot be told from a fenced one by its node alone —
 * both are `code` with a possibly-null `lang` — so the source line decides.
 */
function isIndentedCode(node: Nodes, lines: string[]): boolean {
  const start = node.position?.start;
  if (!start) return false;
  const line = lines[start.line - 1];
  if (line === undefined) return false;
  return /^(\t| {4})/.test(line);
}
