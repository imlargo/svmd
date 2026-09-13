import type { Code, Root } from 'mdast';
import { visit } from 'unist-util-visit';

export interface HighlightInput {
  /** Source of the fenced block. */
  value: string;
  /** Info string language, e.g. `ts` from ```` ```ts twoslash ````. */
  lang: string | null;
  /** The rest of the info string, e.g. `twoslash`. */
  meta: string | null;
}

/**
 * Turns a fenced code block into HTML.
 *
 * Runs on mdast rather than on hast so that `lang` and `meta` are both
 * available — the info string is lost by the time a code block becomes
 * `<pre><code>` (mdsvex #289).
 */
export type Highlighter = (input: HighlightInput) => string | Promise<string>;

/**
 * Replace `code` nodes with raw HTML from the configured highlighter.
 *
 * Deliberately placed after parsing and before the user's remark plugins are
 * applied would hide the `code` nodes from them, so this runs as an ordinary
 * plugin and the user controls the order by where they register their own.
 */
export function highlightCode(highlight: Highlighter) {
  return async function transform(tree: Root): Promise<void> {
    const jobs: Promise<void>[] = [];

    visit(tree, 'code', (node: Code, index, parent) => {
      if (!parent || index === undefined) return;
      jobs.push(
        Promise.resolve(
          highlight({ value: node.value, lang: node.lang ?? null, meta: node.meta ?? null }),
        ).then((value) => {
          parent.children[index] = {
            type: 'html',
            value,
            ...(node.position ? { position: node.position } : {}),
          };
        }),
      );
    });

    await Promise.all(jobs);
  };
}
