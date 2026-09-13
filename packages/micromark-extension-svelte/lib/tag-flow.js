/**
 * Fork of `micromark-extension-mdx-jsx` `dev/lib/jsx-flow.js`.
 * MIT, Copyright (c) Titus Wormer. See `LICENSE-upstream`.
 *
 * Changes from upstream:
 *   · `nok` is threaded into `factoryTag`, which no longer throws;
 *   · the tag info object is passed through so the mdast layer can tell a
 *     raw-text element apart without re-reading the name.
 *
 * @import {Acorn, AcornOptions} from 'micromark-util-events-to-acorn'
 * @import {Construct, State, TokenizeContext, Tokenizer} from 'micromark-util-types'
 */

import {ok as assert} from 'devlop'
import {factorySpace} from 'micromark-factory-space'
import {markdownLineEnding, markdownSpace} from 'micromark-util-character'
import {codes, types} from 'micromark-util-symbol'
import {factoryTag} from './factory-tag.js'
import {flowTagTokenTypes} from './tag-token-types.js'

/**
 * Parse a Svelte tag (flow).
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
export function tagFlow(acorn, acornOptions, rawComponents) {
  return {concrete: true, name: 'svelteTagFlow', tokenize: tokenizeTagFlow}

  /**
   * Svelte tag (flow).
   *
   * ```markdown
   * > | <A />
   *     ^^^^^
   * ```
   *
   * @this {TokenizeContext}
   * @type {Tokenizer}
   */
  function tokenizeTagFlow(effects, ok, nok) {
    const self = this
    return start

    /**
     * Start of a Svelte tag (flow).
     *
     * ```markdown
     * > | <A />
     *     ^
     * ```
     *
     * @type {State}
     */
    function start(code) {
      // To do: in `markdown-rs`, constructs need to parse the indent themselves.
      // This should also be introduced in `micromark-js`.
      assert(code === codes.lessThan, 'expected `<`')
      return before(code)
    }

    /**
     * Before the tag.
     *
     * @type {State}
     */
    function before(code) {
      return factoryTag.call(
        self,
        effects,
        after,
        nok,
        acorn,
        acornOptions,
        false,
        flowTagTokenTypes,
        rawComponents,
        true
      )(code)
    }

    /**
     * After a Svelte tag (flow).
     *
     * ```markdown
     * > | <A>
     *        ^
     * ```
     *
     * @type {State}
     */
    function after(code) {
      return markdownSpace(code)
        ? factorySpace(effects, end, types.whitespace)(code)
        : end(code)
    }

    /**
     * After a Svelte tag (flow), after optional whitespace.
     *
     * ```markdown
     * > | <A> <B>
     *         ^
     * ```
     *
     * @type {State}
     */
    function end(code) {
      // We want to allow expressions directly after tags.
      const leftBraceValue = self.parser.constructs.flow[codes.leftCurlyBrace]
      /* c8 ignore next 5 -- always a list when normalized. */
      const constructs = Array.isArray(leftBraceValue)
        ? leftBraceValue
        : leftBraceValue
          ? [leftBraceValue]
          : []
      /** @type {Construct | undefined} */
      let expression

      for (const construct of constructs) {
        if (construct.name === 'svelteExpressionFlow') {
          expression = construct
          break
        }
      }

      // Another tag.
      return code === codes.lessThan
        ? // We can’t just say: fine. Lines of blocks have to be parsed until an eol/eof.
          start(code)
        : code === codes.leftCurlyBrace && expression
          ? effects.attempt(expression, end, nok)(code)
          : code === codes.eof || markdownLineEnding(code)
            ? ok(code)
            : nok(code)
    }
  }
}
