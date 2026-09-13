/**
 * Not from upstream: MDX has no raw-text elements, because JSX has none.
 *
 * @import {Code, Construct, Effects, Point, State, TokenType, TokenizeContext, Tokenizer} from 'micromark-util-types'
 */

import {
  asciiAlphanumeric,
  markdownLineEnding,
  markdownSpace
} from 'micromark-util-character'
import {codes, types} from 'micromark-util-symbol'

/**
 * Whether a tag names a component rather than an HTML element.
 *
 * Svelte's own rule: a capital first letter. A dot and a colon are the two
 * other shapes a name can take that no HTML element has.
 *
 * @param {string} name
 * @returns {boolean}
 */
function isComponentName(name) {
  return /^[A-Z]/.test(name) || name.includes('.') || name.includes(':')
}

/**
 * Whether `code` could be the next character of a tag name.
 *
 * Used to tell `<Code>` from `<Codex>`: the lookahead has matched the letters
 * of the name, and what follows decides whether it was the whole name.
 *
 * @param {Code} code
 * @returns {boolean}
 */
function continuesName(code) {
  return (
    asciiAlphanumeric(code) ||
    code === codes.dash ||
    code === codes.underscore ||
    code === codes.dollarSign ||
    code === codes.dot ||
    code === codes.colon
  )
}

/**
 * Consume the content of an element that holds it, up to its closing tag.
 *
 * `<script>` and `<style>` hold JavaScript and CSS. A component holds whatever
 * its author wrote, to be handed to Svelte untouched — what a component does
 * with its children is the component's business.
 *
 * The content is emitted one token per line, because a token may not span a
 * line ending in flow or micromark cannot stitch the lines back together. The
 * span is recorded instead, so the mdast layer can take it verbatim with a
 * single slice.
 *
 * Entered right after the `>` of the opening tag.
 *
 * @this {TokenizeContext}
 * @param {Effects} effects
 * @param {State} ok
 *   State switched to after the closing tag.
 * @param {State} nok
 *   State switched to when there is no closing tag.
 * @param {TokenType} rawType
 *   Token type for the content.
 * @param {TokenType} markerType
 *   Token type for the closing tag.
 * @param {string} name
 *   Element name, as written.
 * @param {{rawStart: Point | undefined, rawEnd: Point | undefined}} info
 *   Filled in with the span of the content.
 * @returns {State}
 */
