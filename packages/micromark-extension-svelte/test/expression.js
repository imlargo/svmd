/**
 * Fork of `micromark-extension-mdx-expression` `test/index.js` (commit 2891b75).
 * MIT, Copyright (c) Titus Wormer. See `LICENSE-upstream`.
 *
 * Kept: everything about balancing braces — strings, template literals,
 * comments, nesting, line endings, containers. That is the hard part and it is
 * the same problem in both grammars.
 *
 * Dropped: upstream's `api`, `spread (hidden)` and agnostic-mode blocks. They
 * test options this fork does not have (`acorn` is not optional, `addResult`
 * and the estree are gone, and the spread rule is Svelte's). The behaviour that
 * replaced them is asserted in `test/tag.js` and at the root of the repository.
 *
 * As in `test/tag.js`, `assert.throws` became `prose`: an unbalanced or
 * unparsable brace is text here, not an error.
 *
 * @import {CompileContext, Handle, HtmlExtension} from 'micromark-util-types'
 */

import assert from 'node:assert/strict'
import {micromark, parse, postprocess, preprocess} from 'micromark'
import {describe, it} from 'vitest'
import {svelteSyntax} from '../index.js'

/** @type {HtmlExtension} */
const html = {
  enter: {svelteExpressionFlow: start, svelteExpressionText: start},
  exit: {svelteExpressionFlow: end, svelteExpressionText: end}
}

/**
 * @this {CompileContext}
 * @type {Handle}
 */
function start() {
  this.buffer()
}

/**
 * @this {CompileContext}
 * @type {Handle}
 */
function end() {
  this.resume()
  this.setData('slurpOneLineEnding', true)
}

/**
 * @param {string} value
 * @returns {string}
 */
function render(value) {
  return micromark(value, {extensions: [svelteSyntax()], htmlExtensions: [html]})
}

/**
 * Every run the grammar read as an expression, verbatim.
 *
 * The harness above renders expressions as nothing, so which of them fired has
 * to be read off the token stream.
 *
 * @param {string} value
 * @returns {Array<string>}
 */
function expressions(value) {
  const events = postprocess(
    parse({extensions: [svelteSyntax()]})
      .document()
      .write(preprocess()(value, 'utf8', true))
  )

  return events
    .filter(function (event) {
      return (
        event[0] === 'enter' &&
        (event[1].type === 'svelteExpressionFlow' ||
          event[1].type === 'svelteExpressionText')
      )
    })
    .map(function (event) {
      return event[2].sliceSerialize(event[1])
    })
}

/**
 * Assert that nothing in the input was read as an expression.
 *
 * @param {string} value
 * @returns {undefined}
 */
function prose(value) {
  assert.deepEqual(
    expressions(value),
    [],
    JSON.stringify(value) + ' should not have been read as an expression'
  )
}

// Upstream's positional-info tests are dropped with the estree they assert on.
describe('text (gnostic)', () => {
  it('should support an expression', () => {
    assert.equal(
      render('a {b} c'),
      '<p>a  c</p>'
    )
  })

  it('should crash on an incorrect expression', () => {
    prose('a {??} b')
  })

  // Changed from upstream, which renders an empty expression as nothing.
  // Here `{}` in running text is text — see `prose-braces.md` at the root.
  it('should not support an empty expression', () => {
    prose('a {} b')
  })

  it('should crash if no closing brace is found (1)', () => {
      prose('a {b c')
    }
  )

  // Changed from upstream, which throws and loses the line. Here the part
  // that is a valid expression still is one, and the rest stays prose.
  it('should read only the balanced part as an expression', () => {
    assert.deepEqual(expressions('a {b { c } d'), ['{ c }'])
  })

  it('should not support an expression holding only a line ending', () => {
    prose('a {\n} b')
  })

  it('should support just a closing brace', () => {
    assert.equal(
      render('a } b'),
      '<p>a } b</p>'
    )
  })

  it('should support expressions as the first thing when following by other things', () => {
      assert.equal(
        render('{ a } b'),
        '<p> b</p>'
      )
    }
  )

  // The brace is balanced for acorn, but the expression holds only a
  // comment, so there is nothing to render and it stays prose.
  it('should not support a comment-only expression with an unbalanced opening brace', () => {
    prose('a { /* { */ } b')
  })

  // The brace is balanced for acorn, but the expression holds only a
  // comment, so there is nothing to render and it stays prose.
  it('should not support a comment-only expression with an unbalanced closing brace', () => {
    prose('a { /* } */ } b')
  })

})

// Note: these tests are also in `wooorm/markdown-rs` at `tests/mdx_expression_flow.rs`.

describe('flow (gnostic)', () => {
  it('should support an expression', () => {
    assert.equal(
      render('{a}'),
      ''
    )
  })

  // Changed from upstream, which renders an empty expression as nothing.
  // Here `{}` in running text is text — see `prose-braces.md` at the root.
  it('should not support an empty expression', () => {
    prose('{}')
  })

  it('should crash if no closing brace is found (1)', () => {
      prose('{a')
    }
  )

  // Changed from upstream, which throws and loses the line. Here the part
  // that is a valid expression still is one, and the rest stays prose.
  it('should read only the balanced part as an expression', () => {
    assert.deepEqual(expressions('{b { c }'), ['{ c }'])
  })

  it('should not support an expression holding only a line ending', () => {
    prose('{\n}\na')
  })

  it('should support expressions followed by spaces', () => {
      assert.equal(
        render('{ a } \t\nb'),
        '<p>b</p>'
      )
    }
  )

  it('should support expressions preceded by spaces', () => {
      assert.equal(
        render('  { a }\nb'),
        '<p>b</p>'
      )
    }
  )

  it('should support indented expressions', () => {
    assert.equal(
      render('  {`\n    a\n  `}'),
      ''
    )
  })

  it('should support expressions padded w/ parens', () => {
      assert.equal(
        render('a{(b)}c'),
        '<p>ac</p>'
      )
    }
  )

  it('should support expressions padded w/ parens and comments', () => {
      assert.equal(
        render('a{/* b */ ( (c) /* d */ + (e) )}f'),
        '<p>af</p>'
      )
    }
  )






})

// Note: these tests are also in `wooorm/markdown-rs` at `tests/mdx_expression_flow.rs`.
// That project includes *all* extensions which means that it can use JSX.
// Here we test something that does not exist in actual MDX but which is used
// by the JSX extension.