/**
 * Upstream's suite (`mdast-util-mdx-jsx` `test.js`, 2692 lines) is not carried
 * over: two thirds of it asserts `mdxJsxToMarkdown`, which this fork drops —
 * nothing here ever serialises back to markdown — and the rest asserts MDX node
 * shapes rather than Svelte ones. What is kept from upstream is the code: the
 * tag stack, the buffer/resume discipline and the enter/exit error hooks, all
 * of which these tests exercise.
 */

import assert from 'node:assert/strict'
import {svelteSyntax} from '@svmd/micromark-extension-svelte'
import {fromMarkdown} from 'mdast-util-from-markdown'
import {describe, it} from 'vitest'
import {svelteFromMarkdown} from '../index.js'

/**
 * @param {string} doc
 * @returns {import('mdast').Root}
 */
function parse(doc) {
  return fromMarkdown(doc, {
    extensions: [svelteSyntax()],
    mdastExtensions: [svelteFromMarkdown()]
  })
}

/**
 * Parse and return the structure error it raised.
 *
 * @param {string} doc
 * @returns {{ruleId: string, line: number, reason: string}}
 */
function parseError(doc) {
  try {
    parse(doc)
  } catch (error) {
    const message = /** @type {any} */ (error)
    const place = message.place || {}
    return {
      ruleId: message.ruleId,
      line: (place.start && place.start.line) || place.line || 0,
      reason: message.reason
    }
  }

  throw new Error('expected a structure error for:\n' + doc)
}

/**
 * Strip positions so trees compare readably.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function shape(value) {
  if (Array.isArray(value)) return value.map(shape)

  if (value && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {}

    for (const [key, item] of Object.entries(value)) {
      if (key === 'position' || key === 'valueStart') continue
      out[key] = shape(item)
    }

    return out
  }

  return value
}

describe('control block trees', () => {
  it('groups branches under one block', () => {
    assert.deepEqual(shape(parse('{#if a}\nyes\n{:else}\nno\n{/if}\n').children), [
      {
        type: 'svelteBlock',
        name: 'if',
        children: [
          {
            type: 'svelteBranch',
            marker: '#if',
            value: 'a',
            children: [{type: 'paragraph', children: [{type: 'text', value: 'yes'}]}]
          },
          {
            type: 'svelteBranch',
            marker: ':else',
            value: '',
            children: [{type: 'paragraph', children: [{type: 'text', value: 'no'}]}]
          }
        ]
      }
    ])
  })

  it('nests blocks', () => {
    const tree = parse('{#each rows as row}\n{#if row.on}\nx\n{/if}\n{/each}\n')
    const outer = /** @type {any} */ (tree.children[0])
    assert.equal(outer.name, 'each')
    assert.equal(outer.children[0].children[0].type, 'svelteBlock')
    assert.equal(outer.children[0].children[0].name, 'if')
  })

  it('keeps Svelte-only clauses verbatim', () => {
    const tree = parse('{#each items as item, i (item.id)}\nx\n{/each}\n')
    const block = /** @type {any} */ (tree.children[0])
    assert.equal(block.children[0].value, 'items as item, i (item.id)')
  })

  it('keeps `{@…}` tags as leaves', () => {
    assert.deepEqual(shape(parse('{@html raw}\n').children), [
      {type: 'svelteFlowTag', name: 'html', value: 'raw'}
    ])

    const paragraph = /** @type {any} */ (parse('a {@html raw} b\n').children[0])
    assert.deepEqual(shape(paragraph.children), [
      {type: 'text', value: 'a '},
      {type: 'svelteTextTag', name: 'html', value: 'raw'},
      {type: 'text', value: ' b'}
    ])
  })
})

