/**
 * The constructs with no upstream ancestor: control blocks, comments and
 * raw-text elements. JSX has no shape for any of them, so none of
 * `micromark-extension-mdx-jsx`'s 1736 lines of tests apply, and this file is
 * what stands in for them.
 *
 * Assertions are on the token stream rather than on rendered HTML: this is a
 * grammar, and what matters is which construct fired and over what text.
 */

import assert from 'node:assert/strict'
import {parse, postprocess, preprocess} from 'micromark'
import {describe, it} from 'vitest'
import {svelteSyntax} from '../index.js'

/**
 * @param {string} value
 * @returns {Array<import('micromark-util-types').Event>}
 */
function events(value) {
  return postprocess(
    parse({extensions: [svelteSyntax()]})
      .document()
      .write(preprocess()(value, 'utf8', true))
  )
}

/**
 * Every run of `type` the grammar produced, verbatim.
 *
 * @param {string} value
 * @param {string} type
 * @returns {Array<string>}
 */
function tokens(value, type) {
  return events(value)
    .filter(function (event) {
      return event[0] === 'enter' && event[1].type === type
    })
    .map(function (event) {
      return event[2].sliceSerialize(event[1])
    })
}

/**
 * The `{#if …}` and `{@html …}` runs, flow and text alike.
 *
 * @param {string} value
 * @returns {Array<string>}
 */
function blocks(value) {
  return [...tokens(value, 'svelteBlockFlow'), ...tokens(value, 'svelteBlockText')]
}

/**
 * Assert that nothing was read as a block.
 *
 * @param {string} value
 * @returns {undefined}
 */
function prose(value) {
  assert.deepEqual(
    blocks(value),
    [],
    JSON.stringify(value) + ' should not have been read as a block'
  )
}

/**
 * The name of every markdown construct produced, so a test can show that the
 * surrounding markdown is untouched.
 *
 * @param {string} value
 * @param {string} type
 * @returns {number}
 */
function count(value, type) {
  return tokens(value, type).length
}

describe('control blocks: openers', () => {
  it('should support every opener', () => {
    assert.deepEqual(blocks('{#if a}\nx\n{/if}\n'), ['{#if a}', '{/if}'])
    assert.deepEqual(blocks('{#each a as b}\nx\n{/each}\n'), ['{#each a as b}', '{/each}'])
    assert.deepEqual(blocks('{#await p}\nx\n{/await}\n'), ['{#await p}', '{/await}'])
    assert.deepEqual(blocks('{#key v}\nx\n{/key}\n'), ['{#key v}', '{/key}'])
    assert.deepEqual(blocks('{#snippet s()}\nx\n{/snippet}\n'), ['{#snippet s()}', '{/snippet}'])
  })

  it('should keep a Svelte-only clause verbatim', () => {
    assert.deepEqual(blocks('{#each items as item, i (item.id)}\nx\n{/each}\n'), [
      '{#each items as item, i (item.id)}',
      '{/each}'
    ])
  })

  it('should support a destructuring clause', () => {
    assert.deepEqual(blocks('{#each rows as {id, label}}\nx\n{/each}\n'), [
      '{#each rows as {id, label}}',
      '{/each}'
    ])
  })

  it('should support an await clause with then', () => {
    assert.deepEqual(blocks('{#await p then v}\nx\n{/await}\n'), ['{#await p then v}', '{/await}'])
  })

  it('should reject an unknown name', () => {
    prose('{#nope a}\n')
    prose('{#IF a}\n')
    prose('{#if2 a}\n')
  })

  it('should reject an opener with no clause', () => {
    // This is what keeps “use the {#if} block” from being read as syntax.
    for (const name of ['if', 'each', 'await', 'key', 'snippet']) {
      prose('{#' + name + '}\n')
    }
  })

  it('should reject whitespace before the marker', () => {
    prose('{ #if a}\n')
  })

  it('should reject whitespace between marker and name', () => {
    prose('{# if a}\n')
  })
})

describe('control blocks: branches and closers', () => {
  it('should support every branch', () => {
    assert.deepEqual(blocks('{#if a}\n{:else if b}\n{:else}\n{/if}\n'), [
      '{#if a}',
      '{:else if b}',
      '{:else}',
      '{/if}'
    ])

    assert.deepEqual(blocks('{#await p}\n{:then v}\n{:catch e}\n{/await}\n'), [
      '{#await p}',
      '{:then v}',
      '{:catch e}',
      '{/await}'
    ])
  })

  it('should support a branch with no clause', () => {
    assert.deepEqual(blocks('{#await p}\n{:then}\n{/await}\n'), [
      '{#await p}',
      '{:then}',
      '{/await}'
    ])
  })

  it('should reject a clause on a closer', () => {
    prose('{/if a}\n')
  })

  it('should reject an unknown branch', () => {
    prose('{:nope}\n')
  })
})

