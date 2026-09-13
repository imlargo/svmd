import type { Nodes as HastNodes, Root as HastRoot } from 'hast';
import type { Root } from 'mdast';
import { toHast, type Handler, type State } from 'mdast-util-to-hast';
import { isBlockName } from '../internal/names.js';

/**
 * Node types that survive the mdast → hast conversion unchanged.
 *
 * This mirrors what MDX does with its own nodes: markdown constructs become
 * real hast elements (so `rehype-slug`, `rehype-pretty-code` and friends work
 * untouched), while Svelte constructs stay recognisable for the generator.
 */
const SVELTE_TYPES = [
  'svelteBlock',
  'svelteBranch',
  'svelteComment',
  'svelteFlowElement',
  'svelteFlowExpression',
  'svelteFlowTag',
  'svelteRaw',
  'svelteTextElement',
  'svelteTextExpression',
  'svelteTextTag',
] as const;

type Passed = Record<string, unknown> & { children?: unknown };

/** Copy the node, converting its children and separating them by line. */
const passBlock: Handler = (state: State, node: Passed) => {
  const { children: _children, ...rest } = node;
  const children = state.all(node as never);
  return {
    ...structuredClone(rest),
    // `wrap` on an empty list still yields a newline, which would turn
    // `<Counter />` into `<Counter>\n</Counter>`.
    children: children.length > 0 ? state.wrap(children, true) : children,
  } as never;
};

/** Copy the node, converting its children without adding whitespace. */
const passInline: Handler = (state: State, node: Passed) => {
  const { children: _children, ...rest } = node;
  return { ...structuredClone(rest), children: state.all(node as never) } as never;
};

/** Copy a leaf node verbatim. */
const passLeaf: Handler = (_state: State, node: Passed) => structuredClone(node) as never;

/**
 * An element whose content is blocks is laid out across lines; anything else is
 * kept tight.
 *
 * Both halves matter. The grammar lets several tags share a line, so
 * `<span>{x}</span>` is a flow element just like `<td>{x}</td>` is, and only the
 * name tells them apart — hence the list of block-level names. But a text
 * element holds phrasing whatever it is called, and `Click <Button>here</Button>
 * now` must not gain whitespace around `here`, so those stay tight regardless.
 */
const passElement: Handler = (state: State, node: Passed) => {
  const children = node.children as { type: string }[] | undefined;

  // Content the author opted out of markdown for is verbatim: a newline added
  // either side of it would be a newline they did not write.
  if (children?.length === 1 && children[0]?.type === 'svelteRaw') {
    return passInline(state, node, undefined);
  }

  const handler = isBlockName(typeof node.name === 'string' ? node.name : '')
    ? passBlock
    : passInline;
  return handler(state, node, undefined);
};

/**
 * Convert the markdown tree to hast, keeping the Svelte nodes intact.
 *
 * `allowDangerousHtml` is on because the output is a Svelte component, not a
 * sanitised HTML document — without it every `<Callout>` would come out as
 * `&lt;Callout&gt;` (G3).
 */
export function svelteToHast(tree: Root): HastRoot {
  return toHast(tree, {
    allowDangerousHtml: true,
    passThrough: [...SVELTE_TYPES] as never,
    handlers: {
      svelteBranch: passBlock,
      svelteFlowElement: passElement,
      svelteBlock: passInline,
      svelteTextElement: passInline,
      svelteComment: passLeaf,
      svelteRaw: passLeaf,
      svelteFlowExpression: passLeaf,
      svelteFlowTag: passLeaf,
      svelteTextExpression: passLeaf,
      svelteTextTag: passLeaf,
    },
  }) as HastRoot;
}

export type { HastNodes };
