/**
 * Fork of `micromark-extension-mdx-jsx` 3.0.2 `dev/lib/factory-tag.js`
 * (commit ad0a49c). MIT, Copyright (c) Titus Wormer. See `LICENSE-upstream`.
 *
 * The states below are upstream's, in upstream's order, with upstream's names
 * and documentation comments. Every difference is marked with a
 * `Change from upstream:` comment, and summarised here:
 *
 *   · `crash()` became `fail()`, which returns `nok` instead of throwing.
 *     Upstream is right to crash: in MDX a `<` that is not a tag is a mistake.
 *     Here it is prose — `a < b` has to survive — and the escaping policy rests
 *     on micromark being able to backtrack.
 *   · attribute names accept `-` anywhere including first, and `|` modifiers,
 *     for `transition:fade|local`, `--accent` and `data-id`.
 *   · attribute values may be unquoted, as HTML and Svelte allow.
 *   · quoted attribute values may hold `{expression}` parts.
 *   · `<script>` and `<style>` switch to raw text after the opening tag.
 *   · fragments (`<>`) are rejected; Svelte has none.
 *   · the 25 positional token-type parameters became one object, and `addResult`
 *     and the estree plumbing are gone: expressions are re-emitted verbatim, so
 *     nothing downstream needs the AST.
 *
 * @import {Acorn, AcornOptions} from 'micromark-util-events-to-acorn'
 * @import {Code, Construct, Effects, State, TokenizeContext, Tokenizer} from 'micromark-util-types'
 * @import {TagInfo, TagTokenTypes} from './tag-token-types.js'
 */

import {ok as assert} from 'devlop'
import {factorySvelteExpression} from '@svmd/micromark-factory-svelte-expression'
import {cont as idCont, start as idStart} from 'estree-util-is-identifier-name'
import {
  markdownLineEndingOrSpace,
  markdownLineEnding,
  markdownSpace,
  unicodeWhitespace
} from 'micromark-util-character'
import {codes} from 'micromark-util-symbol'
import {factoryRawText} from './factory-raw-text.js'

/**
 * Elements whose content is raw text rather than markdown, because what is
 * inside them is JavaScript or CSS.
 */
const rawTextElements = new Set(['script', 'style'])

/**
 * Whether this tag's content should be handed to Svelte untouched.
 *
 * `<script>` and `<style>` always, because what is inside them is JavaScript
 * and CSS. A component only when the author said so: markdown inside a
 * component is the point of the project, and a component that would rather
 * handle its own children — a code sample, an editor, anything that cares
 * about whitespace — says so once in the configuration rather than at every
 * use site.
 *
 * @param {string} name
 * @param {ReadonlySet<string>} raw
 * @returns {boolean}
 */
function holdsRawContent(name, raw) {
  return rawTextElements.has(name.toLowerCase()) || raw.has(name)
}

/**
 * Lookahead for the `/>` that ends a self-closing tag.
 *
 * Not from upstream. Needed because an unquoted attribute value may contain
 * `/`, as in `href=/docs`, and micromark cannot take a character back once it
 * has been consumed.
 *
 * @type {Construct}
 */
const selfClosingAhead = {partial: true, tokenize: tokenizeSelfClosingAhead}

/**
 * @this {TokenizeContext}
 * @type {Tokenizer}
 */
function tokenizeSelfClosingAhead(effects, ok, nok) {
  return start

  /** @type {State} */
  function start(code) {
    if (code !== codes.slash) return nok(code)
    effects.enter('esWhitespace')
    effects.consume(code)
    effects.exit('esWhitespace')
    return after
  }

  /** @type {State} */
  function after(code) {
    return code === codes.greaterThan ? ok(code) : nok(code)
  }
}

/**
 * Whether `code` can start an attribute name.
 *
 * Change from upstream: `-` is allowed, so that `--accent="#f00"` parses.
 *
 * @param {Code} code
 * @returns {boolean}
 */
function attributeNameStart(code) {
  return code !== codes.eof && code >= 0 && (idStart(code) || code === codes.dash)
}