describe('control blocks: tags', () => {
  it('should support every tag', () => {
    assert.deepEqual(blocks('{@html a}\n'), ['{@html a}'])
    assert.deepEqual(blocks('{@const a = 1}\n'), ['{@const a = 1}'])
    assert.deepEqual(blocks('{@render a()}\n'), ['{@render a()}'])
    assert.deepEqual(blocks('{@attach a}\n'), ['{@attach a}'])
  })

  it('should support `{@debug}` with no clause', () => {
    // The only tag that means something on its own.
    assert.deepEqual(blocks('{@debug}\n'), ['{@debug}'])
    assert.deepEqual(blocks('{@debug a, b}\n'), ['{@debug a, b}'])
  })

  it('should reject the other tags with no clause', () => {
    for (const name of ['html', 'const', 'render', 'attach']) {
      prose('{@' + name + '}\n')
    }
  })

  it('should support a tag inline', () => {
    assert.deepEqual(tokens('a {@html b} c\n', 'svelteBlockText'), ['{@html b}'])
    assert.deepEqual(tokens('a {@render b()} c\n', 'svelteBlockText'), ['{@render b()}'])
  })

  it('should reject a control block inline', () => {
    // Blocks are a flow construct by contract, which is what makes a stray
    // `{#if}` mid sentence prose rather than a syntax error.
    for (const value of ['use {#if a} here', 'close with {/if} at the end', 'a {:else} b']) {
      prose(value)
    }
  })
})

describe('control blocks: clause delimiting', () => {
  it('should balance braces in a string', () => {
    assert.deepEqual(blocks("{#each ['}'] as x}\nq\n{/each}\n"), [
      "{#each ['}'] as x}",
      '{/each}'
    ])
    assert.deepEqual(blocks('{#each ["}"] as x}\nq\n{/each}\n'), [
      '{#each ["}"] as x}',
      '{/each}'
    ])
  })

  it('should balance braces in a template literal', () => {
    assert.deepEqual(blocks('{#key `a}b`}\nq\n{/key}\n'), ['{#key `a}b`}', '{/key}'])
    assert.deepEqual(blocks('{#key `${a}`}\nq\n{/key}\n'), ['{#key `${a}`}', '{/key}'])
  })

  it('should balance braces in comments', () => {
    assert.deepEqual(blocks('{#if a /* } */}\nq\n{/if}\n'), ['{#if a /* } */}', '{/if}'])
    assert.deepEqual(blocks('{#if a // }\n}\nq\n{/if}\n'), ['{#if a // }\n}', '{/if}'])
  })

  it('should balance nested braces', () => {
    assert.deepEqual(blocks('{#each [{a: {b: 1}}] as x}\nq\n{/each}\n'), [
      '{#each [{a: {b: 1}}] as x}',
      '{/each}'
    ])
  })

  it('should support an escaped quote in a string', () => {
    assert.deepEqual(blocks("{#if a === 'it\\'s'}\nq\n{/if}\n"), [
      "{#if a === 'it\\'s'}",
      '{/if}'
    ])
  })

  it('should support a multi-line clause', () => {
    assert.deepEqual(blocks('{#if a &&\n  b}\nq\n{/if}\n'), ['{#if a &&\n  b}', '{/if}'])
  })

  it('should not let a clause cross a blank line', () => {
    prose('{#if a\n\nb}\n')
  })

  it('should reject an unterminated string', () => {
    prose("{#if 'a}\nq\n")
  })

  it('should reject a clause that never closes', () => {
    prose('{#if a\n')
  })
})

