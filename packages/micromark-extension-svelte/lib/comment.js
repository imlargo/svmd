/**
 * `<!-- … -->`.
 *
 * Not from upstream: MDX writes comments as `{/* … *\/}` and switches HTML off
 * entirely. Svelte uses HTML comments, and since this extension also switches
 * CommonMark's HTML constructs off, without this a comment would be literal
 * text and end up escaped.
 *
 * @import {Construct, State, TokenizeContext, Tokenizer} from 'micromark-util-types'
 */

import {factorySpace} from 'micromark-factory-space'
import {markdownLineEnding, markdownSpace} from 'micromark-util-character'
import {codes, types} from 'micromark-util-symbol'

/**
 * How many lines a comment may span.
 *
 * Same bound, and the same reason, as the expression factory: without it an
 * unclosed `<!--` scans to the end of the file before failing, and a paragraph
 * with several of them costs O(n²).
 */
const lineSpanMax = 32

/**
 * @param {boolean} flow
 * @returns {Construct}
 */
function create(flow) {
  const type = flow ? 'svelteCommentFlow' : 'svelteCommentText'
  const chunkType = flow ? 'svelteCommentFlowChunk' : 'svelteCommentTextChunk'

  return flow ? {name: type, tokenize, concrete: true} : {name: type, tokenize}

  /**
   * @this {TokenizeContext}
   * @type {Tokenizer}
   */
  function tokenize(effects, ok, nok) {
    const self = this
    let open = 0
    let lineSpan = 0
    let chunkOpen = false

    return start

    /** @returns {undefined} */
    function openChunk() {
      if (!chunkOpen) {
        effects.enter(chunkType)
        chunkOpen = true
      }
    }

    /** @returns {undefined} */
    function closeChunk() {
      if (chunkOpen) {
        effects.exit(chunkType)
        chunkOpen = false
      }
    }

    /** @type {State} */
    function start(code) {
      effects.enter(type)
      effects.enter(chunkType)
      chunkOpen = true
      effects.consume(code)
      return opening
    }

    /**
     * Match the remaining three characters of `<!--`.
     *
     * @type {State}
     */
    function opening(code) {
      const expected = [codes.exclamationMark, codes.dash, codes.dash]

      if (code !== expected[open]) return nok(code)

      open++
      effects.consume(code)
      return open === 3 ? inside : opening
    }

    /** @type {State} */
    function inside(code) {
      if (code === codes.eof) return nok(code)

      if (markdownLineEnding(code)) {
        if (++lineSpan > lineSpanMax) return nok(code)
        closeChunk()
        effects.enter(types.lineEnding)
        effects.consume(code)
        effects.exit(types.lineEnding)
        return lineStart
      }

      openChunk()
      effects.consume(code)
      return code === codes.dash ? closingDash : inside
    }

    /** @type {State} */
    function lineStart(code) {
      if (code === codes.eof) return nok(code)
      if (self.parser.lazy[self.now().line]) return nok(code)
      return inside(code)
    }

    /** @type {State} */
    function closingDash(code) {
      if (code === codes.dash) {
        effects.consume(code)
        return closingAngle
      }

      return inside(code)
    }

    /** @type {State} */
    function closingAngle(code) {
      if (code === codes.greaterThan) {
        effects.consume(code)
        closeChunk()
        if (!flow) {
          effects.exit(type)
          return ok
        }

        return afterFlow
      }

      return inside(code)
    }

    /** @type {State} */
    function afterFlow(code) {
      if (markdownSpace(code)) {
        return factorySpace(effects, afterFlow, types.whitespace)(code)
      }

      if (code !== codes.eof && !markdownLineEnding(code)) return nok(code)

      effects.exit(type)
      return ok(code)
    }
  }
}

export const commentFlow = create(true)
export const commentText = create(false)
