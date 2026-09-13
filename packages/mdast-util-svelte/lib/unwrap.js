/**
 * Not from upstream.
 *
 * @import {Nodes, Paragraph, Parent, PhrasingContent, Root, RootContent} from 'mdast'
 */

import {htmlBlockNames} from 'micromark-util-html-tag-name'

/**
 * Keep block-level elements out of the paragraph markdown wrapped them in.
 *
 * Markdown puts loose inline content in a `<p>`. An element that cannot live
 * inside one then ends up there anyway, and Svelte rejects the result outright:
 *
 *     text <div>x</div> more   →   <p>text <div>x</div> more</p>
 *     `</p>` attempted to close an element that was already automatically closed
 *
 * Two rules fix that, in order:
 *
 * 1. A paragraph holding nothing but block-worthy elements loses its `<p>`.
 *    `<Callout>text</Callout>` on a line of its own is a block, not a sentence.
 * 2. A paragraph holding a block-level element *among* other content is split
 *    around it, so the prose keeps its paragraphs and the element gets out:
 *    `<p>text</p><div>x</div><p>more</p>`.
 *
 * Rule 1 counts components as block-worthy; rule 2 cannot. That asymmetry is
 * the whole difficulty: what `<Button>` or shadcn's `<Card>` renders is not
 * knowable from here. Position is the only signal there is — alone on a line an
 * element reads as a block, among prose it reads as inline — and it is right
 * for the common case either way.
 *
 * It is not right for a component that renders a block and is written mid
 * sentence. Nothing here can detect that, and guessing would split
 * `Click <Button>here</Button> now` into three paragraphs. `blockElements` is
 * the way to say it out loud:
 *
 *     svmd({blockElements: ['Card', 'Alert']})
 *
 * @param {Root} tree
 * @param {ReadonlyArray<string> | null | undefined} [blockElements]
 *   Extra names to treat as block-level, for components that render one.
 * @returns {Root}
 */
export function unwrapBlockElements(tree, blockElements) {
  visit(tree, new Set(blockElements || []))
  return tree
}

/**
 * @param {Nodes} node
 * @param {Set<string>} extra
 * @returns {undefined}
 */
function visit(node, extra) {
  if (!('children' in node) || !Array.isArray(node.children)) return

  const parent = /** @type {Parent} */ (node)
  /** @type {RootContent[]} */
  const out = []

  for (const child of /** @type {RootContent[]} */ (parent.children)) {
    visit(/** @type {Nodes} */ (child), extra)

    if (child.type === 'paragraph') {
      // Rule 1: nothing but block-worthy elements.
      if (isBlockOnlyParagraph(child, extra)) {
        for (const inner of child.children) {
          if (inner.type === 'text' && inner.value.trim() === '') continue
          out.push(/** @type {RootContent} */ (inner))
        }

        continue
      }

      // Rule 2: a block-level element among other content.
      const split = splitAroundBlockElements(child, extra)

      if (split) {
        out.push(...split)
        continue
      }
    }

    out.push(child)
  }

  parent.children = /** @type {Parent['children']} */ (out)
}

/**
 * @param {Parent} node
 * @param {Set<string>} extra
 * @returns {boolean}
 */
function isBlockOnlyParagraph(node, extra) {
  let found = false

  for (const child of node.children) {
    if (child.type === 'text') {
      if (child.value.trim() !== '') return false
      continue
    }

    if (child.type !== 'svelteTextElement') return false
    if (!isBlockWorthy(child.name, extra)) return false
    found = true
  }

  return found
}

/**
 * Split a paragraph around the block-level elements inside it.
 *
 * @param {Paragraph} node
 * @param {Set<string>} extra
 * @returns {RootContent[] | undefined}
 *   `undefined` when there is nothing to split.
 */
function splitAroundBlockElements(node, extra) {
  if (!node.children.some(isBlock)) return undefined

  /** @type {RootContent[]} */
  const out = []
  /** @type {PhrasingContent[]} */
  let run = []

  for (const child of node.children) {
    if (isBlock(child)) {
      flush()
      out.push(/** @type {RootContent} */ (/** @type {unknown} */ (child)))
    } else {
      run.push(child)
    }
  }

  flush()

  return out

  /**
   * @param {Nodes} child
   * @returns {boolean}
   */
  function isBlock(child) {
    return isBlockLevelElement(child, extra)
  }

  /**
   * Turn what has been collected into a paragraph, unless it is only
   * whitespace — the space either side of the element it was split around.
   *
   * @returns {undefined}
   */
  function flush() {
    const meaningful = run.filter(function (child) {
      return child.type !== 'text' || child.value.trim() !== ''
    })

    if (meaningful.length > 0) {
      /** @type {Paragraph} */
      const paragraph = {type: 'paragraph', children: run}
      const start = run[0] && run[0].position
      const end = run[run.length - 1] && run[run.length - 1].position

      if (start && end) paragraph.position = {start: start.start, end: end.end}

      out.push(paragraph)
    }

    run = []
  }
}

/**
 * An element markdown may not keep inside a `<p>`.
 *
 * A component only counts when the author named it in `blockElements`: see the
 * note on `unwrapBlockElements`.
 *
 * @param {Nodes} node
 * @param {Set<string>} extra
 * @returns {boolean}
 */
function isBlockLevelElement(node, extra) {
  if (node.type !== 'svelteTextElement' && node.type !== 'svelteFlowElement') {
    return false
  }

  if (extra.has(node.name)) return true

  return !isComponentName(node.name) && htmlBlockNames.includes(node.name.toLowerCase())
}

/**
 * @param {string} name
 * @returns {boolean}
 */
function isComponentName(name) {
  return /^[A-Z]/.test(name) || name.includes('.') || name.includes(':')
}

/**
 * Whether an element alone on its line reads as a block.
 *
 * @param {string} name
 * @param {Set<string>} extra
 * @returns {boolean}
 */
function isBlockWorthy(name, extra) {
  return (
    extra.has(name) ||
    isComponentName(name) ||
    htmlBlockNames.includes(name.toLowerCase())
  )
}
