/**
 * Fork of `mdast-util-mdx-jsx` 3.2.0 `lib/index.js` (commit 998d98d), merged
 * with `mdast-util-mdx-expression` 2.0.1.
 * MIT, Copyright (c) Titus Wormer. See `LICENSE-upstream`.
 *
 * What is kept from upstream, and is the reason to fork rather than start over:
 * the tag stack, the `buffer`/`resume` discipline for reading values out of the
 * event stream, and the `onEnterError`/`onExitError` hooks that turn a
 * mismatched tag into a positioned message.
 *
 * Changes from upstream:
 *   · the nodes are Svelte's, not MDX's;
 *   · attribute values are a list of literal and expression parts, because
 *     `class="a {b} c"` interpolates;
 *   · control blocks, comments and raw-text elements are handled, none of which
 *     JSX has;
 *   · errors carry the `svmd` catalogue codes so the compiler can render them
 *     with a code frame;
 *   · the `toMarkdown` half is dropped. Nothing here ever serialises back to
 *     markdown.
 *
 * @import {CompileContext, Extension, Handle as FromMarkdownHandle, OnEnterError, OnExitError, Token} from 'mdast-util-from-markdown'
 * @import {Root} from 'mdast'
 * @import {SvelteAttributeValuePart, SvelteBlock, SvelteBranch, SveltePoint, SvelteTagState} from './nodes.js'
 */

import {ok as assert} from 'devlop'
import {VFileMessage} from 'vfile-message'
import {unwrapBlockElements} from './unwrap.js'

/**
 * Which blocks each `{:…}` branch may appear in.
 *
 * @type {Record<string, Array<string>>}
 */
const branchParents = {
  else: ['if', 'each'],
  then: ['await'],
  catch: ['await']
}

/** Elements that never have a closing tag. */
const voidElements = new Set([
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
  'wbr'
])

/**
 * @typedef Options
 *   Configuration.
 * @property {ReadonlyArray<string> | null | undefined} [blockElements]
 *   Names to treat as block-level on top of the HTML ones, for components that
 *   render a block — shadcn's `Card`, say. See `unwrapBlockElements`.
 */

/**
 * Create an extension for `mdast-util-from-markdown` to enable Svelte syntax.
 *
 * @param {Options | null | undefined} [options]
 *   Configuration (optional).
 * @returns {Extension}
 */