/**
 * Whether `code` can continue an attribute name.
 *
 * Change from upstream: `|` is allowed, so that a directive keeps its
 * modifiers — `transition:fade|local` is one name, not a name and a syntax
 * error.
 *
 * @param {Code} code
 * @returns {boolean}
 */
function attributeNameCont(code) {
  return (
    code !== codes.eof &&
    code >= 0 &&
    (idCont(code, {jsx: true}) || code === codes.verticalBar)
  )
}

/**
 * Whether `code` ends an unquoted attribute value.
 *
 * Not from upstream, which has no unquoted values. These are the HTML rules;
 * `/` is handled separately because of the `/>` ambiguity.
 *
 * @param {Code} code
 * @returns {boolean}
 */
function unquotedValueEnd(code) {
  return (
    code === codes.eof ||
    markdownLineEndingOrSpace(code) ||
    unicodeWhitespace(code) ||
    code === codes.greaterThan ||
    code === codes.quotationMark ||
    code === codes.apostrophe ||
    code === codes.equalsTo ||
    code === codes.lessThan ||
    code === codes.graveAccent
  )
}

/**
 * @this {TokenizeContext}
 *   Context.
 * @param {Effects} effects
 *   Context.
 * @param {State} ok
 *   State switched to when successful.
 * @param {State} nok
 *   State switched to when this is not a tag after all.
 * @param {Acorn} acorn
 *   Object with `acorn.parse` and `acorn.parseExpressionAt`.
 * @param {AcornOptions} acornOptions
 *   Configuration for acorn.
 * @param {boolean} allowLazy
 *   Whether lazy continuation lines are allowed.
 * @param {TagTokenTypes} tokenTypes
 *   Token types to emit.
 * @param {ReadonlySet<string>} rawComponents
 *   Components that hold their own content.
 * @param {boolean} flow
 *   Whether this is the flow context, where `<script>` and `<style>` are
 *   allowed at all.
 * @returns {State}
 */
