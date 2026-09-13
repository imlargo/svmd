/**
 * Control blocks: `{#if}`, `{:else}`, `{/if}`, `{@html}`.
 *
 * Not from upstream. JSX has no block syntax — React writes conditionals as
 * `{cond && <p/>}` — so MDX never needed one, and this is the one piece of the
 * grammar with no ancestor to fork.
 *
 * It is still built on the forked expression factory, in agnostic mode: a
 * block's clause is not a JavaScript expression (`items as item, i (item.id)`
 * parses as an identifier followed by rubbish), so it can only be delimited,
 * not validated. Svelte's own compiler reports what is wrong with it, and the
 * source map points at the right line of the markdown.
 *
 * @import {Code, Construct, Effects, State, TokenizeContext, Tokenizer} from 'micromark-util-types'
 */

import {factorySvelteExpression} from '@svmd/micromark-factory-svelte-expression'
import {factorySpace} from 'micromark-factory-space'
import {
  asciiAlpha,
  asciiAlphanumeric,
  markdownLineEnding,
  markdownSpace
} from 'micromark-util-character'
import {codes, types} from 'micromark-util-symbol'

/** `{#…}` opens a block. */
const openers = new Set(['if', 'each', 'await', 'key', 'snippet'])
/** `{:…}` continues the block it sits in. */
const branches = new Set(['else', 'then', 'catch'])
/** `{@…}` is a standalone tag, part of no block structure. */
const tags = new Set(['html', 'const', 'render', 'debug', 'attach'])

/**
 * Names that are meaningless without a clause.
 *
 * Requiring one is what keeps a sentence such as “use the {#if} block” from
 * being read as syntax: with nothing between the name and the closing brace the
 * construct fails, micromark backtracks, and the text is escaped as prose.
 */
const requireValue = new Set([
  '#if',
  '#each',
  '#await',
  '#key',
  '#snippet',
  '@html',
  '@const',
  '@render',
  '@attach'
])

/** Names that must not carry a clause. */
const forbidValue = new Set(['/if', '/each', '/await', '/key', '/snippet'])

/**
 * @param {string} marker
 * @param {string} name
 * @returns {boolean}
 */
function known(marker, name) {
  if (marker === '#' || marker === '/') return openers.has(name)
  if (marker === ':') return branches.has(name)
  return tags.has(name)
}

/**
 * @param {Code} code
 * @returns {string | undefined}
 */
function markerOf(code) {
  if (code === codes.numberSign) return '#'
  if (code === codes.colon) return ':'
  if (code === codes.slash) return '/'
  if (code === codes.atSign) return '@'
  return undefined
}

/**
 * @param {boolean} flow
 *   Whether this is the flow variant.
 * @returns {Construct}
 */
function create(flow) {
  const type = flow ? 'svelteBlockFlow' : 'svelteBlockText'
  const markerType = flow ? 'svelteBlockFlowMarker' : 'svelteBlockTextMarker'
  const nameType = flow ? 'svelteBlockFlowName' : 'svelteBlockTextName'
  const chunkType = flow ? 'svelteBlockFlowChunk' : 'svelteBlockTextChunk'

  return flow
    ? {name: type, tokenize, concrete: true}
    : {name: type, tokenize}

  /**
   * @this {TokenizeContext}
   * @type {Tokenizer}
   */
  function tokenize(effects, ok, nok) {
    const self = this
    /** @type {string} */
    let marker = ''
    /** @type {string} */
    let name = ''

    return start

    /** @type {State} */
    function start(code) {
      return factorySvelteExpression.call(
        self,
        effects,
        after,
        nok,
        type,
        markerType,
        chunkType,
        // Agnostic: no acorn. A block clause is not an expression.
        undefined,
        undefined,
        {prefix, allowEmpty: true}
      )(code)
    }

    /**
     * Everything between `{` and the clause: `#if`, `:else`, `/each`, `@html`.
     *
     * This runs before the clause is read, which is what lets it reject
     * `{#if}` — a name that needs a clause but has none — early enough for
     * micromark to backtrack and leave the text as prose.
     *
     * @param {Effects} effects
     * @param {State} valueOk
     * @param {State} valueNok
     * @returns {State}
     */
    function prefix(effects, valueOk, valueNok) {
      return markerBefore

      /** @type {State} */
      function markerBefore(code) {
        const found = markerOf(code)

        // Control blocks are a flow construct by contract: a `{#if}` mid
        // sentence is prose. Only `{@…}` tags make sense inline.
        if (found === undefined || (!flow && found !== '@')) {
          return valueNok(code)
        }

        marker = found
        effects.enter(markerType)
        effects.consume(code)
        effects.exit(markerType)
        return nameStart
      }

      /** @type {State} */
      function nameStart(code) {
        if (!asciiAlpha(code)) return valueNok(code)
        effects.enter(nameType)
        effects.consume(code)
        return nameInside
      }

      /** @type {State} */
      function nameInside(code) {
        // Digits are consumed so that the whole run is checked against the
        // known names: otherwise `{#if2 a}` reads as `{#if}` with the clause
        // `2 a`.
        if (asciiAlphanumeric(code)) {
          effects.consume(code)
          return nameInside
        }

        name = self.sliceSerialize(effects.exit(nameType))

        if (!known(marker, name)) return valueNok(code)

        return afterName(code)
      }

      /** @type {State} */
      function afterName(code) {
        if (markdownSpace(code)) {
          return factorySpace(effects, afterName, types.whitespace)(code)
        }

        const key = marker + name

        if (code === codes.rightCurlyBrace) {
          return requireValue.has(key) ? valueNok(code) : valueOk(code)
        }

        if (forbidValue.has(key)) return valueNok(code)

        return valueOk(code)
      }
    }

    /** @type {State} */
    function after(code) {
      if (!flow) return ok(code)

      if (markdownSpace(code)) {
        return factorySpace(effects, after, types.whitespace)(code)
      }

      return code === codes.eof || markdownLineEnding(code) ? ok(code) : nok(code)
    }
  }
}

/** `{#if …}`, `{:else}`, `{/if}`, `{@html …}` — alone on their own line. */
export const blockFlow = create(true)

/** `{@html …}`, `{@render …}` — inline, inside a paragraph or heading. */
export const blockText = create(false)
