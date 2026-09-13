/**
 * Fork of `micromark-extension-mdx-jsx` `test/index.js` (commit ad0a49c).
 * MIT, Copyright (c) Titus Wormer. See `LICENSE-upstream`.
 *
 * The positive cases carry over unchanged: a tag is a tag, and `node:assert`
 * works inside vitest, so they read exactly as upstream wrote them.
 *
 * The negative ones are where the fork shows. Upstream asserts that a
 * malformed tag *throws*, because in MDX it is always a mistake. Here the same
 * input has to survive as literal text — that is what the whole
 * deny-by-default escaping policy rests on — so every `assert.throws` became
 * `prose(...)`, which asserts exactly that, and the reason is kept next to it.
 *
 * @import {CompileContext, Handle, HtmlExtension} from 'micromark-util-types'
 */

import assert from 'node:assert/strict'
import {micromark, parse, postprocess, preprocess} from 'micromark'
import {describe, it} from 'vitest'
import {svelteSyntax} from '../index.js'

/**
 * Renders tags as nothing, so the output shows what markdown did with the text
 * around them. Upstream's harness, with our token names.
 *
 * @type {HtmlExtension}
 */
const html = {
  enter: {svelteTagFlow: start, svelteTagText: start},
  exit: {svelteTagFlow: end, svelteTagText: end}
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
 * Assert that nothing in the input was read as a tag.
 *
 * Upstream throws for every input passed here. Here the same input has to be
 * left to markdown, which may make it literal text, a comment, or an autolink —
 * what matters is that the tag construct did not fire.
 *
 * @param {string} value
 * @returns {undefined}
 */
function prose(value) {
  const events = postprocess(
    parse({extensions: [svelteSyntax()]})
      .document()
      .write(preprocess()(value, 'utf8', true))
  )

  const tags = events.filter(function (event) {
    return (
      event[0] === 'enter' &&
      (event[1].type === 'svelteTagFlow' || event[1].type === 'svelteTagText')
    )
  })

  assert.deepEqual(
    tags.map(function (event) {
      return event[2].sliceSerialize(event[1])
    }),
    [],
    JSON.stringify(value) + ' should not have been read as a tag'
  )
}

describe('core', () => {
  // Changed from upstream: acorn is a default rather than a required option,
  // because unlike MDX this grammar has no way to tell code from prose without
  // it. `addResult` is gone: expressions are re-emitted verbatim, so nothing
  // downstream needs the tree.
  it('should expose the public api', async () => {
    assert.deepEqual(
      Object.keys(await import('../index.js')).sort(),
      ['flowTagTokenTypes', 'svelteSyntax', 'textTagTokenTypes']
    )
  })

  it('should work without options', () => {
    assert.equal(render('a <b /> c.'), '<p>a  c.</p>')
  })

  it('should crash on `acorn` w/o `parse`', () => {
    assert.throws(function () {
      // @ts-expect-error: check that a runtime error is thrown.
      svelteSyntax({acorn: {parseExpressionAt: Function.prototype}})
    }, /Expected a proper `acorn` instance passed in as `options\.acorn`/)
  })

  it('should support a self-closing element', () => {
    assert.equal(
      render('a <b/> c.'),
      '<p>a  c.</p>'
    )
  })

  it('should support a closed element', () => {
    assert.equal(
      render('a <b></b> c.'),
      '<p>a  c.</p>'
    )
  })

  // Changed from upstream: Svelte has no fragments. What looks like one is
  // prose; the thing that does the job, `<svelte:fragment>`, is an ordinary
  // name and is covered by the local-name tests below.
  it('should not support fragments', () => {
    prose('a <></> c.')
  })

  it('should support markdown inside elements', () => {
    assert.equal(
      render('a <b>*b*</b> c.'),
      '<p>a <em>b</em> c.</p>'
    )
  })
})

describe('text (agnostic)', () => {
  it('should support a self-closing element', () => {
    assert.equal(
      render('a <b /> c'),
      '<p>a  c</p>'
    )
  })

  it('should support a closed element', () => {
    assert.equal(
      render('a <b> c </b> d'),
      '<p>a  c  d</p>'
    )
  })

  it('should support an unclosed element', () => {
    assert.equal(
      render('a <b> c'),
      '<p>a  c</p>'
    )
  })

  // Changed from upstream: there is no agnostic mode here, and `{1 + 1}` is
  // not a Svelte attribute. Only `{...spread}` and the `{value}` shorthand are.
  it('should not support an arbitrary attribute expression', () => {
    prose('a <b {1 + 1} /> c')
  })

  it('should support an attribute value expression', () => {
      assert.equal(
        render('a <b c={1 + 1} /> d'),
        '<p>a  d</p>'
      )
    }
  )
})

describe('text (gnostic)', () => {
  it('should support a self-closing element', () => {
    assert.equal(
      render('a <b /> c'),
      '<p>a  c</p>'
    )
  })

  it('should support a closed element', () => {
    assert.equal(
      render('a <b> c </b> d'),
      '<p>a  c  d</p>'
    )
  })

  it('should support an unclosed element', () => {
    assert.equal(
      render('a <b> c'),
      '<p>a  c</p>'
    )
  })

  it('should support an attribute expression', () => {
    assert.equal(
      render('a <b {...c} /> d'),
      '<p>a  d</p>'
    )
  })

  it('should support more complex attribute expression (1)', () => {
      assert.equal(
        render('a <b {...{c: 1, d: Infinity, e: false}} /> f'),
        '<p>a  f</p>'
      )
    }
  )

  it('should support more complex attribute expression (2)', () => {
      assert.equal(
        render('a <b {...[1, Infinity, false]} /> d'),
        '<p>a  d</p>'
      )
    }
  )

  it('should support an attribute value expression', () => {
      assert.equal(
        render('a <b c={1 + 1} /> d'),
        '<p>a  d</p>'
      )
    }
  )

  it('should crash on an empty attribute value expression', () => {
      prose('a <b c={} /> d')
    }
  )

  it('should crash on a non-spread attribute expression', () => {
      prose('a <b {1 + 1} /> c')
    }
  )

  it('should crash on invalid JS in an attribute value expression', () => {
      prose('a <b c={?} /> d')
    }
  )

  it('should crash on invalid JS in an attribute expression', () => {
      prose('a <b {?} /> c')
    }
  )

  it('should crash on invalid JS in an attribute expression (2)', () => {
      prose('a <b{c=d}={}/> f')
    }
  )

  // Changed from upstream: the `d={<e />}` half needs acorn-jsx. Elements are
  // not values in Svelte; a snippet or a component prop does that job.
  it('should support parenthesized expressions', () => {
    assert.equal(
      render('a <b c={(2)} d={(3)} /> f'),
      '<p>a  f</p>'
    )
  })
})

describe('text (complete)', () => {
  it('should support an unclosed element', () => {
    assert.equal(
      render('a <b> c'),
      '<p>a  c</p>'
    )
  })

  it('should not support an unclosed fragment', () => {
    prose('a <> c')
  })

  it('should *not* support whitespace in the opening tag (fragment)', () => {
      // Changed from upstream only in the tail: `</>` is prose here too,
      // because Svelte has no fragments.
      assert.equal(
        render('a < \t>b</>'),
        '<p>a &lt; \t&gt;b&lt;/&gt;</p>'
      )
    }
  )

  it('should *not* support whitespace in the opening tag (named)', () => {
      assert.equal(
        render('a < \nb\t>b</b>'),
        '<p>a &lt;\nb\t&gt;b</p>'
      )
    }
  )

  it('should crash on a nonconforming start identifier', () => {
      prose('a <!> b')
    }
  )

  // Changed from upstream, which throws and so loses the whole line. Here the
  // `<a>` before the mistake is still a tag; only `</(>` stays prose.
  it('should not read a nonconforming closing tag as a tag', () => {
      assert.equal(render('a <a></(> b.'), '<p>a &lt;/(&gt; b.</p>')
    }
  )

  it('should support non-ascii identifier start characters', () => {
      assert.equal(
        render('a <π /> b.'),
        '<p>a  b.</p>'
      )
    }
  )

  it('should crash on non-conforming non-ascii identifier start characters', () => {
      prose('a <© /> b.')
    }
  )

  it('should crash nicely on what might be a comment', () => {
      prose('a <!--b-->')
    }
  )

  it('should crash nicely JS line comments inside tags (1)', () => {
      prose('a <// b\nc/>')
    }
  )

  it('should crash nicely JS line comments inside tags (2)', () => {
      prose('a <b// c\nd/>')
    }
  )

  it('should crash nicely JS multiline comments inside tags (1)', () => {
      prose('a </*b*/c>')
    }
  )

  it('should crash nicely JS multiline comments inside tags (2)', () => {
      prose('a <b/*c*/>')
    }
  )

  it('should support non-ascii identifier continuation characters', () => {
      assert.equal(
        render('a <a\u200Cb /> b.'),
        '<p>a  b.</p>'
      )
    }
  )

  it('should crash on non-conforming non-ascii identifier continuation characters', () => {
      prose('a <a¬ /> b.')
    }
  )

  it('should crash nicely on what might be an email link', () => {
      prose('a <b@c.d>')
    }
  )

  it('should support dashes in names', () => {
    assert.equal(
      render('a <a-->b</a-->.'),
      '<p>a b.</p>'
    )
  })

  it('should crash on nonconforming identifier continuation characters', () => {
      prose('a <a?> c.')
    }
  )

  it('should support dots in names for method names', () => {
      assert.equal(
        render('a <abc . def.ghi>b</abc.def . ghi>.'),
        '<p>a b.</p>'
      )
    }
  )

  it('should crash nicely on what might be an email link in member names', () => {
      prose('a <b.c@d.e>')
    }
  )

  it('should support colons in names for local names', () => {
      assert.equal(
        render('a <svg: rect>b</  svg :rect>.'),
        '<p>a b.</p>'
      )
    }
  )

  it('should crash on a nonconforming character to start a local name', () => {
      prose('a <a:+> c.')
    }
  )

  it('should crash nicely on what might be a protocol in local names', () => {
      prose('a <http://example.com>')
    }
  )

  it('should crash nicely on what might be a protocol in local names', () => {
      prose('a <http: >')
    }
  )

  it('should crash on a nonconforming character in a local name', () => {
      prose('a <a:b|> c.')
    }
  )

  it('should crash on a nonconforming character to start a member name', () => {
      prose('a <a..> c.')
    }
  )

  it('should crash on a nonconforming character in a member name', () => {
      prose('a <a.b,> c.')
    }
  )

  it('should crash on a nonconforming character after a local name', () => {
      prose('a <a:b .> c.')
    }
  )

  it('should crash on a nonconforming character after a member name', () => {
      prose('a <a.b :> c.')
    }
  )

  it('should crash on a nonconforming character after name', () => {
      prose('a <a => c.')
    }
  )

  it('should support attribute expressions', () => {
    assert.equal(
      render('a <b {...props} {...rest}>c</b>.'),
      '<p>a c.</p>'
    )
  })

  it('should support nested balanced braces in attribute expressions', () => {
      assert.equal(
        render('a <b {...{"a": "b"}}>c</b>.'),
        '<p>a c.</p>'
      )
    }
  )

  it('should support attribute expressions directly after a name', () => {
      assert.equal(
        render('<a{...b}/>.'),
        '<p>.</p>'
      )
    }
  )

  it('should support attribute expressions directly after a member name', () => {
      assert.equal(
        render('<a.b{...c}/>.'),
        '<p>.</p>'
      )
    }
  )

  it('should support attribute expressions directly after a local name', () => {
      assert.equal(
        render('<a:b{...c}/>.'),
        '<p>.</p>'
      )
    }
  )

  it('should support attribute expressions directly after boolean attributes', () => {
      assert.equal(
        render('a <b c{...d}/>.'),
        '<p>a .</p>'
      )
    }
  )

  it('should support attribute expressions directly after boolean qualified attributes', () => {
      assert.equal(
        render('a <b c:d{...e}/>.'),
        '<p>a .</p>'
      )
    }
  )

  it('should support attribute expressions and normal attributes', () => {
      assert.equal(
        render('a <b a {...props} b>c</b>.'),
        '<p>a c.</p>'
      )
    }
  )

  it('should support attributes', () => {
    assert.equal(
      render('a <b c     d="d"\t\tefg=\'e\'>c</b>.'),
      '<p>a c.</p>'
    )
  })

  it('should not read a tag with a nonconforming character as a tag', () => {
      assert.equal(render('a <b {...p}~>c</b>.'), '<p>a &lt;b {...p}~&gt;c.</p>')
    }
  )

  it('should crash on a missing closing brace in attribute expression', () => {
      prose('a <b {...')
    }
  )

  it('should crash on a nonconforming character in attribute name', () => {
      prose('a <a b@> c.')
    }
  )

  it('should support prefixed attributes', () => {
    assert.equal(
      render('a <b xml :\tlang\n= "de-CH" foo:bar>c</b>.'),
      '<p>a c.</p>'
    )
  })

  it('should support prefixed and normal attributes', () => {
      assert.equal(
        render('a <b a b : c d : e = "f" g/>.'),
        '<p>a .</p>'
      )
    }
  )

  it('should crash on a nonconforming character after an attribute name', () => {
      prose('a <a b 1> c.')
    }
  )

  it('should crash on a nonconforming character to start a local attribute name', () => {
      prose('a <a b:#> c.')
    }
  )

  it('should crash on a nonconforming character in a local attribute name', () => {
      prose('a <a b:c%> c.')
    }
  )

  it('should crash on a nonconforming character after a local attribute name', () => {
      prose('a <a b:c ^> c.')
    }
  )

  it('should support attribute value expressions', () => {
    assert.equal(
      render('a <b c={1 + 1}>c</b>.'),
      '<p>a c.</p>'
    )
  })

  it('should support nested balanced braces in attribute value expressions', () => {
      assert.equal(
        render('a <b c={1 + ({a: 1}).a}>c</b>.'),
        '<p>a c.</p>'
      )
    }
  )

  it('should crash on a nonconforming character before an attribute value', () => {
      prose('a <a b=``> c.')
    }
  )

  it('should not read an element as a prop value', () => {
      assert.equal(render('a <a b=<c />> d.'), '<p>a &lt;a b=&gt; d.</p>')
    }
  )

  it('should crash on a missing closing quote in double quoted attribute value', () => {
      prose('a <a b="> c.')
    }
  )

  it('should crash on a missing closing quote in single quoted attribute value', () => {
      prose("a <a b='> c.")
    }
  )

  it('should crash on a missing closing brace in an attribute value expression', () => {
      prose('a <a b={> c.')
    }
  )

  it('should crash on a nonconforming character after an attribute value', () => {
      prose('a <a b=""*> c.')
    }
  )

  it('should support an attribute directly after a value', () => {
      assert.equal(
        render('<a b=""c/>.'),
        '<p>.</p>'
      )
    }
  )

  it('should support an attribute directly after an attribute expression', () => {
      assert.equal(
        render('<a{...b}c/>.'),
        '<p>.</p>'
      )
    }
  )

  it('should crash on a nonconforming character after a self-closing slash', () => {
      prose('a <a/b> c.')
    }
  )

  it('should support whitespace directly after closing slash', () => {
      assert.equal(
        render('<a/ \t>.'),
        '<p>.</p>'
      )
    }
  )

  it('should *not* crash on closing angle in text', () => {
      assert.doesNotThrow(function () {
        render('a > c.')
      })
    }
  )

  it('should *not* crash on opening angle in tick code in an element', () => {
      assert.doesNotThrow(function () {
        render('a <>`<`</> c.')
      })
    }
  )

  it('should *not* crash on ticks in tick code in an element', () => {
      assert.doesNotThrow(function () {
        render('a <>`` ``` ``</>')
      })
    }
  )

  it('should not support a closing fragment tag', () => {
      prose('a </> c.')
    }
  )

  it('should not support mismatched fragment tags (1)', () => {
    // `<>` is prose; `</b>` is still a tag.
    assert.equal(render('a <></b>'), '<p>a &lt;&gt;</p>')
  })

  it('should not support mismatched fragment tags (2)', () => {
    assert.equal(render('a <b></>'), '<p>a &lt;/&gt;</p>')
  })

  it('should support mismatched tags (3)', () => {
    assert.equal(render('a <a.b></a>'), '<p>a </p>')
  })

  it('should support mismatched tags (4)', () => {
    assert.equal(render('a <a></a.b>'), '<p>a </p>')
  })

  it('should support mismatched tags (5)', () => {
    assert.equal(render('a <a.b></a.c>'), '<p>a </p>')
  })

  it('should support mismatched tags (6)', () => {
    assert.equal(render('a <a:b></a>'), '<p>a </p>')
  })

  it('should support mismatched tags (7)', () => {
    assert.equal(render('a <a></a:b>'), '<p>a </p>')
  })

  it('should support mismatched tags (8)', () => {
    assert.equal(render('a <a:b></a:c>'), '<p>a </p>')
  })

  it('should support mismatched tags (9)', () => {
    assert.equal(render('a <a:b></a.b>'), '<p>a </p>')
  })

  it('should support a closing self-closing tag', () => {
    assert.equal(
      render('a <a>b</a/>'),
      '<p>a b</p>'
    )
  })

  it('should support a closing tag w/ attributes', () => {
    assert.equal(
      render('a <a>b</a b>'),
      '<p>a b</p>'
    )
  })

  it('should not support nested fragment tags', () => {
    prose('a <>b <>c</> d</>.')
  })

  it('should support character references in attribute values', () => {
      assert.equal(
        render('<x y="Character references can be used: &quot;, &apos;, &lt;, &gt;, &#x7B;, and &#x7D;, they can be named, decimal, or hexadecimal: &copy; &#8800; &#x1D306;" />.'),
        '<p>.</p>'
      )
    }
  )

  it('should support character references in text', () => {
      assert.equal(
        render('<x>Character references can be used: &quot;, &apos;, &lt;, &gt;, &#x7B;, and &#x7D;, they can be named, decimal, or hexadecimal: &copy; &#8800; &#x1D306;</x>.'),
        "<p>Character references can be used: &quot;, ', &lt;, &gt;, {, and }, they can be named, decimal, or hexadecimal: © ≠ 𝌆.</p>"
      )
    }
  )

  it('should support as text if the closing tag is not the last thing', () => {
      assert.equal(
        render('<x />.'),
        '<p>.</p>'
      )
    }
  )

  it('should support as text if the opening is not the first thing', () => {
      assert.equal(
        render('a <x />'),
        '<p>a </p>'
      )
    }
  )

  it('should not care about precedence between attention (emphasis)', () => {
      assert.equal(
        render('a *open <b> close* </b> c.'),
        '<p>a <em>open  close</em>  c.</p>'
      )
    }
  )

  it('should not care about precedence between attention (strong)', () => {
      assert.equal(
        render('a **open <b> close** </b> c.'),
        '<p>a <strong>open  close</strong>  c.</p>'
      )
    }
  )

  it('should not care about precedence between label (link)', () => {
      assert.equal(
        render('a [open <b> close](c) </b> d.'),
        '<p>a <a href="c">open  close</a>  d.</p>'
      )
    }
  )

  it('should not care about precedence between label (image)', () => {
      assert.equal(
        render('a ![open <b> close](c) </b> d.'),
        '<p>a <img src="c" alt="open  close" />  d.</p>'
      )
    }
  )

  it('should support line endings in elements', () => {
    assert.equal(
      render('> a <b>\n> c </b> d.'),
      '<blockquote>\n<p>a c  d.</p>\n</blockquote>'
    )
  })

  it('should support line endings in attribute values', () => {
      assert.equal(
        render('> a <b c="d\ne" /> f'),
        '<blockquote>\n<p>a  f</p>\n</blockquote>'
      )
    }
  )

  // Changed from upstream, which runs this one without acorn. `d\ne` is two
  // expressions, not one, so with acorn always on it is not an attribute
  // value — and therefore not a tag.
  it('should not accept two expressions as one attribute value', () => {
      prose('> a <b c={d\ne} /> f')
    }
  )

  it('should not accept two expressions as one attribute', () => {
      prose('> a <b {c\nd} /> e')
    }
  )

  it('should allow `<` followed by markdown whitespace as text in markdown', () => {
      assert.equal(
        render('1 < 3'),
        '<p>1 &lt; 3</p>'
      )
    }
  )

  it('should allow line endings in whitespace', () => {
    assert.equal(
      render('a <b \n c> d.'),
      '<p>a  d.</p>'
    )
  })
})

describe('flow (agnostic)', () => {
  it('should support a self-closing element', () => {
    assert.equal(
      render('<a />'),
      ''
    )
  })

  it('should support a closed element', () => {
    assert.equal(
      render('<a></a>'),
      ''
    )
  })

  it('should support an element w/ content', () => {
    assert.equal(
      render('<a>\nb\n</a>'),
      '<p>b</p>\n'
    )
  })

  it('should support an element w/ containers as content', () => {
      assert.equal(
        render('<a>\n- b\n</a>'),
        '<ul>\n<li>b</li>\n</ul>\n'
      )
    }
  )

  // Changed from upstream: `f={/* g */}` holds only a comment. Upstream allows
  // an empty expression; Svelte has nothing to render for one, so it is not a
  // value here and the tag falls back to prose.
  it('should support attributes', () => {
    assert.equal(
      render('<a b c:d e="" f={g} {...h} />'),
      ''
    )
  })

  it('should not support an empty attribute value expression', () => {
    prose('<a f={/* g */} />')
  })
})

// Flow is mostly the same as `text`, so we only test the relevant
// differences.
describe('flow (essence)', () => {
  it('should support an element', () => {
    assert.equal(
      render('<a />'),
      ''
    )
  })

  it('should support an element around a container', () => {
      assert.equal(
        render('<a>\n- b\n</a>'),
        '<ul>\n<li>b</li>\n</ul>\n'
      )
    }
  )

  it('should support a dangling `>` in a tag (not a block quote)', () => {
      assert.equal(
        render('<x\n  y\n>  \nb\n  </x>'),
        '<p>b</p>\n'
      )
    }
  )

  it('should support trailing initial and final whitespace around tags', () => {
      assert.equal(
        render('<a>  \nb\n  </a>'),
        '<p>b</p>\n'
      )
    }
  )

  it('should support tags after tags', () => {
    assert.equal(
      render('<a> <b>\t\nc\n  </b> </a>'),
      '<p>c</p>\n'
    )
  })

  // Changed from upstream, and a consequence of the fork's core decision
  // rather than a choice of its own. Upstream throws on a lazy line, which
  // ends the parse. Here the flow construct returns `nok`, the line becomes an
  // ordinary paragraph — a lazy continuation is legal for a paragraph — and the
  // text-level tag construct, which does allow lazy lines exactly as upstream's
  // does, reads the tag inside it.
  it('should not read a lazy line as a flow tag', () => {
    assert.equal(render('> <X\n/>'), '<blockquote>\n<p></p>\n</blockquote>')
  })

  it('should not read a lazy line as a flow tag (2)', () => {
    assert.equal(
      render('> a\n> <X\n/>'),
      '<blockquote>\n<p>a\n</p>\n</blockquote>'
    )
  })

  it('should not support lazy flow (3)', () => {
    assert.deepEqual(
      render('> a\n<X />'),
      '<blockquote>\n<p>a</p>\n</blockquote>\n'
    )
  })
})

// Upstream's `positional info` block is dropped: every test in it asserts the
// shape of the estree that `addResult` attaches, and this fork does not build
// one. The positions that matter here are asserted against the compiled
// output, in `test/sourcemap.test.ts` at the root of the repository.

describe('interplay', () => {
  it('should support tags and expressions with text before (text)', () => {
      assert.deepEqual(
        render('x<em>{1}</em>'),
        '<p>x</p>'
      )
    }
  )

  it('should support tags and expressions with text between, early (text)', () => {
      assert.deepEqual(
        render('<em>x{1}</em>'),
        '<p>x</p>'
      )
    }
  )

  it('should support tags and expressions with text between, late (text)', () => {
      assert.deepEqual(
        render('<em>{1}x</em>'),
        '<p>x</p>'
      )
    }
  )

  it('should support tags and expressions with text after (text)', () => {
      assert.deepEqual(
        render('<em>{1}</em>x'),
        '<p>x</p>'
      )
    }
  )

  it('should support a tag and then an expression (flow)', () => {
      assert.deepEqual(
        render('<x/>{1}'),
        ''
      )
    }
  )

  it('should support a tag, an expression, then text (text)', () => {
      assert.deepEqual(
        render('<x/>{1}x'),
        '<p>x</p>'
      )
    }
  )

  it('should support text, a tag, then an expression (text)', () => {
      assert.deepEqual(
        render('x<x/>{1}'),
        '<p>x</p>'
      )
    }
  )

  it('should support an expression and then a tag (flow)', () => {
      assert.deepEqual(
        render('{1}<x/>'),
        ''
      )
    }
  )

  it('should support an expression, a tag, then text (text)', () => {
      assert.deepEqual(
        render('{1}<x/>x'),
        '<p>x</p>'
      )
    }
  )

  it('should support text, an expression, then a tag (text)', () => {
      assert.deepEqual(
        render('x{1}<x/>'),
        '<p>x</p>'
      )
    }
  )

  it('should nicely interleaf (micromark/micromark-extension-mdx-jsx#9)', () => {
      assert.equal(
        render("<x>{[\n'',\n{c:''}\n]}</x>"),
        '\n\n'
      )
    }
  )

  // Changed from upstream: `<style>` is a raw-text element here, as it is in
  // HTML, so its body is CSS rather than an expression. That is what makes
  // `<style>` usable at all once CommonMark's HTML constructs are off.
  it('should treat a style body as raw text (mdx-js/mdx#1945)', () => {
    assert.equal(
      render(`
<style>
  .foo {}
  .bar {}
</style>
    `),
      ''
    )
  })
})

/**
 * @param {Node} node
 * @returns {undefined}
 */
function removeOffsets(node) {
  visit(node, function (d) {
    assert(d.loc, 'expected `loc`')
    // @ts-expect-error: we add offsets, as we have them.
    delete d.loc.start.offset
    // @ts-expect-error: we add offsets.
    delete d.loc.end.offset
  })
}