export function svelteFromMarkdown(options) {
  const blockElements = (options || {}).blockElements

  return {
    canContainEols: ['svelteTextElement'],
    enter: {
      svelteTagFlow: enterTag,
      svelteTagFlowAttribute: enterTagAttribute,
      svelteTagFlowExpressionAttribute: enterTagExpressionAttribute,
      svelteTagFlowAttributeValueLiteral: enterAttributeValueLiteral,
      svelteTagFlowAttributeValueExpression: buffer,

      svelteTagText: enterTag,
      svelteTagTextAttribute: enterTagAttribute,
      svelteTagTextExpressionAttribute: enterTagExpressionAttribute,
      svelteTagTextAttributeValueLiteral: enterAttributeValueLiteral,
      svelteTagTextAttributeValueExpression: buffer,

      svelteExpressionFlow: enterExpression,
      svelteExpressionText: enterExpression,

      svelteBlockFlow: enterBlock,
      svelteBlockText: enterBlock,

      svelteCommentFlow: enterComment,
      svelteCommentText: enterComment
    },
    exit: {
      svelteTagFlowClosingMarker: exitTagClosingMarker,
      svelteTagFlowSelfClosingMarker: exitTagSelfClosingMarker,
      svelteTagFlowAttributeNamePrimary: exitTagAttributeNamePrimary,
      svelteTagFlowAttributeNameLocal: exitTagAttributeNameLocal,
      svelteTagFlowExpressionAttributeValue: data,
      svelteTagFlowExpressionAttribute: exitTagExpressionAttribute,
      svelteTagFlowAttributeValueLiteralMarker: exitAttributeValueLiteralMarker,
      svelteTagFlowAttributeValueLiteralValue: exitAttributeValueLiteralValue,
      svelteTagFlowAttributeValueExpressionValue: data,
      svelteTagFlowAttributeValueExpression: exitAttributeValueExpression,
      svelteTagFlowAttributeValueLiteral: exitAttributeValueLiteral,
      svelteTagFlow: exitTag,

      svelteTagTextClosingMarker: exitTagClosingMarker,
      svelteTagTextSelfClosingMarker: exitTagSelfClosingMarker,
      svelteTagTextAttributeNamePrimary: exitTagAttributeNamePrimary,
      svelteTagTextAttributeNameLocal: exitTagAttributeNameLocal,
      svelteTagTextExpressionAttributeValue: data,
      svelteTagTextExpressionAttribute: exitTagExpressionAttribute,
      svelteTagTextAttributeValueLiteralMarker: exitAttributeValueLiteralMarker,
      svelteTagTextAttributeValueLiteralValue: exitAttributeValueLiteralValue,
      svelteTagTextAttributeValueExpressionValue: data,
      svelteTagTextAttributeValueExpression: exitAttributeValueExpression,
      svelteTagTextAttributeValueLiteral: exitAttributeValueLiteral,
      svelteTagText: exitTag,

      svelteExpressionFlowChunk: data,
      svelteExpressionFlow: exitExpression,
      svelteExpressionTextChunk: data,
      svelteExpressionText: exitExpression,

      svelteBlockFlowMarker: exitBlockMarker,
      svelteBlockFlowName: exitBlockName,
      svelteBlockFlowChunk: data,
      svelteBlockFlow: exitBlock,
      svelteBlockTextMarker: exitBlockMarker,
      svelteBlockTextName: exitBlockName,
      svelteBlockTextChunk: data,
      svelteBlockText: exitBlock,

      svelteCommentFlowChunk: data,
      svelteCommentFlow: exitComment,
      svelteCommentTextChunk: data,
      svelteCommentText: exitComment
    },
    transforms: [
      /** @param {Root} tree */
      function (tree) {
        unwrapBlockElements(tree, blockElements)
      }
    ]
  }
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function buffer() {
  this.buffer()
}

/**
 * Copy a point-like value.
 *
 * @param {SveltePoint} d
 * @returns {SveltePoint}
 */
function point(d) {
  return {line: d.line, column: d.column, offset: d.offset}
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function data(token) {
  this.config.enter.data.call(this, token)
  this.config.exit.data.call(this, token)
}

/**
 * Raise a positioned diagnostic the compiler knows how to render.
 *
 * @param {string} code
 * @param {string} reason
 * @param {string} hint
 * @param {{start: SveltePoint, end: SveltePoint} | undefined} place
 * @returns {never}
 */
function fail(code, reason, hint, place) {
  const message = new VFileMessage(reason, {
    place,
    ruleId: code,
    source: 'svmd'
  })
  Object.assign(message, {hint})
  throw message
}

// ── Tags ───────────────────────────────────────────────────────────────────

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function enterTag(token) {
  const info = token._svelteTag
  assert(info, 'expected `_svelteTag`')

  /** @type {SvelteTagState} */
  const tag = {
    name: info.name,
    attributes: [],
    close: info.close,
    selfClosing: info.selfClosing,
    start: token.start,
    end: token.end
  }

  if (!this.data.svelteTagStack) this.data.svelteTagStack = []
  this.data.svelteTag = tag
  this.buffer()
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function enterTagAttribute(token) {
  const tag = this.data.svelteTag
  assert(tag, 'expected `svelteTag`')

  if (tag.close) {
    fail(
      'E005',
      'Unexpected attribute in closing tag `</' + tag.name + '>`',
      'A closing tag holds nothing but its name.',
      {start: token.start, end: token.end}
    )
  }

  tag.attributes.push({
    type: 'svelteAttribute',
    name: '',
    quote: null,
    value: null,
    shorthand: false,
    position: {start: point(token.start), end: point(token.end)}
  })
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function enterTagExpressionAttribute(token) {
  const tag = this.data.svelteTag
  assert(tag, 'expected `svelteTag`')

  if (tag.close) {
    fail(
      'E005',
      'Unexpected attribute in closing tag `</' + tag.name + '>`',
      'A closing tag holds nothing but its name.',
      {start: token.start, end: token.end}
    )
  }

  // Whether this is `{...rest}` or the `{value}` shorthand is decided on exit,
  // once the text is known.
  tag.attributes.push({
    type: 'svelteAttribute',
    name: '',
    quote: null,
    value: null,
    shorthand: true,
    position: {start: point(token.start), end: point(token.end)}
  })
  this.buffer()
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitTagExpressionAttribute(token) {
  const tag = this.data.svelteTag
  assert(tag, 'expected `svelteTag`')
  const tail = tag.attributes[tag.attributes.length - 1]
  const value = this.resume().trim()

  if (value.startsWith('...')) {
    tag.attributes[tag.attributes.length - 1] = {
      type: 'svelteSpreadAttribute',
      value: value.slice(3).trim(),
      position: {start: point(token.start), end: point(token.end)}
    }
    return
  }

  assert(tail.type === 'svelteAttribute')
  tail.name = value
  tail.value = [{type: 'expression', value}]
  assert(tail.position, 'expected `position`')
  tail.position.end = point(token.end)
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitTagClosingMarker() {
  const tag = this.data.svelteTag
  assert(tag, 'expected `svelteTag`')
  tag.close = true
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitTagSelfClosingMarker() {
  const tag = this.data.svelteTag
  assert(tag, 'expected `svelteTag`')
  tag.selfClosing = true
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitTagAttributeNamePrimary(token) {
  const tag = this.data.svelteTag
  assert(tag, 'expected `svelteTag`')
  const node = tag.attributes[tag.attributes.length - 1]
  assert(node.type === 'svelteAttribute')
  node.name = this.sliceSerialize(token)
  assert(node.position, 'expected `position`')
  node.position.end = point(token.end)
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitTagAttributeNameLocal(token) {
  const tag = this.data.svelteTag
  assert(tag, 'expected `svelteTag`')
  const node = tag.attributes[tag.attributes.length - 1]
  assert(node.type === 'svelteAttribute')
  // The name is kept verbatim, directive and modifiers included, because that
  // is what has to come back out: `transition:fade|local` is one name.
  node.name += ':' + this.sliceSerialize(token)
  assert(node.position, 'expected `position`')
  node.position.end = point(token.end)
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function enterAttributeValueLiteral() {
  const tag = this.data.svelteTag
  assert(tag, 'expected `svelteTag`')
  const node = tag.attributes[tag.attributes.length - 1]
  assert(node.type === 'svelteAttribute')
  node.value = []
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitAttributeValueLiteralMarker(token) {
  const tag = this.data.svelteTag
  assert(tag, 'expected `svelteTag`')
  const node = tag.attributes[tag.attributes.length - 1]
  assert(node.type === 'svelteAttribute')
  const marker = this.sliceSerialize(token)
  if (marker === '"' || marker === "'") node.quote = marker
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitAttributeValueLiteralValue(token) {
  const tag = this.data.svelteTag
  assert(tag, 'expected `svelteTag`')
  const node = tag.attributes[tag.attributes.length - 1]
  assert(node.type === 'svelteAttribute')
  assert(node.value)
  node.value.push({type: 'text', value: this.sliceSerialize(token)})
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitAttributeValueExpression(token) {
  const tag = this.data.svelteTag
  assert(tag, 'expected `svelteTag`')
  const node = tag.attributes[tag.attributes.length - 1]
  assert(node.type === 'svelteAttribute')
  /** @type {SvelteAttributeValuePart} */
  const part = {type: 'expression', value: this.resume()}

  // Either a lone `attr={x}`, or one part of `attr="a {x} b"`.
  if (node.value) {
    node.value.push(part)
  } else {
    node.value = [part]
  }

  assert(node.position, 'expected `position`')
  node.position.end = point(token.end)
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitAttributeValueLiteral(token) {
  const tag = this.data.svelteTag
  assert(tag, 'expected `svelteTag`')
  const node = tag.attributes[tag.attributes.length - 1]
  assert(node.type === 'svelteAttribute')
  assert(node.position, 'expected `position`')
  node.position.end = point(token.end)
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitTag(token) {
  const tag = this.data.svelteTag
  assert(tag, 'expected `svelteTag`')
  const stack = this.data.svelteTagStack
  assert(stack, 'expected `svelteTagStack`')
  const tail = stack[stack.length - 1]
  const info = token._svelteTag
  assert(info, 'expected `_svelteTag`')

  if (tag.close && (!tail || tail.name !== tag.name)) {
    fail(
      'E005',
      tail
        ? 'Unexpected closing tag `</' +
            tag.name +
            '>`, expected `</' +
            tail.name +
            '>` to close first'
        : 'Unexpected closing tag `</' + tag.name + '>`, no matching opening tag',
      tail
        ? 'Blocks and elements must nest: close the inner one before the outer one.'
        : 'Remove it, or open the element with `<' + tag.name + '>` first.',
      {start: token.start, end: token.end}
    )
  }

  // End of a tag, so drop the buffer that swallowed the attribute text.
  this.resume()

  if (info.raw) {
    const value =
      info.rawStart && info.rawEnd
        ? // Not a real token: `sliceSerialize` only needs the two points, and
          // the content deliberately has none of its own.
          this.sliceSerialize({start: info.rawStart, end: info.rawEnd})
        : ''
    const lower = tag.name.toLowerCase()

    // `<script>` and `<style>` are hoisted: a component has one of each.
    if (lower === 'script' || lower === 'style') {
      this.enter(
        {
          type: lower === 'script' ? 'svelteScript' : 'svelteStyle',
          value,
          attributes: tag.attributes,
          valueStart: point(info.rawStart || token.start)
        },
        token
      )
      this.exit(token)
      return
    }

    // A component the author opted out of markdown for. It stays where it was
    // written, holding its content verbatim for Svelte to parse.
    this.enter(
      {
        type: token.type === 'svelteTagText' ? 'svelteTextElement' : 'svelteFlowElement',
        name: tag.name,
        attributes: tag.attributes,
        selfClosing: false,
        children: [
          {
            type: 'svelteRaw',
            value,
            ...(info.rawStart && info.rawEnd
              ? {position: {start: point(info.rawStart), end: point(info.rawEnd)}}
              : {})
          }
        ]
      },
      token
    )
    this.exit(token)
    return
  }

  if (tag.close) {
    stack.pop()
  } else {
    this.enter(
      {
        type:
          token.type === 'svelteTagText'
            ? 'svelteTextElement'
            : 'svelteFlowElement',
        name: tag.name,
        attributes: tag.attributes,
        selfClosing: tag.selfClosing,
        children: []
      },
      token,
      onErrorRightIsTag
    )
  }

  // A void element never has children, even written as `<br>`.
  if (tag.selfClosing || tag.close || voidElements.has(tag.name.toLowerCase())) {
    this.exit(token, onErrorLeftIsTag)
  } else {
    stack.push(tag)
  }
}

/**
 * @this {CompileContext}
 * @type {OnEnterError}
 */
function onErrorRightIsTag(closing, open) {
  const stack = this.data.svelteTagStack
  assert(stack, 'expected `svelteTagStack`')
  const tag = stack[stack.length - 1]

  fail(
    'E005',
    'Unclosed element `<' + (tag ? tag.name : '') + '>`',
    'Add a matching `</' + (tag ? tag.name : '') + '>` on its own line.',
    tag ? {start: tag.start, end: tag.end} : {start: open.start, end: open.end}
  )
}

/**
 * @this {CompileContext}
 * @type {OnExitError}
 */
function onErrorLeftIsTag(a, b) {
  const tag = this.data.svelteTag
  assert(tag, 'expected `svelteTag`')

  fail(
    'E005',
    'Unexpected closing tag `</' +
      tag.name +
      '>`, expected the end of `' +
      b.type +
      '` first',
    'Blocks and elements must nest: close the inner one before the outer one.',
    {start: a.start, end: a.end}
  )
}

// ── Expressions ────────────────────────────────────────────────────────────

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function enterExpression(token) {
  this.enter(
    {
      type:
        token.type === 'svelteExpressionText'
          ? 'svelteTextExpression'
          : 'svelteFlowExpression',
      value: ''
    },
    token
  )
  this.buffer()
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitExpression(token) {
  const value = this.resume()
  const node = this.stack[this.stack.length - 1]
  assert(node.type === 'svelteFlowExpression' || node.type === 'svelteTextExpression')
  node.value = value
  this.exit(token)
}

// ── Control blocks ─────────────────────────────────────────────────────────

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function enterBlock() {
  this.data.svelteBlockMarker = ''
  this.data.svelteBlockName = ''
  if (!this.data.svelteBlockStack) this.data.svelteBlockStack = []
  this.buffer()
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitBlockMarker(token) {
  const value = this.sliceSerialize(token)

  // The `{` and `}` come through here too; only `#`, `:`, `/` and `@` matter.
  if (value === '#' || value === ':' || value === '/' || value === '@') {
    this.data.svelteBlockMarker = value
  }
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitBlockName(token) {
  this.data.svelteBlockName = this.sliceSerialize(token)
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitBlock(token) {
  const marker = this.data.svelteBlockMarker
  const name = this.data.svelteBlockName
  const stack = this.data.svelteBlockStack
  assert(marker !== undefined, 'expected `svelteBlockMarker`')
  assert(name !== undefined, 'expected `svelteBlockName`')
  assert(stack, 'expected `svelteBlockStack`')
  const value = this.resume().trim()
  const place = {start: token.start, end: token.end}

  // `{@html …}`, `{@const …}`, `{@render …}`: leaves, part of no structure.
  if (marker === '@') {
    this.enter(
      {
        type: token.type === 'svelteBlockText' ? 'svelteTextTag' : 'svelteFlowTag',
        name,
        value
      },
      token
    )
    this.exit(token)
    return
  }

  if (marker === '#') {
    /** @type {SvelteBlock} */
    const block = {type: 'svelteBlock', name, children: []}
    /** @type {SvelteBranch} */
    const branch = {type: 'svelteBranch', marker: '#' + name, value, children: []}
    this.enter(block, token, onErrorUnclosedBlock)
    this.enter(branch, token, onErrorUnclosedBlock)
    stack.push({name, start: point(token.start)})
    return
  }

  const open = stack[stack.length - 1]

  if (marker === ':') {
    const allowed = branchParents[name] || []

    if (!open) {
      fail(
        'E003',
        'Unexpected `{:' + name + '}` outside of a block',
        '`{:' +
          name +
          '}` belongs to ' +
          allowed.map(function (/** @type {string} */ d) {
            return '`{#' + d + '}`'
          }).join(' or ') +
          '.',
        place
      )
    }

    if (!allowed.includes(open.name)) {
      fail(
        'E003',
        'Unexpected `{:' + name + '}` inside `{#' + open.name + '}`',
        '`{:' +
          name +
          '}` belongs to ' +
          allowed.map(function (/** @type {string} */ d) {
            return '`{#' + d + '}`'
          }).join(' or ') +
          '.',
        place
      )
    }

    this.exit(token, onErrorCrossedBlock)
    /** @type {SvelteBranch} */
    const branch = {type: 'svelteBranch', marker: ':' + name, value, children: []}
    this.enter(branch, token, onErrorUnclosedBlock)
    return
  }

  // marker === '/'
  if (!open) {
    fail(
      'E002',
      'Unexpected `{/' + name + '}`, no matching `{#' + name + '}`',
      'Remove it, or open the block first.',
      place
    )
  }

  if (open.name !== name) {
    fail(
      'E003',
      'Unexpected `{/' + name + '}`, expected `{/' + open.name + '}` to close first',
      'Blocks and elements must nest: close the inner one before the outer one.',
      place
    )
  }

  // Close the branch, then the block.
  this.exit(token, onErrorCrossedBlock)
  this.exit(token, onErrorCrossedBlock)
  stack.pop()
}

/**
 * @this {CompileContext}
 * @type {OnEnterError}
 */
function onErrorUnclosedBlock(_closing, open) {
  const stack = this.data.svelteBlockStack
  const frame = stack && stack[stack.length - 1]

  fail(
    'E001',
    'Unclosed block `{#' + (frame ? frame.name : '') + '}`',
    'Add a matching `{/' + (frame ? frame.name : '') + '}` on its own line.',
    frame ? {start: frame.start, end: frame.start} : {start: open.start, end: open.end}
  )
}

/**
 * @this {CompileContext}
 * @type {OnExitError}
 */
function onErrorCrossedBlock(a, b) {
  const stack = this.data.svelteTagStack
  const tag = stack && stack[stack.length - 1]

  fail(
    'E003',
    'Unexpected block close, expected ' +
      (tag ? '`</' + tag.name + '>`' : '`' + b.type + '`') +
      ' to close first',
    'Blocks and elements must nest: close the inner one before the outer one.',
    {start: a.start, end: a.end}
  )
}

// ── Comments ───────────────────────────────────────────────────────────────

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function enterComment(token) {
  this.enter({type: 'svelteComment', value: ''}, token)
  this.buffer()
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitComment(token) {
  const raw = this.resume()
  const node = this.stack[this.stack.length - 1]
  assert(node.type === 'svelteComment')
  // The chunk tokens hold `<!--` and `-->` too; the value is what is between.
  node.value = raw.replace(/^<!--/, '').replace(/-->$/, '')
  this.exit(token)
}
