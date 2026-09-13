/**
 * Fork of `micromark-extension-mdx-expression` `dev/lib/syntax.js`.
 * MIT, Copyright (c) Titus Wormer. See `LICENSE-upstream`.
 *
 * Changes from upstream:
 *   · `nok` is threaded through, so a `{` that does not open an expression
 *     leaves the text alone instead of crashing the build;
 *   · an `accept` rule decides what counts as an expression in running prose;
 *   · the flow construct does not interrupt a paragraph.
 *
 * @import {Program} from 'estree'
 * @import {Acorn, AcornOptions} from 'micromark-util-events-to-acorn'
 * @import {Construct, State, TokenizeContext, Tokenizer} from 'micromark-util-types'
 */

import {ok as assert} from 'devlop'
import {factorySvelteExpression} from '@svmd/micromark-factory-svelte-expression'
import {factorySpace} from 'micromark-factory-space'
import {markdownLineEnding, markdownSpace} from 'micromark-util-character'
import {codes, types} from 'micromark-util-symbol'

/**
 * Whether a balanced, valid `{…}` in running prose is meant as an expression.
 *
 * Not from upstream, where every `{…}` is an expression because MDX is a
 * programming format. Markdown is prose first: the two shapes below parse as
 * JavaScript but in a paragraph are almost always literal text.
 *
 *   `paste { "a": 1, "b": 2 } in`  →  ObjectExpression
 *   `pick {a, b} from the list`    →  SequenceExpression
 *
 * An author who really means one of those parenthesises it — `{({a: 1})}` —
 * which the factory reports separately, because `eventsToAcorn` normalises
 * parentheses out of the tree before anyone sees it.
 *
 * @param {Program | undefined} estree
 * @param {boolean} parenthesised
 * @returns {boolean}
 */
function acceptProseExpression(estree, parenthesised) {
  if (!estree) return false
  if (parenthesised) return true

  const head = estree.body[0]

  if (!head || head.type !== 'ExpressionStatement') return false

  const type = head.expression.type

  return type !== 'ObjectExpression' && type !== 'SequenceExpression'
}

/**
 * Parse a Svelte expression (flow).
 *
 * @param {Acorn} acorn
 * @param {AcornOptions} acornOptions
 * @returns {Construct}
 */
export function expressionFlow(acorn, acornOptions) {
  return {
    name: 'svelteExpressionFlow',
    tokenize: tokenizeFlowExpression,
    concrete: true
  }

  /**
   * Svelte expression (flow).
   *
   * ```markdown
   * > | {Math.PI}
   *     ^^^^^^^^^
   * ```
   *
   * @this {TokenizeContext}
   * @type {Tokenizer}
   */
  function tokenizeFlowExpression(effects, ok, nok) {
    const self = this

    return start

    /** @type {State} */
    function start(code) {
      assert(code === codes.leftCurlyBrace, 'expected `{`')

      // Change from upstream: a line holding only `{price}` directly under a
      // line of prose reads as a continuation of that paragraph to every
      // author, and the text construct renders it correctly there. Structural
      // constructs — control blocks and tags — do interrupt.
      if (self.interrupt) return nok(code)

      return before(code)
    }

    /** @type {State} */
    function before(code) {
      return factorySvelteExpression.call(
        self,
        effects,
        after,
        nok,
        'svelteExpressionFlow',
        'svelteExpressionFlowMarker',
        'svelteExpressionFlowChunk',
        acorn,
        acornOptions,
        {accept: acceptProseExpression}
      )(code)
    }

    /** @type {State} */
    function after(code) {
      return markdownSpace(code)
        ? factorySpace(effects, end, types.whitespace)(code)
        : end(code)
    }

    /**
     * After the expression, after optional whitespace.
     *
     * Upstream's rule, kept: a tag may follow an expression on the same line,
     * so `{1}<x/>` is two flow constructs rather than a paragraph.
     *
     * @type {State}
     */
    function end(code) {
      const lessThanValue = self.parser.constructs.flow[codes.lessThan]
      /* c8 ignore next 5 -- always a list when normalized. */
      const constructs = Array.isArray(lessThanValue)
        ? lessThanValue
        : lessThanValue
          ? [lessThanValue]
          : []
      /** @type {Construct | undefined} */
      let tag

      for (const construct of constructs) {
        if (construct.name === 'svelteTagFlow') {
          tag = construct
          break
        }
      }

      // Another expression.
      if (code === codes.leftCurlyBrace) {
        return before(code)
      }

      if (code === codes.lessThan && tag) {
        return effects.attempt(tag, ok, nok)(code)
      }

      return code === codes.eof || markdownLineEnding(code) ? ok(code) : nok(code)
    }
  }
}

/**
 * Parse a Svelte expression (text).
 *
 * @param {Acorn} acorn
 * @param {AcornOptions} acornOptions
 * @returns {Construct}
 */
export function expressionText(acorn, acornOptions) {
  return {name: 'svelteExpressionText', tokenize: tokenizeTextExpression}

  /**
   * Svelte expression (text).
   *
   * ```markdown
   * > | a {Math.PI} c
   *       ^^^^^^^^^
   * ```
   *
   * @this {TokenizeContext}
   * @type {Tokenizer}
   */
  function tokenizeTextExpression(effects, ok, nok) {
    const self = this

    return start

    /** @type {State} */
    function start(code) {
      assert(code === codes.leftCurlyBrace, 'expected `{`')
      return factorySvelteExpression.call(
        self,
        effects,
        ok,
        nok,
        'svelteExpressionText',
        'svelteExpressionTextMarker',
        'svelteExpressionTextChunk',
        acorn,
        acornOptions,
        {accept: acceptProseExpression}
      )(code)
    }
  }
}