describe('element trees', () => {
  it('parses markdown inside a block element', () => {
    assert.deepEqual(shape(parse('<Callout>\n\nSome **bold** text.\n\n</Callout>\n').children), [
      {
        type: 'svelteFlowElement',
        name: 'Callout',
        attributes: [],
        selfClosing: false,
        children: [
          {
            type: 'paragraph',
            children: [
              {type: 'text', value: 'Some '},
              {type: 'strong', children: [{type: 'text', value: 'bold'}]},
              {type: 'text', value: ' text.'}
            ]
          }
        ]
      }
    ])
  })

  it('parses markdown inside a block element without blank lines', () => {
    const element = /** @type {any} */ (parse('<Callout>\nSome **bold** text.\n</Callout>\n').children[0])
    assert.equal(element.type, 'svelteFlowElement')
    assert.equal(element.children[0].type, 'paragraph')
  })

  it('treats self-closing and void tags as leaves', () => {
    assert.deepEqual(shape(parse('<Divider />\n').children), [
      {type: 'svelteFlowElement', name: 'Divider', attributes: [], selfClosing: true, children: []}
    ])

    assert.deepEqual(shape(parse('<hr>\n').children), [
      {type: 'svelteFlowElement', name: 'hr', attributes: [], selfClosing: false, children: []}
    ])
  })

  it('nests inline elements inside a paragraph', () => {
    const paragraph = /** @type {any} */ (parse('Try <Badge tone="new">this</Badge> out.\n').children[0])
    assert.equal(paragraph.type, 'paragraph')
    assert.equal(paragraph.children[1].type, 'svelteTextElement')
    assert.equal(paragraph.children[1].name, 'Badge')
    assert.deepEqual(shape(paragraph.children[1].children), [{type: 'text', value: 'this'}])
  })

  it('unwraps a block element that fits on one line', () => {
    const tree = parse('<div class="note">text</div>\n')
    assert.equal(tree.children[0].type, 'svelteTextElement')
  })

  it('leaves an inline element in its paragraph', () => {
    const tree = parse('<em>only</em>\n')
    assert.equal(tree.children[0].type, 'paragraph')
  })

  it('reads every attribute shape', () => {
    const tree = parse(
      '<C a b="1" c=2 d={x} {e} {...rest} bind:value on:click|once={go} class="a {b} c" />\n'
    )
    const element = /** @type {any} */ (tree.children[0])

    assert.deepEqual(shape(element.attributes), [
      {type: 'svelteAttribute', name: 'a', quote: null, value: null, shorthand: false},
      {type: 'svelteAttribute', name: 'b', quote: '"', value: [{type: 'text', value: '1'}], shorthand: false},
      {type: 'svelteAttribute', name: 'c', quote: null, value: [{type: 'text', value: '2'}], shorthand: false},
      {type: 'svelteAttribute', name: 'd', quote: null, value: [{type: 'expression', value: 'x'}], shorthand: false},
      {type: 'svelteAttribute', name: 'e', quote: null, value: [{type: 'expression', value: 'e'}], shorthand: true},
      {type: 'svelteSpreadAttribute', value: 'rest'},
      {type: 'svelteAttribute', name: 'bind:value', quote: null, value: null, shorthand: false},
      {
        type: 'svelteAttribute',
        name: 'on:click|once',
        quote: null,
        value: [{type: 'expression', value: 'go'}],
        shorthand: false
      },
      {
        type: 'svelteAttribute',
        name: 'class',
        quote: '"',
        value: [
          {type: 'text', value: 'a '},
          {type: 'expression', value: 'b'},
          {type: 'text', value: ' c'}
        ],
        shorthand: false
      }
    ])
  })

  it('hoists script and style into their own nodes', () => {
    assert.deepEqual(
      shape(parse('<script>\nlet a = 1;\n</script>\n\n<style>\np { color: red }\n</style>\n').children),
      [
        {type: 'svelteScript', value: '\nlet a = 1;\n', attributes: []},
        {type: 'svelteStyle', value: '\np { color: red }\n', attributes: []}
      ]
    )
  })

  it('records where a raw body starts, for source maps', () => {
    const script = /** @type {any} */ (parse('# a\n\n<script>\nlet a = 1;\n</script>\n').children[1])
    assert.equal(script.valueStart.line, 3)
  })
})

describe('structural errors', () => {
  it('reports an unclosed block at its opening line', () => {
    assert.deepEqual(parseError('intro\n\n{#if a}\ntext\n').ruleId, 'E001')
  })

  it('reports a closer with no opener', () => {
    const error = parseError('{/if}\n')
    assert.equal(error.ruleId, 'E002')
    assert.equal(error.line, 1)
  })

  it('reports crossed nesting', () => {
    const error = parseError('{#if a}\n<Callout>\n{/if}\n</Callout>\n')
    assert.equal(error.ruleId, 'E003')
    assert.match(error.reason, /<\/Callout>/)
  })

  it('reports a branch in the wrong block', () => {
    const error = parseError('{#await p}\n{:else}\n{/await}\n')
    assert.equal(error.ruleId, 'E003')
    assert.equal(error.line, 2)
  })

  it('reports a mismatched closer', () => {
    const error = parseError('{#key v}\n{/each}\n')
    assert.equal(error.ruleId, 'E003')
  })

  it('reports an unclosed element', () => {
    assert.equal(parseError('<Callout>\ntext\n').ruleId, 'E005')
  })

  it('reports an orphan closing tag', () => {
    const error = parseError('</Callout>\n')
    assert.equal(error.ruleId, 'E005')
    assert.equal(error.line, 1)
  })

  it('reports attributes on a closing tag', () => {
    assert.equal(parseError('<a>\n</a b>\n').ruleId, 'E005')
  })
})