// eslint-disable-next-line max-params
export function factoryTag(
  effects,
  ok,
  nok,
  acorn,
  acornOptions,
  allowLazy,
  tokenTypes,
  rawComponents,
  flow
) {
  const self = this
  /**
   * What was read, attached to the tag token on exit.
   *
   * Change from upstream, which attaches an `estree` the same way when
   * `addResult` is on. The mdast layer reads the name and the shape of the tag
   * from here rather than reassembling them from the event stream.
   *
   * @type {TagInfo}
   */
  const info = {
    name: '',
    close: false,
    selfClosing: false,
    raw: false,
    rawStart: undefined,
    rawEnd: undefined
  }
  /** @type {State} */
  let returnState
  /** @type {NonNullable<Code> | undefined} */
  let marker

  return start

  /**
   * Start of Svelte: tag.
   *
   * ```markdown
   * > | a <B /> c
   *       ^
   * ```
   *
   * @type {State}
   */
  function start(code) {
    assert(code === codes.lessThan, 'expected `<`')
    effects.enter(tokenTypes.tag)
    effects.enter(tokenTypes.tagMarker)
    effects.consume(code)
    effects.exit(tokenTypes.tagMarker)
    return startAfter
  }

  /**
   * After `<`.
   *
   * ```markdown
   * > | a <B /> c
   *        ^
   * ```
   *
   * @type {State}
   */
  function startAfter(code) {
    // Deviate from JSX, which allows arbitrary whitespace.
    // See: <https://github.com/micromark/micromark-extension-mdx-jsx/issues/7>.
    if (markdownLineEndingOrSpace(code)) {
      return nok(code)
    }

    // Any other ES whitespace does not get this treatment.
    returnState = nameBefore
    return esWhitespaceStart(code)
  }

  /**
   * Before name or self slash.
   *
   * ```markdown
   * > | a <B> c
   *        ^
   * > | a </B> c
   *        ^
   * ```
   *
   * @type {State}
   */
  function nameBefore(code) {
    // Closing tag.
    if (code === codes.slash) {
      effects.enter(tokenTypes.tagClosingMarker)
      effects.consume(code)
      effects.exit(tokenTypes.tagClosingMarker)
      info.close = true
      returnState = closingTagNameBefore
      return esWhitespaceStart
    }

    // Change from upstream: no fragments. `<>` is not Svelte, and
    // `<svelte:fragment>` is an ordinary name.

    // Start of a name.
    if (code !== codes.eof && code >= 0 && idStart(code)) {
      effects.enter(tokenTypes.tagName)
      effects.enter(tokenTypes.tagNamePrimary)
      effects.consume(code)
      return primaryName
    }

    return fail(code)
  }

  /**
   * Before name of closing tag.
   *
   * ```markdown
   * > | a </B> c
   *         ^
   * ```
   *
   * @type {State}
   */
  function closingTagNameBefore(code) {
    // Start of a closing tag name.
    if (code !== codes.eof && code >= 0 && idStart(code)) {
      effects.enter(tokenTypes.tagName)
      effects.enter(tokenTypes.tagNamePrimary)
      effects.consume(code)
      return primaryName
    }

    return fail(code)
  }

  /**
   * In primary name.
   *
   * ```markdown
   * > | a <Bc> d
   *         ^
   * ```
   *
   * @type {State}
   */
  function primaryName(code) {
    // Continuation of name: remain.
    if (code !== codes.eof && code >= 0 && idCont(code, {jsx: true})) {
      effects.consume(code)
      return primaryName
    }

    // End of name.
    if (
      code === codes.dot ||
      code === codes.slash ||
      code === codes.colon ||
      code === codes.greaterThan ||
      code === codes.leftCurlyBrace ||
      markdownLineEndingOrSpace(code) ||
      unicodeWhitespace(code)
    ) {
      info.name += self.sliceSerialize(effects.exit(tokenTypes.tagNamePrimary))

      // A raw-text element only makes sense as a block: Svelte rejects either
      // element anywhere but the top level. A component inline is fine — it
      // just holds its content the same way.
      if (!flow && rawTextElements.has(info.name.toLowerCase())) {
        return fail(code)
      }

      returnState = primaryNameAfter
      return esWhitespaceStart(code)
    }

    return fail(code)
  }

  /**
   * After primary name.
   *
   * ```markdown
   * > | a <b.c> d
   *         ^
   * > | a <b:c> d
   *         ^
   * ```
   *
   * @type {State}
   */
  function primaryNameAfter(code) {
    // Start of a member name.
    if (code === codes.dot) {
      effects.enter(tokenTypes.tagNameMemberMarker)
      effects.consume(code)
      effects.exit(tokenTypes.tagNameMemberMarker)
      info.name += '.'
      returnState = memberNameBefore
      return esWhitespaceStart
    }

    // Start of a local name.
    if (code === codes.colon) {
      effects.enter(tokenTypes.tagNamePrefixMarker)
      effects.consume(code)
      effects.exit(tokenTypes.tagNamePrefixMarker)
      info.name += ':'
      returnState = localNameBefore
      return esWhitespaceStart
    }

    // End of name.
    if (
      code === codes.slash ||
      code === codes.greaterThan ||
      code === codes.leftCurlyBrace ||
      attributeNameStart(code)
    ) {
      effects.exit(tokenTypes.tagName)
      return attributeBefore(code)
    }

    return fail(code)
  }

  /**
   * Before member name.
   *
   * ```markdown
   * > | a <b.c> d
   *          ^
   * ```
   *
   * @type {State}
   */
  function memberNameBefore(code) {
    // Start of a member name.
    if (code !== codes.eof && code >= 0 && idStart(code)) {
      effects.enter(tokenTypes.tagNameMember)
      effects.consume(code)
      return memberName
    }

    return fail(code)
  }

  /**
   * In member name.
   *
   * ```markdown
   * > | a <b.cd> e
   *           ^
   * ```
   *
   * @type {State}
   */
  function memberName(code) {
    // Continuation of name: remain.
    if (code !== codes.eof && code >= 0 && idCont(code, {jsx: true})) {
      effects.consume(code)
      return memberName
    }

    // End of name.
    // Note: no `:` allowed here.
    if (
      code === codes.dot ||
      code === codes.slash ||
      code === codes.greaterThan ||
      code === codes.leftCurlyBrace ||
      markdownLineEndingOrSpace(code) ||
      unicodeWhitespace(code)
    ) {
      info.name += self.sliceSerialize(effects.exit(tokenTypes.tagNameMember))
      returnState = memberNameAfter
      return esWhitespaceStart(code)
    }

    return fail(code)
  }

  /**
   * After member name.
   *
   * ```markdown
   * > | a <b.c> d
   *           ^
   * > | a <b.c.d> e
   *           ^
   * ```
   *
   * @type {State}
   */
  function memberNameAfter(code) {
    // Start another member name.
    if (code === codes.dot) {
      effects.enter(tokenTypes.tagNameMemberMarker)
      effects.consume(code)
      effects.exit(tokenTypes.tagNameMemberMarker)
      info.name += '.'
      returnState = memberNameBefore
      return esWhitespaceStart
    }

    // End of name.
    if (
      code === codes.slash ||
      code === codes.greaterThan ||
      code === codes.leftCurlyBrace ||
      attributeNameStart(code)
    ) {
      effects.exit(tokenTypes.tagName)
      return attributeBefore(code)
    }

    return fail(code)
  }

  /**
   * Local member name.
   *
   * ```markdown
   * > | a <b:c> d
   *          ^
   * ```
   *
   * @type {State}
   */
  function localNameBefore(code) {
    // Start of a local name.
    if (code !== codes.eof && code >= 0 && idStart(code)) {
      effects.enter(tokenTypes.tagNameLocal)
      effects.consume(code)
      return localName
    }

    return fail(code)
  }

  /**
   * In local name.
   *
   * ```markdown
   * > | a <b:cd> e
   *           ^
   * ```
   *
   * @type {State}
   */
  function localName(code) {
    // Continuation of name: remain.
    if (code !== codes.eof && code >= 0 && idCont(code, {jsx: true})) {
      effects.consume(code)
      return localName
    }

    // End of local name (note that we don’t expect another colon, or a member).
    if (
      code === codes.slash ||
      code === codes.greaterThan ||
      code === codes.leftCurlyBrace ||
      markdownLineEndingOrSpace(code) ||
      unicodeWhitespace(code)
    ) {
      info.name += self.sliceSerialize(effects.exit(tokenTypes.tagNameLocal))
      returnState = localNameAfter
      return esWhitespaceStart(code)
    }

    return fail(code)
  }

  /**
   * After local name.
   *
   * This is like `primaryNameAfter`, but we don’t expect colons or periods.
   *
   * ```markdown
   * > | a <b:c> d
   *           ^
   * ```
   *
   * @type {State}
   */
  function localNameAfter(code) {
    // End of name.
    if (
      code === codes.slash ||
      code === codes.greaterThan ||
      code === codes.leftCurlyBrace ||
      attributeNameStart(code)
    ) {
      effects.exit(tokenTypes.tagName)
      return attributeBefore(code)
    }

    return fail(code)
  }

  /**
   * Before attribute.
   *
   * ```markdown
   * > | a <b /> c
   *          ^
   * > | a <b {...c}> d
   *          ^
   * > | a <b c> d
   *          ^
   * ```
   *
   * @type {State}
   */
  function attributeBefore(code) {
    // Self-closing.
    if (code === codes.slash) {
      effects.enter(tokenTypes.tagSelfClosingMarker)
      effects.consume(code)
      effects.exit(tokenTypes.tagSelfClosingMarker)
      info.selfClosing = true
      returnState = selfClosing
      return esWhitespaceStart
    }

    // End of tag.
    if (code === codes.greaterThan) {
      return tagEnd(code)
    }

    // Attribute expression: `{...rest}` or the `{value}` shorthand.
    if (code === codes.leftCurlyBrace) {
      return factorySvelteExpression.call(
        self,
        effects,
        attributeExpressionAfter,
        nok,
        tokenTypes.tagExpressionAttribute,
        tokenTypes.tagExpressionAttributeMarker,
        tokenTypes.tagExpressionAttributeValue,
        acorn,
        acornOptions,
        {spread: true, allowEmpty: false, allowLazy}
      )(code)
    }

    // Start of an attribute name.
    if (attributeNameStart(code)) {
      effects.enter(tokenTypes.tagAttribute)
      effects.enter(tokenTypes.tagAttributeName)
      effects.enter(tokenTypes.tagAttributeNamePrimary)
      effects.consume(code)
      return attributePrimaryName
    }

    return fail(code)
  }

  /**
   * After attribute expression.
   *
   * ```markdown
   * > | a <b {c} d/> e
   *             ^
   * ```
   *
   * @type {State}
   */
  function attributeExpressionAfter(code) {
    returnState = attributeBefore
    return esWhitespaceStart(code)
  }

  /**
   * In primary attribute name.
   *
   * ```markdown
   * > | a <b cd/> e
   *           ^
   * > | a <b c:d> e
   *           ^
   * > | a <b c=d> e
   *           ^
   * ```
   *
   * @type {State}
   */
  function attributePrimaryName(code) {
    // Continuation of name: remain.
    if (attributeNameCont(code)) {
      effects.consume(code)
      return attributePrimaryName
    }

    // End of attribute name or tag.
    if (
      code === codes.slash ||
      code === codes.colon ||
      code === codes.equalsTo ||
      code === codes.greaterThan ||
      code === codes.leftCurlyBrace ||
      markdownLineEndingOrSpace(code) ||
      unicodeWhitespace(code)
    ) {
      effects.exit(tokenTypes.tagAttributeNamePrimary)
      returnState = attributePrimaryNameAfter
      return esWhitespaceStart(code)
    }

    return fail(code)
  }

  /**
   * After primary attribute name.
   *
   * ```markdown
   * > | a <b c/> d
   *           ^
   * > | a <b c:d> e
   *           ^
   * > | a <b c=d> e
   *           ^
   * ```
   *
   * @type {State}
   */
  function attributePrimaryNameAfter(code) {
    // Start of a local name.
    if (code === codes.colon) {
      effects.enter(tokenTypes.tagAttributeNamePrefixMarker)
      effects.consume(code)
      effects.exit(tokenTypes.tagAttributeNamePrefixMarker)
      returnState = attributeLocalNameBefore
      return esWhitespaceStart
    }

    // Initializer: start of an attribute value.
    if (code === codes.equalsTo) {
      effects.exit(tokenTypes.tagAttributeName)
      effects.enter(tokenTypes.tagAttributeInitializerMarker)
      effects.consume(code)
      effects.exit(tokenTypes.tagAttributeInitializerMarker)
      returnState = attributeValueBefore
      return esWhitespaceStart
    }

    // End of tag / new attribute.
    if (
      code === codes.slash ||
      code === codes.greaterThan ||
      code === codes.leftCurlyBrace ||
      markdownLineEndingOrSpace(code) ||
      unicodeWhitespace(code) ||
      attributeNameStart(code)
    ) {
      effects.exit(tokenTypes.tagAttributeName)
      effects.exit(tokenTypes.tagAttribute)
      returnState = attributeBefore
      return esWhitespaceStart(code)
    }

    return fail(code)
  }

  /**
   * Before local attribute name.
   *
   * ```markdown
   * > | a <b c:d/> e
   *            ^
   * ```
   *
   * @type {State}
   */
  function attributeLocalNameBefore(code) {
    // Start of a local name.
    if (attributeNameStart(code)) {
      effects.enter(tokenTypes.tagAttributeNameLocal)
      effects.consume(code)
      return attributeLocalName
    }

    return fail(code)
  }

  /**
   * In local attribute name.
   *
   * ```markdown
   * > | a <b c:de/> f
   *             ^
   * > | a <b transition:fade|local/> f
   *                          ^
   * ```
   *
   * @type {State}
   */
  function attributeLocalName(code) {
    // Continuation of name: remain.
    if (attributeNameCont(code)) {
      effects.consume(code)
      return attributeLocalName
    }

    // End of local name (note that we don’t expect another colon).
    if (
      code === codes.slash ||
      code === codes.equalsTo ||
      code === codes.greaterThan ||
      code === codes.leftCurlyBrace ||
      markdownLineEndingOrSpace(code) ||
      unicodeWhitespace(code)
    ) {
      effects.exit(tokenTypes.tagAttributeNameLocal)
      effects.exit(tokenTypes.tagAttributeName)
      returnState = attributeLocalNameAfter
      return esWhitespaceStart(code)
    }

    return fail(code)
  }

  /**
   * After local attribute name.
   *
   * ```markdown
   * > | a <b c:d/> f
   *             ^
   * > | a <b c:d=e/> f
   *             ^
   * ```
   *
   * @type {State}
   */
  function attributeLocalNameAfter(code) {
    // Start of an attribute value.
    if (code === codes.equalsTo) {
      effects.enter(tokenTypes.tagAttributeInitializerMarker)
      effects.consume(code)
      effects.exit(tokenTypes.tagAttributeInitializerMarker)
      returnState = attributeValueBefore
      return esWhitespaceStart
    }

    // End of name.
    if (
      code === codes.slash ||
      code === codes.greaterThan ||
      code === codes.leftCurlyBrace ||
      attributeNameStart(code)
    ) {
      effects.exit(tokenTypes.tagAttribute)
      return attributeBefore(code)
    }

    return fail(code)
  }

  /**
   * After `=`, before value.
   *
   * ```markdown
   * > | a <b c="d"/> e
   *            ^
   * > | a <b c={d}/> e
   *            ^
   * > | a <b c=d/> e
   *            ^
   * ```
   *
   * @type {State}
   */
  function attributeValueBefore(code) {
    // Start of double- or single quoted value.
    if (code === codes.quotationMark || code === codes.apostrophe) {
      effects.enter(tokenTypes.tagAttributeValueLiteral)
      effects.enter(tokenTypes.tagAttributeValueLiteralMarker)
      effects.consume(code)
      effects.exit(tokenTypes.tagAttributeValueLiteralMarker)
      marker = code
      return attributeValueQuotedStart
    }

    // Attribute value expression.
    if (code === codes.leftCurlyBrace) {
      return factorySvelteExpression.call(
        self,
        effects,
        attributeValueExpressionAfter,
        nok,
        tokenTypes.tagAttributeValueExpression,
        tokenTypes.tagAttributeValueExpressionMarker,
        tokenTypes.tagAttributeValueExpressionValue,
        acorn,
        acornOptions,
        {allowEmpty: false, allowLazy}
      )(code)
    }

    // Change from upstream: unquoted value, which HTML and Svelte allow.
    if (!unquotedValueEnd(code)) {
      effects.enter(tokenTypes.tagAttributeValueLiteral)
      marker = undefined
      return attributeValueUnquotedStart(code)
    }

    return fail(code)
  }

  /**
   * After attribute value expression.
   *
   * ```markdown
   * > | a <b c={d} e/> f
   *               ^
   * ```
   *
   * @type {State}
   */
  function attributeValueExpressionAfter(code) {
    effects.exit(tokenTypes.tagAttribute)
    returnState = attributeBefore
    return esWhitespaceStart(code)
  }

  /**
   * Before quoted literal attribute value.
   *
   * ```markdown
   * > | a <b c="d"/> e
   *            ^
   * ```
   *
   * @type {State}
   */
  function attributeValueQuotedStart(code) {
    assert(marker !== undefined, 'expected `marker` to be defined')

    if (code === codes.eof) {
      return fail(code)
    }

    if (code === marker) {
      effects.enter(tokenTypes.tagAttributeValueLiteralMarker)
      effects.consume(code)
      effects.exit(tokenTypes.tagAttributeValueLiteralMarker)
      effects.exit(tokenTypes.tagAttributeValueLiteral)
      effects.exit(tokenTypes.tagAttribute)
      marker = undefined
      returnState = attributeBefore
      return esWhitespaceStart
    }

    if (markdownLineEnding(code)) {
      returnState = attributeValueQuotedStart
      return esWhitespaceStart(code)
    }

    // Change from upstream: an interpolation inside the quotes, which is how
    // `class="a {b} c"` works in Svelte. In JSX a quoted value is opaque text.
    if (code === codes.leftCurlyBrace) {
      return factorySvelteExpression.call(
        self,
        effects,
        attributeValueQuotedStart,
        nok,
        tokenTypes.tagAttributeValueExpression,
        tokenTypes.tagAttributeValueExpressionMarker,
        tokenTypes.tagAttributeValueExpressionValue,
        acorn,
        acornOptions,
        {allowEmpty: false, allowLazy}
      )(code)
    }

    effects.enter(tokenTypes.tagAttributeValueLiteralValue)
    return attributeValueQuoted(code)
  }

  /**
   * In quoted literal attribute value.
   *
   * ```markdown
   * > | a <b c="d"/> e
   *             ^
   * ```
   *
   * @type {State}
   */
  function attributeValueQuoted(code) {
    if (
      code === codes.eof ||
      code === marker ||
      code === codes.leftCurlyBrace ||
      markdownLineEnding(code)
    ) {
      effects.exit(tokenTypes.tagAttributeValueLiteralValue)
      return attributeValueQuotedStart(code)
    }

    effects.consume(code)
    return attributeValueQuoted
  }

  /**
   * Before a run of an unquoted attribute value.
   *
   * Not from upstream, which has no unquoted values. Structured like
   * `attributeValueQuotedStart` so that the two read the same.
   *
   * ```markdown
   * > | a <b c=d/> e
   *            ^
   * ```
   *
   * @type {State}
   */
  function attributeValueUnquotedStart(code) {
    if (unquotedValueEnd(code)) {
      effects.exit(tokenTypes.tagAttributeValueLiteral)
      effects.exit(tokenTypes.tagAttribute)
      returnState = attributeBefore
      return esWhitespaceStart(code)
    }

    // `/` is ambiguous: it may belong to the value, or be the `/` of `/>`.
    // micromark cannot un-consume, so look ahead properly.
    if (code === codes.slash) {
      return effects.check(
        selfClosingAhead,
        attributeValueUnquotedEnd,
        attributeValueUnquotedSlash
      )(code)
    }

    if (code === codes.leftCurlyBrace) {
      return factorySvelteExpression.call(
        self,
        effects,
        attributeValueUnquotedStart,
        nok,
        tokenTypes.tagAttributeValueExpression,
        tokenTypes.tagAttributeValueExpressionMarker,
        tokenTypes.tagAttributeValueExpressionValue,
        acorn,
        acornOptions,
        {allowEmpty: false, allowLazy}
      )(code)
    }

    effects.enter(tokenTypes.tagAttributeValueLiteralValue)
    return attributeValueUnquoted(code)
  }

  /**
   * The `/` turned out to be the start of `/>`.
   *
   * @type {State}
   */
  function attributeValueUnquotedEnd(code) {
    effects.exit(tokenTypes.tagAttributeValueLiteral)
    effects.exit(tokenTypes.tagAttribute)
    returnState = attributeBefore
    return esWhitespaceStart(code)
  }

  /**
   * The `/` is part of the value, as in `href=/docs`.
   *
   * @type {State}
   */
  function attributeValueUnquotedSlash(code) {
    effects.enter(tokenTypes.tagAttributeValueLiteralValue)
    effects.consume(code)
    return attributeValueUnquoted
  }

  /**
   * In an unquoted attribute value.
   *
   * ```markdown
   * > | a <b c=d/> e
   *            ^
   * ```
   *
   * @type {State}
   */
  function attributeValueUnquoted(code) {
    if (
      unquotedValueEnd(code) ||
      code === codes.slash ||
      code === codes.leftCurlyBrace
    ) {
      effects.exit(tokenTypes.tagAttributeValueLiteralValue)
      return attributeValueUnquotedStart(code)
    }

    effects.consume(code)
    return attributeValueUnquoted
  }

  /**
   * After self-closing slash.
   *
   * ```markdown
   * > | a <b/> c
   *          ^
   * ```
   *
   * @type {State}
   */
  function selfClosing(code) {
    if (code === codes.greaterThan) {
      return tagEnd(code)
    }

    return fail(code)
  }

  /**
   * At final `>`.
   *
   * ```markdown
   * > | a <b> c
   *         ^
   * ```
   *
   * @type {State}
   */
  function tagEnd(code) {
    assert(code === codes.greaterThan, 'expected `>`')
    effects.enter(tokenTypes.tagMarker)
    effects.consume(code)
    effects.exit(tokenTypes.tagMarker)

    // Change from upstream: raw-text elements and components hold their
    // content rather than having markdown parsed into it.
    if (
      tokenTypes.raw &&
      !info.close &&
      !info.selfClosing &&
      holdsRawContent(info.name, rawComponents)
    ) {
      info.raw = true
      return factoryRawText.call(
        self,
        effects,
        rawTextAfter,
        nok,
        tokenTypes.raw,
        tokenTypes.tagMarker,
        info.name,
        info
      )
    }

    finish()
    return ok
  }

  /**
   * After the closing tag of a raw-text element.
   *
   * @type {State}
   */
  function rawTextAfter(code) {
    finish()
    return ok(code)
  }

  /**
   * Close the tag token and hand the mdast layer what was read.
   *
   * @returns {undefined}
   */
  function finish() {
    Object.assign(effects.exit(tokenTypes.tag), {_svelteTag: info})
  }

  /**
   * Before optional ECMAScript whitespace.
   *
   * ```markdown
   * > | a <a b> c
   *         ^
   * ```
   *
   * @type {State}
   */
  function esWhitespaceStart(code) {
    if (markdownLineEnding(code)) {
      effects.enter('lineEnding')
      effects.consume(code)
      effects.exit('lineEnding')
      return esWhitespaceEolAfter
    }

    if (markdownSpace(code) || unicodeWhitespace(code)) {
      effects.enter('esWhitespace')
      return esWhitespaceInside(code)
    }

    return returnState(code)
  }

  /**
   * In ECMAScript whitespace.
   *
   * ```markdown
   * > | a <a  b> c
   *          ^
   * ```
   *
   * @type {State}
   */
  function esWhitespaceInside(code) {
    if (markdownLineEnding(code)) {
      effects.exit('esWhitespace')
      return esWhitespaceStart(code)
    }

    if (markdownSpace(code) || unicodeWhitespace(code)) {
      effects.consume(code)
      return esWhitespaceInside
    }

    effects.exit('esWhitespace')
    return returnState(code)
  }

  /**
   * After eol in whitespace.
   *
   * ```markdown
   * > | a <a\nb> c
   *          ^
   * ```
   *
   * @type {State}
   */
  function esWhitespaceEolAfter(code) {
    // Change from upstream: a blank line ends the attempt rather than
    // continuing, so an unclosed `<` cannot swallow the rest of the document.
    if (code === codes.eof || markdownLineEnding(code)) {
      return nok(code)
    }

    // Change from upstream: a lazy continuation line is a `nok`, not a crash.
    if (!allowLazy && self.parser.lazy[self.now().line]) {
      return nok(code)
    }

    return esWhitespaceStart(code)
  }

  /**
   * Not a tag after all.
   *
   * Upstream's `crash()`, which throws a `VFileMessage` naming the character
   * and what was expected. Here every dead end is a `nok`: micromark undoes the
   * attempt and the text is parsed as prose, which is what makes `a < b` and
   * `use the {#if} block` work without escapes.
   *
   * @param {Code} code
   * @returns {undefined | State}
   */
  function fail(code) {
    return nok(code)
  }
}