// eslint-disable-next-line max-params
export function factoryRawText(effects, ok, nok, rawType, markerType, name, info) {
  const self = this
  /**
   * A component may hold another of its own kind; `<script>` may not, and
   * counting there would break on a `"</script>"` inside a string. HTML also
   * matches a raw-text closing tag case-insensitively, while Svelte
   * distinguishes `<Callout>` from `<callout>`.
   */
  const nested = isComponentName(name)
  const target = nested ? name : name.toLowerCase()

  /**
   * Lookahead for a tag of this element's own name, so that the `<` of one
   * never lands inside the content token — micromark cannot un-consume.
   *
   * One construct rather than two: an opening and a closing tag differ by a
   * single character, and telling them apart at the end costs less than
   * scanning the same text twice.
   *
   * @type {Construct}
   */
  const tagAhead = {partial: true, tokenize: tokenizeTagAhead}
  /** Set by that lookahead, on success only: whether the tag it found closes. */
  let aheadCloses = false

  let depth = 0
  let open = false

  return start

  /** @returns {undefined} */
  function openChunk() {
    if (!open) {
      effects.enter(rawType)
      open = true
    }
  }

  /** @returns {undefined} */
  function closeChunk() {
    if (open) {
      effects.exit(rawType)
      open = false
    }
  }

  /** @type {State} */
  function start(code) {
    info.rawStart = self.now()
    info.rawEnd = self.now()
    return inside(code)
  }

  /**
   * In the content.
   *
   * ```markdown
   * > | <Callout>text</Callout>
   *              ^^^^
   * ```
   *
   * @type {State}
   */
  function inside(code) {
    if (code === codes.eof) {
      closeChunk()
      return nok(code)
    }

    if (markdownLineEnding(code)) {
      closeChunk()
      effects.enter(types.lineEnding)
      effects.consume(code)
      effects.exit(types.lineEnding)
      info.rawEnd = self.now()
      return inside
    }

    if (code === codes.lessThan) {
      return effects.check(tagAhead, atTag, take)(code)
    }

    return take(code)
  }

  /** @type {State} */
  function take(code) {
    openChunk()
    effects.consume(code)
    info.rawEnd = self.now()
    return inside
  }

  /**
   * At a tag of this element's own name.
   *
   * The outermost closing one ends the element. Anything else belongs to a
   * nested instance and is content like the rest.
   *
   * @type {State}
   */
  function atTag(code) {
    if (!aheadCloses) {
      depth++
      return take(code)
    }

    if (depth > 0) {
      depth--
      return take(code)
    }

    closeChunk()
    effects.enter(markerType)
    return closerInside(code)
  }

  /**
   * Consume `</name`, any whitespace, and the `>`.
   *
   * @type {State}
   */
  function closerInside(code) {
    if (code === codes.greaterThan) {
      effects.consume(code)
      effects.exit(markerType)
      return ok
    }

    effects.consume(code)
    return closerInside
  }

  /**
   * @this {TokenizeContext}
   * @type {Tokenizer}
   */
  function tokenizeTagAhead(effects, ok, nok) {
    let closing = false
    let index = 0
    /** @type {Code} */
    let quote = null

    return start

    /** @type {State} */
    function start(code) {
      // A token has to be open to consume, and a lookahead at the start of a
      // line has none. The events are thrown away either way.
      effects.enter(rawType)
      effects.consume(code)
      return afterMarker
    }

    /** @type {State} */
    function afterMarker(code) {
      if (code === codes.slash) {
        closing = true
        effects.consume(code)
        return inName
      }

      // Only a component can hold another of its own name, so for a raw-text
      // element an opening tag is content and nothing else.
      return nested ? inName(code) : fail(code)
    }

    /** @type {State} */
    function inName(code) {
      if (code === codes.eof || code < 0) return fail(code)

      const character = String.fromCodePoint(code)

      if ((nested ? character : character.toLowerCase()) !== target.charAt(index)) {
        return fail(code)
      }

      effects.consume(code)
      index++
      return index === target.length ? afterName : inName
    }

    /**
     * After the name, which has to end here: `<Codex>` is not a `<Code>`.
     *
     * @type {State}
     */
    function afterName(code) {
      if (continuesName(code)) return fail(code)
      if (code === codes.greaterThan) return succeed(code)
      if (closing) return markdownSpace(code) ? consume(code, afterName) : fail(code)

      // An opening tag has to be read to its `>`: `<Card />` opens no scope to
      // match, and counting it would leave the element looking for a closing
      // tag that never comes. It is also what keeps a `"<Card />"` inside a
      // code sample from being counted.
      return inAttributes(code)
    }

    /** @type {State} */
    function inAttributes(code) {
      if (code === codes.eof) return fail(code)

      if (quote !== null) {
        if (code === quote) quote = null
        return consume(code, inAttributes)
      }

      if (code === codes.greaterThan) return succeed(code)
      if (code === codes.slash) return consume(code, afterSlash)

      if (code === codes.quotationMark || code === codes.apostrophe) {
        quote = code
      }

      return consume(code, inAttributes)
    }

    /** @type {State} */
    function afterSlash(code) {
      // `<Card />` opens nothing.
      return code === codes.greaterThan ? fail(code) : inAttributes(code)
    }

    /**
     * @param {Code} code
     * @param {State} next
     * @returns {State}
     */
    function consume(code, next) {
      effects.consume(code)
      return next
    }

    /** @type {State} */
    function succeed(code) {
      aheadCloses = closing
      effects.exit(rawType)
      return ok(code)
    }

    /** @type {State} */
    function fail(code) {
      effects.exit(rawType)
      return nok(code)
    }
  }
}