describe('control blocks: placement', () => {
  it('should require the construct to be alone on its line', () => {
    prose('{#if a} trailing\n')
    prose('before {/if}\n')
  })

  it('should allow trailing whitespace', () => {
    assert.deepEqual(blocks('{#if a}   \nq\n{/if}\t\n'), ['{#if a}', '{/if}'])
  })

  it('should interrupt a paragraph', () => {
    // A closer has to be able to end the paragraph above it.
    assert.deepEqual(blocks('prose\n{/if}\n'), ['{/if}'])
    assert.deepEqual(blocks('prose\n{#if a}\n'), ['{#if a}'])
  })

  it('should work inside a block quote', () => {
    assert.deepEqual(blocks('> {#if a}\n> q\n> {/if}\n'), ['{#if a}', '{/if}'])
  })

  it('should work inside a list item', () => {
    assert.deepEqual(blocks('- {#if a}\n\n  q\n\n  {/if}\n'), ['{#if a}', '{/if}'])
  })

  it('should leave the surrounding markdown alone', () => {
    const value = '# h\n\n{#if a}\n\n- x\n- y\n\n{/if}\n\n> q\n'
    assert.equal(count(value, 'atxHeading'), 1)
    assert.equal(count(value, 'listUnordered'), 1)
    assert.equal(count(value, 'blockQuote'), 1)
    assert.deepEqual(blocks(value), ['{#if a}', '{/if}'])
  })

  it('should not fire inside code', () => {
    assert.deepEqual(blocks('```\n{#if a}\n```\n'), [])
    assert.deepEqual(blocks('`{#if a}`\n'), [])
    assert.deepEqual(blocks('    {#if a}\n'), [])
  })
})

describe('comments', () => {
  it('should support a comment in flow and in text', () => {
    assert.deepEqual(tokens('<!-- a -->\n', 'svelteCommentFlow'), ['<!-- a -->'])
    assert.deepEqual(tokens('x <!-- a --> y\n', 'svelteCommentText'), ['<!-- a -->'])
  })

  it('should support an empty comment', () => {
    assert.deepEqual(tokens('<!---->\n', 'svelteCommentFlow'), ['<!---->'])
  })

  it('should support dashes inside', () => {
    assert.deepEqual(tokens('<!-- a - b -->\n', 'svelteCommentFlow'), ['<!-- a - b -->'])
    assert.deepEqual(tokens('<!-- a -- b -->\n', 'svelteCommentFlow'), ['<!-- a -- b -->'])
  })

  it('should span lines', () => {
    assert.deepEqual(tokens('<!-- a\nb -->\n', 'svelteCommentFlow'), ['<!-- a\nb -->'])
  })

  it('should not fire when unclosed', () => {
    assert.deepEqual(tokens('<!-- a\n', 'svelteCommentFlow'), [])
    assert.deepEqual(tokens('x <!-- a\n', 'svelteCommentText'), [])
  })

  it('should not fire on a partial opener', () => {
    assert.deepEqual(tokens('<!- a -->\n', 'svelteCommentFlow'), [])
    assert.deepEqual(tokens('<! a -->\n', 'svelteCommentFlow'), [])
  })

  it('should fall back to text when a flow comment has trailing content', () => {
    assert.deepEqual(tokens('<!-- a --> b\n', 'svelteCommentFlow'), [])
    assert.deepEqual(tokens('<!-- a --> b\n', 'svelteCommentText'), ['<!-- a -->'])
  })

  it('should work inside a block quote', () => {
    assert.deepEqual(tokens('> <!-- a\n> b -->\n', 'svelteCommentFlow'), ['<!-- a\nb -->'])
  })
})

