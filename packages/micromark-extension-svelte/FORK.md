# What this fork changes

Three of the five packages here are forks of the micromark extensions that MDX
uses. They keep upstream's JavaScript, JSDoc types, file layout, state names and
documentation comments, so that `git diff` against the original stays readable
and a future upstream fix can be applied by hand.

The first commit of each was the upstream source, unmodified, so every change
below is a reviewable diff against it.

## Provenance

| Package here | Upstream | Version | Commit |
|---|---|---|---|
| `@svmd/micromark-extension-svelte` | [`micromark-extension-mdx-jsx`](https://github.com/micromark/micromark-extension-mdx-jsx) | 3.0.2 | `ad0a49c716c9` |
| … also merges | [`micromark-extension-mdx-expression`](https://github.com/micromark/micromark-extension-mdx-expression) | 3.0.1 | `2891b75ff9e9` |
| `@svmd/micromark-factory-svelte-expression` | [`micromark-factory-mdx-expression`](https://github.com/micromark/micromark-extension-mdx-expression) | 2.0.3 | `2891b75ff9e9` |
| `@svmd/mdast-util-svelte` | [`mdast-util-mdx-jsx`](https://github.com/syntax-tree/mdast-util-mdx-jsx) | 3.2.0 | `998d98d0aa29` |

All MIT, Copyright (c) Titus Wormer. Each package keeps its `LICENSE-upstream`.

`micromark-util-events-to-acorn` is **not** forked: it needs no change, and
forking something you do not modify is debt for nothing. It is a dependency.

## Why fork at all

Three things Svelte needs cannot be reached through configuration:

1. **The failure policy is inverted.** Upstream throws on a malformed tag or an
   unbalanced brace, and it is right to: in MDX that is always an authoring
   error. In markdown, `a < b` and `use the {#if} block` are prose. Every dead
   end had to become a `nok` so micromark can backtrack — that is a change to
   the core of every state, not an option.
2. **Directive syntax is not JSX.** `transition:fade|local`, `--accent="#f00"`
   and unquoted values are rejected by the JSX grammar.
3. **Quoted attribute values interpolate.** `class="a {b} c"` is Svelte; in JSX
   a quoted value is opaque text.

## Changes to the tag grammar (`lib/factory-tag.js`)

| Change | Why |
|---|---|
| `crash()` → `fail()`, returns `nok` | `a < b` in prose is prose |
| Attribute names accept `-` first and `\|` anywhere | `--accent`, `transition:fade\|local` |
| Unquoted attribute values | `<a href=/docs>`, which HTML and Svelte allow |
| `{expression}` inside quoted values | `class="a {b} c"` |
| `<script>` and `<style>` are raw text | they hold JavaScript and CSS, not markdown |
| Fragments (`<>`) rejected | Svelte has none; `<svelte:fragment>` is an ordinary name |
| 25 positional token types → one object | room for the types Svelte needs |
| `addResult` and the estree plumbing dropped | expressions are re-emitted verbatim |

## Changes to the expression factory

| Change | Why |
|---|---|
| Throws → `nok` on end of file and on lazy lines | as above |
| A blank line ends the attempt | a stray `{` must not swallow the document |
| `prefix`: a state run after `{` | lets `{#if cond}` reuse the balancing |
| Agnostic mode understands strings and comments | `{#each ['}'] as x}`; block clauses are not JS expressions, so they can only be delimited |
| `spread` accepts a shorthand property | `<C {value} />` |
| Reports whether the value was parenthesised | `eventsToAcorn` normalises `ParenthesizedExpression` away, and `{({a: 1})}` has to stay distinguishable from pasted JSON |

## Changes to the mdast layer

Kept from upstream, and the reason to fork rather than start over: the tag
stack, the `buffer`/`resume` discipline for reading values out of the event
stream, and the `onEnterError`/`onExitError` hooks that turn a mismatched tag
into a positioned message.

| Change | Why |
|---|---|
| Svelte nodes instead of MDX ones | different target |
| Attribute values are a list of parts | `class="a {b} c"` interpolates |
| Control blocks, comments, raw elements | JSX has no shape for any of them |
| Errors carry the `svmd` catalogue codes | so the compiler renders them with a code frame |
| The `toMarkdown` half dropped | nothing here serialises back to markdown |

## Behaviour that differs, on purpose

Upstream's own test suites run against this fork — 161 of them in
`packages/micromark-extension-svelte/test/`. Every case that behaves
differently is still there, rewritten to assert the new behaviour with the
reason next to it. The differences are:

| Input | Upstream | Here |
|---|---|---|
| `a < b`, `a <b@c.d>` | throws | prose, and the second is an autolink |
| `a <!--b-->` | throws | an HTML comment |
| `a <></>` | a fragment | prose |
| `a {} b` | an empty expression | prose |
| `a <b {1 + 1} />` | an attribute expression | prose; not a Svelte attribute |
| `a <b c={d\ne} />` | works without acorn | prose; acorn is always on |
| `a <a></(> b.` | throws, losing the line | `<a>` still parses, `</(>` is prose |
| `> <X\n/>` | throws on the lazy line | the flow tag declines, the paragraph's inline tag takes it |
| `<style>{\`…\`}</style>` | an expression | raw CSS |

The last one but one is worth calling out: it is a consequence of the fork's
core decision rather than a choice of its own. Upstream throws, which ends the
parse. Here the flow construct returns `nok`, the line becomes an ordinary
paragraph — a lazy continuation is legal for a paragraph — and the text-level
tag construct, which allows lazy lines exactly as upstream's does, reads the tag
inside it.

## Tests for what has no upstream ancestor

Control blocks, comments and raw-text elements have no equivalent in JSX, so
none of upstream's 1736 lines of tag tests apply to them. `test/svelte.js`
stands in for that: 56 cases over the clause delimiter (strings, template
literals, comments, nesting, escapes, multi-line, blank lines), placement
(alone on a line, interrupting a paragraph, inside a block quote or a list
item, never inside code), every opener, branch, closer and tag, and the raw
text rules (attributes, case-insensitive and whitespace-tolerant closers,
lookalike closers, blank lines, tabs, unclosed, inline).

Writing it found two bugs: `{#if2 a}` was read as `{#if}` with the clause
`2 a`, because the name run stopped at the first non-letter; and `<style>`
inline parsed as an ordinary tag, so its CSS was parsed as markdown and landed
somewhere Svelte rejects.

Those inputs also run under micromark's development assertions, in
`test/assertions.test.ts` at the root — which is what caught a lookahead
consuming with no token open.

## What was dropped from upstream's tests

- `micromark-extension-mdx-jsx`: the `positional info` block, which asserts the
  shape of the estree `addResult` attaches. This fork builds none. The positions
  that matter are asserted against the compiled output in `test/sourcemap.test.ts`.
- `micromark-extension-mdx-expression`: the `api`, `spread (hidden)` and
  agnostic-mode blocks, which test options this fork does not have.
- `mdast-util-mdx-jsx`: two thirds of it asserts `mdxJsxToMarkdown`, and the
  rest asserts MDX node shapes. Replaced by
  `packages/mdast-util-svelte/test/structure.js`.

## Where this stands against CommonMark

Measured against the 655 examples of the CommonMark 0.31.2 spec, with the same
harness run twice — once on stock micromark, once with this extension:

```
micromark      649 / 655
with svmd      566 / 655
```

The 83 differences all involve `<`, every one of them. Not a single example that
does not touch HTML behaves differently, which is the contract: this grammar
replaces CommonMark's raw HTML and leaves the rest of markdown alone.

Of those 83: 50 compile and render, 33 raise `E005` — an unclosed or orphan
element — which is the loud version of what CommonMark would have passed through
silently. `<foo.bar.baz>` is literal text in CommonMark and an unclosed
component here, and saying so is the point of having a tag grammar at all.

## Bounded backtracking

A construct that never closes scans forward before it gives up, so a paragraph
holding many of them costs O(n²). Expressions and comments therefore stop after
32 lines, the way micromark bounds its own backtracking
(`linkResourceDestinationBalanceMax`). Four hundred lines of stray braces went
from 258 ms to 54 ms, and from quadratic to linear. Tags needed no bound: an
unclosed one fails at the first character that cannot continue a tag.

## Type checking

The forked packages are JavaScript with JSDoc types, as upstream ships them, and
`tsc` emits their declarations from those types.

Their declarations go to `types/`, not next to the source. That is not a
preference: a `.d.ts` sitting beside its own `.js` shadows it, TypeScript stops
reading the source, and `checkJs` quietly becomes a no-op after the first
build. It had already become one here, and turning it back on surfaced four real
type errors in the mdast layer that nothing else would have caught.
