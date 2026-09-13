/**
 * Fork of `micromark-factory-mdx-expression` 2.0.3
 * (`micromark/micromark-extension-mdx-expression`, commit 2891b75).
 * MIT, Copyright (c) Titus Wormer. See `LICENSE-upstream`.
 *
 * Changes from upstream, all of them forced by the fact that in Svelte-flavoured
 * markdown a brace that does not parse is prose rather than a mistake:
 *
 *   · takes `nok` and returns it instead of throwing, everywhere. Upstream
 *     throws on end of file, on lazy lines, and on a malformed spread, because
 *     in MDX those are always authoring errors. Here micromark has to be able
 *     to backtrack so the text survives literally.
 *   · a blank line ends the attempt, so a stray `{` cannot swallow the rest of
 *     the document.
 *   · `prefix`: an optional state run after `{`, which is what lets the control
 *     block construct reuse this balancing after consuming `#if`.
 *   · agnostic mode (no acorn) understands strings, template literals and
 *     comments. Upstream counts braces naively there; Svelte needs
 *     `{#each ['}'] as x}` to work, and its block clauses are not JavaScript
 *     expressions so they cannot be validated with acorn.
 *   · `spread` accepts a shorthand property as well as a spread element,
 *     because `<C {value} />` is Svelte sugar for `value={value}`.
 *
 * @import {Program} from 'estree'
 * @import {Acorn, AcornOptions} from 'micromark-util-events-to-acorn'
 * @import {Code, Effects, Point, State, TokenType, TokenizeContext} from 'micromark-util-types'
 */

/**
 * @typedef ExpressionSignalOk
 *   Good result.
 * @property {'ok'} type
 *   Type.
 * @property {Program | undefined} estree
 *   Value.
 *
 * @typedef ExpressionSignalNok
 *   Bad result.
 * @property {'nok'} type
 *   Type.
 * @property {boolean | undefined} [swallow]
 *   Whether acorn thinks more input might still make this parse.
 *
 * @typedef {ExpressionSignalNok | ExpressionSignalOk} ExpressionSignal
 */

/**
 * @typedef Options
 *   Configuration.
 * @property {((effects: Effects, ok: State, nok: State) => State) | null | undefined} [prefix]
 *   State to run directly after `{`, before the value (optional).
 * @property {boolean | null | undefined} [spread=false]
 *   Only accept a spread (`{...a}`) or a shorthand (`{a}`) (default: `false`).
 * @property {boolean | null | undefined} [allowEmpty=false]
 *   Accept an empty expression (default: `false`).
 * @property {boolean | null | undefined} [allowLazy=false]
 *   Accept lazy continuation lines (default: `false`).
 * @property {((estree: Program | undefined, parenthesised: boolean) => boolean) | null | undefined} [accept]
 *   Last say on whether the value is an expression here (optional). Told
 *   whether the author wrapped the value in parentheses, which `eventsToAcorn`
 *   normalises away before the tree is seen.
 */

/**
 * How many lines an expression may span.
 *
 * Not from upstream. Without a bound, every `{` that never closes scans to the
 * end of its paragraph before failing, and a paragraph with many of them costs
 * O(n²). micromark bounds its own backtracking the same way — see
 * `linkResourceDestinationBalanceMax` — and an expression spanning more than
 * this many lines of prose is not an expression.
 */
const lineSpanMax = 32

import {ok as assert} from 'devlop'
import {markdownLineEnding, markdownSpace} from 'micromark-util-character'
import {eventsToAcorn} from 'micromark-util-events-to-acorn'
import {codes, types} from 'micromark-util-symbol'

/**
 * Parse a Svelte expression.
 *
 * @this {TokenizeContext}
 *   Context.
 * @param {Effects} effects
 *   Context.
 * @param {State} ok
 *   State switched to when successful.
 * @param {State} nok
 *   State switched to when the braces do not hold an expression.
 * @param {TokenType} type
 *   Token type for whole (`{}`).
 * @param {TokenType} markerType
 *   Token type for the markers (`{`, `}`).
 * @param {TokenType} chunkType
 *   Token type for the value (`1`).
 * @param {Acorn | null | undefined} [acorn]
 *   Object with `acorn.parse` and `acorn.parseExpressionAt`.
 * @param {AcornOptions | null | undefined} [acornOptions]
 *   Configuration for acorn.
 * @param {Options | null | undefined} [options]
 *   Configuration.
 * @returns {State}
 */