describe('raw text elements', () => {
  /**
   * @param {string} value
   * @returns {Array<string>}
   */
  function raw(value) {
    return tokens(value, 'svelteTagFlowRaw')
  }

  it('should keep a script body unparsed', () => {
    assert.deepEqual(raw('<script>\nlet a = 1;\n</script>\n'), ['let a = 1;'])
  })

  it('should keep markup in the body unparsed', () => {
    assert.deepEqual(raw('<script>\nlet a = "<b>x</b>";\n</script>\n'), [
      'let a = "<b>x</b>";'
    ])
    assert.equal(count('<script>\n<b>x</b>\n</script>\n', 'svelteTagText'), 0)
  })

  it('should support attributes on the opening tag', () => {
    assert.deepEqual(raw('<script lang="ts" module>\nlet a: number = 1;\n</script>\n'), [
      'let a: number = 1;'
    ])
  })

  it('should support a single-line element', () => {
    assert.deepEqual(raw('<style>p { color: red }</style>\n'), ['p { color: red }'])
  })

  it('should support blank lines in the body', () => {
    assert.deepEqual(raw('<style>\na {}\n\nb {}\n</style>\n'), ['a {}', 'b {}'])
  })

  it('should support tabs in the body', () => {
    assert.deepEqual(raw('<script>\n\tlet a = 1;\n</script>\n'), ['\tlet a = 1;'])
  })

  it('should not stop at a lookalike closing tag', () => {
    assert.deepEqual(raw('<script>\nconst s = "</scriptish>";\n</script>\n'), [
      'const s = "</scriptish>";'
    ])
    assert.deepEqual(raw('<script>\nif (a) {} // </scr\n</script>\n'), [
      'if (a) {} // </scr'
    ])
  })

  it('should match the closing tag case-insensitively', () => {
    assert.deepEqual(raw('<script>\na\n</SCRIPT>\n'), ['a'])
  })

  it('should allow whitespace before the closing `>`', () => {
    assert.deepEqual(raw('<script>\na\n</script >\n'), ['a'])
  })

  it('should not fire on a self-closing tag', () => {
    assert.deepEqual(raw('<script />\n'), [])
  })

  it('should not fire on a closing tag', () => {
    assert.deepEqual(raw('</script>\n'), [])
  })

  it('should not fire inline', () => {
    // CSS or JavaScript in the middle of a sentence would otherwise be parsed
    // as markdown, and Svelte rejects either element anywhere but the top
    // level. A component inline is a different matter: see `rawComponents`.
    assert.deepEqual(tokens('a <style>b</style> c\n', 'svelteTagTextRaw'), [])
  })

  it('should not fire when the element never closes', () => {
    assert.deepEqual(raw('<script>\nlet a = 1;\n'), [])
    assert.deepEqual(tokens('<script>\nlet a = 1;\n', 'svelteTagFlow'), [])
  })

  it('should stop at the first closing tag', () => {
    // A browser ends the element there too, so the `}` after it is stray
    // content on the line and the element is not valid: it falls back to prose.
    assert.deepEqual(raw('<style>\na { b: "</style>" }\n</style>\n'), [])
  })

  it('should end at a closing tag followed by nothing else', () => {
    assert.deepEqual(raw('<style>\na { b: 1 }\n</style>\n'), ['a { b: 1 }'])
  })
})

describe('rawComponents', () => {
  /**
   * @param {string} value
   * @param {Array<string>} raw
   * @returns {Array<string>}
   */
  function held(value, raw) {
    return postprocess(
      parse({extensions: [svelteSyntax({rawComponents: raw})]})
        .document()
        .write(preprocess()(value, 'utf8', true))
    )
      .filter(function (event) {
        return (
          event[0] === 'enter' &&
          (event[1].type === 'svelteTagFlowRaw' || event[1].type === 'svelteTagTextRaw')
        )
      })
      .map(function (event) {
        return event[2].sliceSerialize(event[1])
      })
  }

  it('parses markdown inside a component by default', () => {
    // The default is the point of the project; this is the way out of it.
    assert.deepEqual(held('<Code>\n**md**\n</Code>\n', []), [])
  })

  it('holds the content of a component it is told to', () => {
    assert.deepEqual(held('<Code>\n**md**\n</Code>\n', ['Code']), ['**md**'])
  })

  it('leaves other components alone', () => {
    assert.deepEqual(held('<Callout>\n**md**\n</Callout>\n', ['Code']), [])
  })

  it('matches the name exactly', () => {
    // Svelte distinguishes `<Code>` from `<code>`, and so does this.
    assert.deepEqual(held('<code>**md**</code>\n', ['Code']), [])
    assert.deepEqual(held('<Cody>**md**</Cody>\n', ['Code']), [])
  })

  it('holds the content inline too', () => {
    assert.deepEqual(held('a <Code>**md**</Code> b\n', ['Code']), ['**md**'])
  })

  it('nests', () => {
    assert.deepEqual(held('<Code>a<Code>b</Code>c</Code>\n', ['Code']), ['a<Code>b</Code>c'])
  })

  it('is not confused by a name that starts the same', () => {
    assert.deepEqual(held('<Code>a<Codex>b</Codex>c</Code>\n', ['Code']), [
      'a<Codex>b</Codex>c'
    ])
  })

  it('does not count a self-closing tag as a nested one', () => {
    assert.deepEqual(held('<Code>a<Code />b</Code>\n', ['Code']), ['a<Code />b'])
  })

  it('needs a closing tag', () => {
    assert.deepEqual(held('<Code>a\n', ['Code']), [])
  })

  it('works with dotted and namespaced names', () => {
    assert.deepEqual(held('<Ui.Code>**md**</Ui.Code>\n', ['Ui.Code']), ['**md**'])
  })
})
