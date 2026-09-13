/**
 * Fork of `micromark-extension-mdx-jsx` `dev/lib/syntax.js`, merged with the
 * equivalent from `micromark-extension-mdx-expression`.
 * MIT, Copyright (c) Titus Wormer. See `LICENSE-upstream`.
 *
 * Changes from upstream:
 *   · acorn is required rather than optional, and defaults to the bundled one.
 *     An agnostic mode makes sense for MDX, which has other ways to tell code
 *     from prose; here acorn is the only thing that can;
 *   · control blocks, comments and raw-text elements are added;
 *   · CommonMark's own HTML constructs are switched off, because the tag
 *     construct replaces them with one that parses markdown inside elements.
 *
 * @import {Acorn, AcornOptions} from 'micromark-util-events-to-acorn'
 * @import {Extension} from 'micromark-util-types'
 * @import {Options} from './options.js'
 */

import * as defaultAcorn from 'acorn'
import {codes} from 'micromark-util-symbol'
import {blockFlow, blockText} from './block.js'
import {commentFlow, commentText} from './comment.js'
import {expressionFlow, expressionText} from './expression.js'
import {tagFlow} from './tag-flow.js'
import {tagText} from './tag-text.js'

/**
 * Create an extension for `micromark` to enable Svelte syntax.
 *
 * @param {Options | null | undefined} [options]
 *   Configuration (optional).
 * @returns {Extension}
 *   Extension for `micromark` that can be passed in `extensions`.
 */
export function svelteSyntax(options) {
  const settings = options || {}
  const acorn = settings.acorn || /** @type {Acorn} */ (defaultAcorn)

  if (!acorn.parse || !acorn.parseExpressionAt) {
    throw new Error(
      'Expected a proper `acorn` instance passed in as `options.acorn`'
    )
  }

  const rawComponents = new Set(settings.rawComponents || [])

  /** @type {AcornOptions} */
  const acornOptions = Object.assign(
    {ecmaVersion: 2024, sourceType: 'module'},
    settings.acornOptions,
    {locations: true}
  )

  return {
    flow: {
      // Order matters: the comment construct has to win over the tag
      // construct, and the block construct over the expression construct.
      [codes.lessThan]: [commentFlow, tagFlow(acorn, acornOptions, rawComponents)],
      [codes.leftCurlyBrace]: [blockFlow, expressionFlow(acorn, acornOptions)]
    },
    text: {
      [codes.lessThan]: [commentText, tagText(acorn, acornOptions, rawComponents)],
      [codes.leftCurlyBrace]: [blockText, expressionText(acorn, acornOptions)]
    },
    // The tag construct replaces raw HTML entirely. While CommonMark's rule is
    // active, `<div>` swallows markdown until the next blank line, which is the
    // root of “markdown does not work inside my components”.
    disable: {null: ['htmlFlow', 'htmlText']}
  }
}
