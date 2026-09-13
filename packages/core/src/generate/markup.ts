import type {
  SvelteAttributeLike,
  SvelteBlock,
  SvelteBranch,
  SvelteComment,
  SvelteFlowElement,
  SvelteFlowExpression,
  SvelteFlowTag,
  SvelteRaw,
  SvelteTextElement,
  SvelteTextExpression,
  SvelteTextTag,
} from '@svmd/mdast-util-svelte';
import type { Element, Nodes as HastNodes } from 'hast';
import { find, html, svg, type Schema } from 'property-information';
import type { SvmdPoint } from '../diagnostics/errors.js';
import type { SourceBuilder } from '../internal/source-builder.js';
import { isComponentName } from '../internal/names.js';
import { stringifyAttribute } from './attributes.js';
import { escapeAttribute, escapeBraces, escapeText } from './escape.js';

/** Elements that must not be given a closing tag. */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/**
 * Close a construct whose value came out of the grammar trimmed.
 *
 * A clause may end inside a line comment — `{#if a // why}` — and the grammar
 * drops the line ending that terminated it. Putting the brace straight after
 * would comment it out and produce Svelte that does not parse. Adding the line
 * ending back is harmless in every other case.
 */
function closeBrace(value: string): string {
  return /\/\/[^\n]*$/.test(value) ? '\n}' : '}';
}

type SvelteHastNode =
  | SvelteBlock
  | SvelteBranch
  | SvelteComment
  | SvelteFlowElement
  | SvelteFlowExpression
  | SvelteFlowTag
  | SvelteRaw
  | SvelteTextElement
  | SvelteTextExpression
  | SvelteTextTag;

type AnyNode = HastNodes | SvelteHastNode;

function startOf(node: { position?: { start: SvmdPoint } | undefined }): SvmdPoint | undefined {
  return node.position?.start;
}

/**
 * Serialise a hast tree — with the Svelte nodes that were passed through it —
 * into Svelte component markup.
 *
 * This replaces `hast-util-to-html` rather than wrapping it, because the two
 * differ on exactly the thing that matters: what happens to a `{`.
 */
export function generateMarkup(tree: AnyNode, builder: SourceBuilder): void {
  one(tree, builder, html);
}

function all(nodes: readonly AnyNode[], builder: SourceBuilder, schema: Schema): void {
  for (const node of nodes) one(node, builder, schema);
}

function one(node: AnyNode, builder: SourceBuilder, schema: Schema): void {
  switch (node.type) {
    case 'root':
      all(node.children, builder, schema);
      return;

    case 'text':
      builder.append(escapeText(node.value), startOf(node));
      return;

    case 'comment':
      // Svelte does not evaluate expressions inside comments, so escaping
      // braces here would only corrupt what a reader sees in the DOM.
      builder.append('<!--' + node.value + '-->', startOf(node));
      return;

    case 'raw':
      // Produced by rehype plugins and the highlighter: keep the markup,
      // neutralise the braces.
      builder.append(escapeBraces((node as { value: string }).value), startOf(node));
      return;

    case 'element':
      element(node, builder, schema);
      return;

    case 'svelteComment':
      builder.append('<!--' + node.value + '-->', startOf(node));
      return;

    case 'svelteRaw':
      // Verbatim, braces and all: the author opted this component out of
      // markdown, so what they wrote is Svelte and is theirs to control.
      builder.append(node.value, startOf(node));
      return;

    case 'svelteFlowExpression':
    case 'svelteTextExpression':
      builder.append('{' + node.value + '}', startOf(node));
      return;

    case 'svelteFlowTag':
    case 'svelteTextTag':
      builder.append('{@' + node.name, startOf(node));
      if (node.value) builder.append(' ' + node.value);
      builder.append(closeBrace(node.value));
      return;

    case 'svelteBlock':
      block(node, builder, schema);
      return;

    case 'svelteBranch':
      branch(node, builder, schema);
      return;

    case 'svelteFlowElement':
    case 'svelteTextElement':
      svelteElement(node, builder, schema);
      return;

    default:
      // `doctype` and anything a plugin invented: nothing sensible to emit.
      return;
  }
}

function block(node: SvelteBlock, builder: SourceBuilder, schema: Schema): void {
  all(node.children, builder, schema);
  builder.append('{/' + node.name + '}');
}

function branch(node: SvelteBranch, builder: SourceBuilder, schema: Schema): void {
  builder.append('{' + node.marker, startOf(node));
  if (node.value) builder.append(' ' + node.value);
  builder.append(closeBrace(node.value));
  all(node.children as AnyNode[], builder, schema);
}

function element(node: Element, builder: SourceBuilder, parentSchema: Schema): void {
  const name = node.tagName;
  const schema = name === 'svg' ? svg : name === 'foreignObject' ? html : parentSchema;

  builder.append('<' + name, startOf(node));
  properties(node, builder, schema);

  if (VOID_ELEMENTS.has(name) && schema === html) {
    builder.append('>');
    return;
  }

  builder.append('>');
  all(node.children, builder, schema);
  builder.append('</' + name + '>');
}

function properties(node: Element, builder: SourceBuilder, schema: Schema): void {
  for (const [key, value] of Object.entries(node.properties)) {
    if (value === false || value === null || value === undefined) continue;

    const info = find(schema, key);
    if (value === true) {
      builder.append(' ' + info.attribute);
      continue;
    }

    const text = Array.isArray(value)
      ? value.join(info.commaSeparated ? ', ' : ' ')
      : String(value);

    builder.append(' ' + info.attribute + '="' + escapeAttribute(text, '"') + '"');
  }
}

function svelteElement(
  node: SvelteFlowElement | SvelteTextElement,
  builder: SourceBuilder,
  parentSchema: Schema,
): void {
  const name = node.name;
  const schema = name === 'svg' ? svg : name === 'foreignObject' ? html : parentSchema;

  builder.append('<' + name, startOf(node));
  for (const attribute of node.attributes) attributeOf(attribute, builder);

  const empty = node.children.length === 0;
  const selfClose = empty && (node.selfClosing || isComponentName(name) || VOID_ELEMENTS.has(name));

  if (selfClose) {
    // Void HTML elements must not be written `<br />` inside SVG, and Svelte
    // rejects self-closing non-void HTML elements, hence the split.
    builder.append(VOID_ELEMENTS.has(name) && schema === html ? '>' : ' />');
    return;
  }

  builder.append('>');
  all(node.children as AnyNode[], builder, schema);
  builder.append('</' + name + '>');
}

function attributeOf(attribute: SvelteAttributeLike, builder: SourceBuilder): void {
  builder.append(' ' + stringifyAttribute(attribute));
}