// eslint-disable-next-line max-params
export function factorySvelteExpression(
  effects,
  ok,
  nok,
  type,
  markerType,
  chunkType,
  acorn,
  acornOptions,
  options
) {
  const self = this
  const settings = options || {}
  const prefix = settings.prefix
  const spread = settings.spread || false
  const allowEmpty = settings.allowEmpty || false
  const allowLazy = settings.allowLazy || false
  const accept = settings.accept
  /**
   * Index of the first event holding the value. Upstream can hard-code this,
   * because nothing ever runs between `{` and the value; here a `prefix` may.
   * @type {number}
   */
  let eventStart = -1
  /** Brace depth, agnostic mode only. */
  let size = 0
  /**
   * Whether the first thing in the braces is `(`.
   *
   * `eventsToAcorn` turns on acorn's `preserveParens` and then strips every
   * `ParenthesizedExpression` back out, so by the time a caller sees the tree
   * `{({a: 1})}` and `{{a: 1}}` are the same. The difference matters here: one
   * is an author saying “yes, an object literal”, the other is pasted JSON.
   */
  let parenthesised = false
  let seenContent = false
  /** @type {Point} */
  let pointStart
  /** Line endings consumed so far, to bound backtracking. */
  let lineSpan = 0

  return start

  /**
   * Start of a Svelte expression.
   *
   * ```markdown
   * > | a {Math.PI} c
   *       ^
   * ```
   *
   * @type {State}
   */
  function start(code) {
    assert(code === codes.leftCurlyBrace, 'expected `{`')
    effects.enter(type)
    effects.enter(markerType)
    effects.consume(code)
    effects.exit(markerType)
    return prefix ? prefix(effects, atValueStart, nok) : atValueStart
  }

  /**
   * At the value, after `{` and after whatever `prefix` consumed.
   *
   * @type {State}
   */
  function atValueStart(code) {
    eventStart = self.events.length
    pointStart = self.now()
    return before(code)
  }

  /**
   * Before data.
   *
   * ```markdown
   * > | a {Math.PI} c
   *        ^
   * ```
   *
   * @type {State}
   */
  function before(code) {
    // Change from upstream: end of file is a `nok`, not a crash. The text is
    // not an expression, so it is prose.
    if (code === codes.eof) {
      return nok(code)
    }

    if (markdownLineEnding(code)) {
      if (++lineSpan > lineSpanMax) return nok(code)
      effects.enter(types.lineEnding)
      effects.consume(code)
      effects.exit(types.lineEnding)
      return eolAfter
    }

    if (code === codes.rightCurlyBrace && size === 0) {
      /** @type {ExpressionSignal} */
      const next = expressionParse.call(self)

      if (next.type === 'ok') {
        effects.enter(markerType)
        effects.consume(code)
        effects.exit(markerType)
        effects.exit(type)
        return ok
      }

      // Upstream keeps scanning here, hoping a later `}` closes a longer
      // expression, and crashes at end of file if none does. Doing that in
      // prose means one stray `{` eats the rest of the paragraph, so the scan
      // only continues while acorn says the value is merely unfinished.
      if (next.swallow) {
        effects.enter(chunkType)
        effects.consume(code)
        return inside
      }

      return nok(code)
    }

    effects.enter(chunkType)
    return inside(code)
  }

  /**
   * In data.
   *
   * ```markdown
   * > | a {Math.PI} c
   *        ^
   * ```
   *
   * @type {State}
   */
  function inside(code) {
    if (
      (code === codes.rightCurlyBrace && size === 0) ||
      code === codes.eof ||
      markdownLineEnding(code)
    ) {
      effects.exit(chunkType)
      return before(code)
    }

    // Don’t count if gnostic.
    if (code === codes.leftCurlyBrace && !acorn) {
      size += 1
    } else if (code === codes.rightCurlyBrace) {
      size -= 1
    }

    if (!seenContent && !markdownSpace(code)) {
      seenContent = true
      parenthesised = code === codes.leftParenthesis
    }

    effects.consume(code)

    // Change from upstream: in agnostic mode there is no acorn to tell strings
    // and comments apart from code, so the scanner does it, and a `}` inside
    // one of them does not close the expression.
    if (!acorn) {
      if (code === codes.quotationMark || code === codes.apostrophe) {
        return insideString(code)
      }

      if (code === codes.graveAccent) {
        return insideTemplate
      }

      if (code === codes.slash) {
        return insideSlash
      }
    }

    return inside
  }

  /**
   * In a quoted string, agnostic mode only.
   *
   * @param {NonNullable<Code>} marker
   * @returns {State}
   */
  function insideString(marker) {
    return stringInside

    /** @type {State} */
    function stringInside(code) {
      // An unterminated string cannot be an expression.
      if (code === codes.eof || markdownLineEnding(code)) {
        effects.exit(chunkType)
        return before(code)
      }

      effects.consume(code)

      if (code === codes.backslash) {
        return stringEscape
      }

      return code === marker ? inside : stringInside
    }

    /** @type {State} */
    function stringEscape(code) {
      if (code === codes.eof) {
        effects.exit(chunkType)
        return before(code)
      }

      effects.consume(code)
      return stringInside
    }
  }

  /**
   * In a template literal, agnostic mode only.
   *
   * Template literals may span lines, and `${`…`}` re-enters normal code, but
   * counting the braces of the substitution is enough for delimiting.
   *
   * @type {State}
   */
  function insideTemplate(code) {
    if (code === codes.eof) {
      effects.exit(chunkType)
      return before(code)
    }

    if (markdownLineEnding(code)) {
      effects.exit(chunkType)
      effects.enter(types.lineEnding)
      effects.consume(code)
      effects.exit(types.lineEnding)
      return templateLineEnd
    }

    effects.consume(code)

    if (code === codes.backslash) {
      return templateEscape
    }

    return code === codes.graveAccent ? inside : insideTemplate
  }

  /** @type {State} */
  function templateLineEnd(code) {
    if (code === codes.eof || markdownLineEnding(code)) {
      return nok(code)
    }

    effects.enter(chunkType)
    return insideTemplate(code)
  }

  /** @type {State} */
  function templateEscape(code) {
    if (code === codes.eof) {
      effects.exit(chunkType)
      return before(code)
    }

    effects.consume(code)
    return insideTemplate
  }

  /**
   * After `/`, agnostic mode only: a comment, or ordinary code.
   *
   * @type {State}
   */
  function insideSlash(code) {
    if (code === codes.slash) {
      effects.consume(code)
      return insideLineComment
    }

    if (code === codes.asterisk) {
      effects.consume(code)
      return insideBlockComment
    }

    return inside(code)
  }

  /** @type {State} */
  function insideLineComment(code) {
    if (code === codes.eof || markdownLineEnding(code)) {
      effects.exit(chunkType)
      return before(code)
    }

    effects.consume(code)
    return insideLineComment
  }

  /** @type {State} */
  function insideBlockComment(code) {
    if (code === codes.eof) {
      effects.exit(chunkType)
      return before(code)
    }

    if (markdownLineEnding(code)) {
      effects.exit(chunkType)
      effects.enter(types.lineEnding)
      effects.consume(code)
      effects.exit(types.lineEnding)
      return blockCommentLineEnd
    }

    effects.consume(code)
    return code === codes.asterisk ? insideBlockCommentStar : insideBlockComment
  }

  /** @type {State} */
  function blockCommentLineEnd(code) {
    if (code === codes.eof || markdownLineEnding(code)) {
      return nok(code)
    }

    effects.enter(chunkType)
    return insideBlockComment(code)
  }

  /** @type {State} */
  function insideBlockCommentStar(code) {
    if (code === codes.eof || markdownLineEnding(code)) {
      return insideBlockComment(code)
    }

    effects.consume(code)

    if (code === codes.slash) {
      return inside
    }

    return code === codes.asterisk ? insideBlockCommentStar : insideBlockComment
  }

  /**
   * After eol.
   *
   * ```markdown
   *   | a {b +
   * > | c} d
   *     ^
   * ```
   *
   * @type {State}
   */
  function eolAfter(code) {
    // Change from upstream: a blank line always ends the attempt. Markdown
    // block structure wins over anything that merely looks like a long
    // expression.
    if (code === codes.eof || markdownLineEnding(code)) {
      return nok(code)
    }

    const now = self.now()

    // Change from upstream: a lazy continuation line is a `nok`, not a crash.
    if (
      now.line !== pointStart.line &&
      !allowLazy &&
      self.parser.lazy[now.line]
    ) {
      return nok(code)
    }

    // Upstream strips up to two spaces of indentation here. Svelte expressions
    // can hold template literals, where every space is significant, and the
    // container prefix has already been consumed by the document tokenizer, so
    // there is nothing legitimate left to strip.
    return before(code)
  }

  /**
   * Hand the collected value to acorn, if there is one.
   *
   * @this {TokenizeContext}
   * @returns {ExpressionSignal}
   */
  function expressionParse() {
    if (!acorn) {
      return {type: 'ok', estree: undefined}
    }

    const result = eventsToAcorn(this.events.slice(eventStart), {
      acorn,
      tokenTypes: [chunkType],
      acornOptions,
      start: pointStart,
      expression: true,
      allowEmpty: true,
      prefix: spread ? '({' : '',
      suffix: spread ? '})' : ''
    })

    if (result.error) {
      return {type: 'nok', swallow: result.swallow}
    }

    const estree = result.estree

    // An empty expression: `{}` or `{/* comment */}`. `eventsToAcorn` parses
    // those as a program with no body rather than reporting them.
    if (!estree || estree.body.length === 0) {
      return allowEmpty ? {type: 'ok', estree: undefined} : {type: 'nok'}
    }

    if (spread && !isSpreadOrShorthand(estree)) {
      return {type: 'nok'}
    }

    if (accept && !accept(estree, parenthesised)) {
      return {type: 'nok'}
    }

    return {type: 'ok', estree}
  }
}

/**
 * Whether the program is exactly `({...a})` or `({a})`.
 *
 * Upstream only allows the spread. Svelte also has a shorthand attribute,
 * `<C {value} />`, which parses as a single shorthand property.
 *
 * @param {Program} estree
 * @returns {boolean}
 */
function isSpreadOrShorthand(estree) {
  const head = estree.body[0]

  if (
    !head ||
    head.type !== 'ExpressionStatement' ||
    head.expression.type !== 'ObjectExpression'
  ) {
    return false
  }

  const properties = head.expression.properties

  // Only a single spread or a single shorthand is supported.
  if (properties.length !== 1) {
    return false
  }

  const only = properties[0]

  return (
    only.type === 'SpreadElement' ||
    (only.type === 'Property' && only.shorthand === true)
  )
}
