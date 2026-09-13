/**
 * Fork of `micromark-extension-mdx-jsx` `dev/lib/jsx-text.js`.
 * MIT, Copyright (c) Titus Wormer. See `LICENSE-upstream`.
 *
 * Changes from upstream: `nok` is threaded into `factoryTag`, and the
 * twenty-five positional token types became one object.
 *
 * @import {Acorn, AcornOptions} from 'micromark-util-events-to-acorn'
 * @import {Construct, TokenizeContext, Tokenizer} from 'micromark-util-types'
 */

import {factoryTag} from './factory-tag.js'
import {textTagTokenTypes} from './tag-token-types.js'

/**
 * Parse a Svelte tag (text).
 *
 * @param {Acorn} acorn
 *   Acorn parser to use.
 * @param {AcornOptions} acornOptions
 *   Configuration for acorn.
 * @param {ReadonlySet<string>} rawComponents
 *   Components that hold their own content.
 * @returns {Construct}
 *   Construct.
 */
export function tagText(acorn, acornOptions, rawComponents) {
  return {name: 'svelteTagText', tokenize: tokenizeTagText}

  /**
   * Svelte tag (text).
   *
   * ```markdown
   * > | a <b />.
   *       ^^^^^
   * ```
   *
   * @this {TokenizeContext}
   * @type {Tokenizer}
   */
  function tokenizeTagText(effects, ok, nok) {
    return factoryTag.call(
      this,
      effects,
      ok,
      nok,
      acorn,
      acornOptions,
      true,
      textTagTokenTypes,
      rawComponents,
      false
    )
  }
}
