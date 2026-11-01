import type { Element, Nodes, Root, Text } from 'hast';
import { bindableKeys } from '../generate/metadata.js';

/** A heading of the compiled document, as `headings` exports it. */
export interface Heading {
  /** 1 to 6. */
  depth: number;
  /** The heading's text, without markup. */
  text: string;
  /** Its `id`, when a rehype plugin such as `rehype-slug` gave it one. */
  id?: string;
}

const EXPRESSIONS = new Set(['svelteTextExpression', 'svelteFlowExpression']);
const HEADING = /^h([1-6])$/;

interface Parent {
  children: Nodes[];
}

/**
 * Replace `{key}` with the text of a frontmatter value it can only ever be.
 *
 * Frontmatter is bound as `const`, so a string, number or boolean renders the
 * same either way; as text, rehype plugins see it, and `# {title}` gets a real id.
 */
export function inlineFrontmatter(
  tree: Root,
  metadata: Record<string, unknown>,
  declared: ReadonlySet<string>,
): void {
  const names = new Set(bindableKeys(metadata, declared));
  if (names.size === 0) return;

  const visit = (parent: Parent): void => {
    parent.children = parent.children.map((child) => {
      const replaced = asText(child, metadata, names);
      if (replaced) return replaced;
      if ('children' in child) visit(child);
      return child;
    });
  };

  visit(tree);
}

function asText(
  node: Nodes,
  metadata: Record<string, unknown>,
  names: ReadonlySet<string>,
): Text | undefined {
  if (!EXPRESSIONS.has(node.type)) return undefined;

  const { value: expression } = node as { value?: unknown };
  if (typeof expression !== 'string') return undefined;
  const name = expression.trim();
  if (!names.has(name)) return undefined;

  const value = metadata[name];
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return undefined;
  }

  return {
    type: 'text',
    value: String(value),
    ...(node.position ? { position: node.position } : {}),
  };
}

/** Every `h1`–`h6`, in document order, including those inside components. */
export function collectHeadings(tree: Root): Heading[] {
  const headings: Heading[] = [];

  const visit = (node: Nodes): void => {
    if (node.type === 'element') {
      const match = HEADING.exec(node.tagName);
      if (match) {
        // Text that depends on a runtime value has no static entry to give.
        if (!isDynamic(node)) headings.push(heading(node, Number(match[1])));
        return;
      }
    }
    if ('children' in node) for (const child of node.children as Nodes[]) visit(child);
  };

  visit(tree);
  return headings;
}

function heading(node: Element, depth: number): Heading {
  const id = node.properties.id;
  return {
    depth,
    text: textOf(node).replace(/\s+/g, ' ').trim(),
    ...(typeof id === 'string' && id !== '' ? { id } : {}),
  };
}

const RUNTIME = new Set([
  'svelteTextExpression',
  'svelteFlowExpression',
  'svelteTextTag',
  'svelteFlowTag',
]);

function isDynamic(node: Nodes): boolean {
  if (RUNTIME.has(node.type)) return true;
  return 'children' in node && (node.children as Nodes[]).some(isDynamic);
}

function textOf(node: Nodes): string {
  if (node.type === 'text') return node.value;
  if (!('children' in node)) return '';
  return (node.children as Nodes[]).map(textOf).join('');
}
