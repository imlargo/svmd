# Implementation architecture — `svmd`

> An engineering document. It complements [`SPEC.md`](./SPEC.md): the spec defines _what_ and
> _why_; this defines _how_, and records the decisions the spec left open.
>
> **Status:** implemented · v0.1

---

## 0. The decision in summary

A purpose-built `markdown → Svelte 5 source` compiler, shipped as a Vite plugin, in seven pieces:

| Package                                     | Responsibility                                                  | Depends on          |
| ------------------------------------------- | --------------------------------------------------------------- | ------------------- |
| `@svmd/micromark-factory-svelte-expression` | Brace balancing, as a micromark factory                         | `micromark-util-*`  |
| `@svmd/micromark-extension-svelte`          | The grammar: a micromark tokenizer extension                    | the above           |
| `@svmd/mdast-util-svelte`                   | Tokens → MDAST nodes, plus block tree construction              | the above           |
| `@svmd/core`                                | The whole pipeline: `compile(source) → { code, map, metadata }` | the above + unified |
| `@svmd/shiki`                               | Shiki highlighting, as an optional adapter                      | `@svmd/core`        |
| `svmd`                                      | The Vite plugin: scoping, resolution, HMR                       | `@svmd/core`        |
| `@svmd/content`                             | A minimal collections layer (spec §9)                           | nothing             |

The split answers R5/§7.2: the micromark extension is useful in isolation, and is the natural
surface for outside contributions. Why the boundaries fall exactly there is in
[`docs/structure.md`](./docs/structure.md).

---

## 1. Implementation decisions

These add to, or refine, decisions D1–D8 in the spec. Each carries its reason.

### I1 — Fork the MDX extensions, neither depend on them nor reimplement them (refines D4)

**Decision:** `micromark-extension-mdx-jsx`, `micromark-factory-mdx-expression` and
`mdast-util-mdx-jsx` are forked into this repository, with their JavaScript, their JSDoc types,
their state names and their tests. The first commit of each is upstream's source untouched, so
every later change is a reviewable diff.

**Reason.** Three things Svelte needs cannot be reached through configuration:

1. **The failure policy is inverted.** Upstream throws on a malformed tag or an unclosed brace,
   and it is right to: in MDX that is always an authoring error. In markdown, `a < b` and
   `use the {#if} block` are prose. Every dead end has to become `nok` so micromark can backtrack
   — that touches the core of every state, and is not an option you can pass.
2. **Directives are not JSX.** The `|` in `transition:fade|local` is not valid in a JSX attribute
   name, and F10 is a _Must_. Neither is `--accent="#f00"`, nor unquoted values.
3. **Quoted values interpolate.** `class="a {b} c"` is Svelte; in JSX a quote is opaque text.

**Rejected — depending on them unmodified:** impossible, for the three reasons above.

**Rejected — reimplementing from scratch:** this was the first attempt, and it was thrown away.
The tag tokenizer is 1104 lines of edge cases (Unicode identifiers, ES whitespace, quotes, members
and namespaces) and, above all, **7000 lines of tests**. Rewriting it means rediscovering by hand
what upstream already knows. The fork inherits both.

**What is not forked:** `micromark-util-events-to-acorn` needs no change at all, so it is a
dependency. Forking what you do not modify is free debt.

**Cost accepted:** maintaining ~2000 lines of someone else's code, including parts we do not use.
Mitigated by [`FORK.md`](./packages/micromark-extension-svelte/FORK.md), which records the exact
upstream commit and every divergence with its reason, and by upstream's own suites, which run
here: 161 tests, with every case whose behaviour changed still in place, rewritten to assert the
new one with the why beside it.

### I2 — acorn only where there is real ambiguity

The key observation: balancing braces and parsing JavaScript are separate problems.

- **Delimiting** `{...}` correctly (knowing strings, templates, comments and regexes) is a
  **lexical** problem. It is solved by a purpose-built state scanner, `factoryBraced`, running
  inside micromark's machine character by character. No acorn, no reserialisation, O(n).
- **Deciding whether `{something}` is an expression or prose** is a **syntactic** problem. That is
  where acorn belongs.

The division:

| Context                                  | Delimiting      | Validation                         |
| ---------------------------------------- | --------------- | ---------------------------------- |
| A bare `{expr}` in flow or text          | `factoryBraced` | **acorn** (D5)                     |
| `{#if expr}`, `{:else if expr}`, `{/if}` | `factoryBraced` | none — the context is unambiguous  |
| `{@html expr}`, `{@const …}`             | `factoryBraced` | none                               |
| `attr={expr}`, `{...spread}`             | `factoryBraced` | none — we are already inside a tag |

**Why blocks are not validated with acorn:** `{#each items as item, i (item.id)}` and
`{#snippet row(a, b)}` are not JavaScript expressions. Validating them would mean reimplementing
Svelte's parser, which changes every release (R1/R2). Delimiting them correctly is enough: the
semantic error comes from the Svelte compiler, and thanks to NF1 it points at the `.md` line.

Side effect: acorn almost never runs — prose rarely contains braces — which leaves ample room
under NF3.

### I3 — The prose-expression disambiguation rule (makes D5 concrete)

A bare `{…}` in text or flow context is accepted **only if**:

1. The scanner finds the closing brace **without crossing a blank line**.
2. `acorn.parseExpressionAt` parses it **completely**, with nothing left over.
3. The root node is **not** an `ObjectExpression`, a `SequenceExpression`, or empty.

Rule 3 is what makes D5's table hold:

| Prose input                        | Rule that rejects it                  | Result            |
| ---------------------------------- | ------------------------------------- | ----------------- |
| `use the {#if} block in your code` | `#` never opens an expression in text | `&#123;#if&#125;` |
| `{ "name": "foo" }`                | 3 — `ObjectExpression`                | escaped           |
| `put {a, b} here`                  | 3 — `SequenceExpression`              | escaped           |
| `a { stray unclosed one`           | 1 — EOF or blank line                 | escaped           |
| `{price}`                          | — accepted                            | Svelte expression |
| `{items.length}`                   | — accepted                            | Svelte expression |

A documented escape hatch: `{({ a: 1 })}` forces an object literal (acorn runs with
`preserveParens: true`, so the root node is a `ParenthesizedExpression`).

Every rejection is **silent and lossless**: micromark backtracks and the text survives literally,
to be escaped later. There is no error, because nothing is broken.

### I4 — Control blocks: flat markers, tree built afterwards

Writing a _container_ in micromark — something that wraps flow — is the hardest and most fragile
part of its API. **It is not done.**

The extension emits flat markers at the flow level:

```
{#if a}      → svelteBlockOpen
text         → paragraph        (ordinary flow, untouched)
{:else}      → svelteBlockBranch
text         → paragraph
{/if}        → svelteBlockClose
```

Nesting is built in `@svmd/mdast-util-svelte`, in one pass over the finished MDAST, with a stack.
What that buys:

- Content between markers is parsed as **ordinary** flow markdown, with no special rules.
- The stack holds exact positions for every marker → E001/E002/E003 with real lines and columns,
  including _"opened on line N"_.
- The matching code is ~120 lines of plain, testable JavaScript, not a CPS state machine.

### I5 — Tags: the "whole line" rule for flow context

The rule: **a line consisting of exactly one tag** (opening, closing or self-closing), with up to
three spaces of indentation, is a flow tag. Everything else containing `<` is parsed as inline.

```md
<Callout type="info"> ← flow (opening marker)

**markdown** text ← ordinary flow: a child paragraph

</Callout> ← flow (closing marker)

This is <Badge>x</Badge> here. ← a paragraph with inline tags
```

Same mechanism as I4: flat markers, tree afterwards. Consequences:

- **L6 solved**: markdown inside components is parsed, because `htmlFlow` is off and the content
  between markers is ordinary flow.
- **G2 gone**: `<Foo.Bar />` works; the name is defined by our grammar, not by CommonMark.
- **G1 gone**: `<Chart data={{ a: 1 }} />` works; `factoryBraced` counts braces.
- The blank line after the opening tag stops being required (a compatible superset of §8.1).

**A correction found while implementing.** With only the rule above,
`<div class="note">text</div>` on one line is inline content, and ends up wrapped in a paragraph:
`<p><div>…</div></p>`, which is invalid nesting and which Svelte rightly rejects. A second pass,
`unwrapBlockElements`, is added: a paragraph whose content is **only** block elements loses its
`<p>`.

The test for "block" is CommonMark's own list of HTML block names
(`micromark-util-html-tag-name`), plus anything shaped like a component. So `<em>text</em>` alone
on its line is still a paragraph, which is correct, and `<div>` is not.

**A second correction, from the same root.** The rule above only saves a paragraph that is
_nothing but_ elements. `text <div>x</div> more` mixes the two, and the `<div>` ends up inside the
`<p>` anyway — which is not a cosmetic detail: Svelte rejects it with _"`</p>` attempted to close
an element that was already automatically closed"_. The paragraph is **split** around the element,
which is the standard resolution and keeps the prose's paragraphs:
`<p>text </p><div>x</div><p> more</p>`.

For a **component** this is not decidable: what `<Card>` renders is not knowable from here.
Position is the only signal, and it is right for the common case — inline mid-sentence, block alone
on its line. For the case it gets wrong there is `blockElements`, an explicit list that changes no
default behaviour. Guessing would have split `Press <Button>here</Button> now` into three
paragraphs, which is worse than the problem it solves.

### I6 — CommonMark's `htmlFlow` and `htmlText` are disabled

Our tag grammar replaces them entirely. It is what MDX does, and it is the only way to resolve
CR2/L6: while CommonMark's HTML-block rule is active, `<div>` keeps swallowing markdown until the
next blank line.

Added in their place:

- Comments `<!-- … -->`, in both flow and text.
- **Raw-text elements**: `<script>` and `<style>` consume their content unparsed up to their
  matching closing tag. This is what makes F11 and F12 possible.

### I7 — AST-guided script merging that **preserves text** (refines D6)

D6 says "merge as an AST, never by concatenating strings". The nuance that matters:
**regenerating code from an AST destroys TypeScript**, and F11 is a _Must_.

Implementation: _analyse_ with `acorn` + `acorn-typescript` to get top-level declarations and
imports; _emit_ the original text, trimmed with `magic-string`. Nothing is regenerated.

Operations:

- Collect declared names per block → collision detection (E008), and which frontmatter bindings
  can be created without overwriting the user's.
- Deduplicate identical imports across blocks. **Across scopes too**: Svelte flattens
  `<script module>` and `<script>` into one module, so an import repeated in both is a duplicate
  declaration error. The fixture suite found that, not the design.
- Strict separation of `<script module>` from `<script>`.
- `lang="ts"` propagates to the output `<script>` if any input block declared it.

**No identifier renaming.** With D7 (no layouts of our own) the only possible collision is the
user with themselves, and there an explicit error is better engineering than a silent rename.

### I8 — Frontmatter bindings

`# {title}` has to work (§8.1). `const { title, … } = metadata;` is generated in the
`<script module>` for every key that:

1. Is a valid JavaScript identifier.
2. Is not a reserved word, and not `metadata`.
3. Is not already declared or imported by the user, in either scope.

**Rejected:** declaring only the keys actually referenced. It would have required scanning
identifiers inside expressions, and block clauses (`{#each items as item}`) are not expressions,
so the scan would have been heuristic. An unused module constant costs nothing, and the resulting
rule fits in one sentence.

### I9 — Generation with `SourceBuilder`, not `magic-string` (refines §10.3)

`magic-string` is for _editing_ an existing string. We **generate** a new one from a tree.
`SourceBuilder` is an accumulator that takes `(text, optionalOriginPoint)` and produces code plus
a v3 source map encoded with `@jridgewell/sourcemap-codec`.

`magic-string` **is** used inside I7, where there really is existing text to edit.

### I10 — Vite integration: the `.svmd.svelte` shadow id

Verified empirically against Vite 8 and `@sveltejs/vite-plugin-svelte` 7.

`vite-plugin-svelte` filters on a regex over the id: `^[^?#]+\.(svelte)(?:[?#]|$)`. The only
contract stable across its versions is _"it compiles whatever ends in `.svelte`"_.

```
import './post.md'
   │
   ├─ svmd.resolveId  →  this.resolve() → /abs/post.md  →  /abs/post.md.svmd.svelte
   ├─ svmd.load       →  reads /abs/post.md, compiles, returns { code, map }
   └─ vite-plugin-svelte:preprocess / :compile  →  sees `.svelte` → compiles
```

**Rejected alternative:** mutating the Svelte plugin's `api.filter` from `configResolved`. It
works, and it avoids the phantom id, but it couples us to an internal type (`PluginAPI`) that does
not exist in versions ≤ 5. NF6 and R1/R2 outweigh the aesthetics of the id.

**Cost accepted and mitigated:** the module id is not the file on disk, so the watcher cannot find
the module by itself. The `hotUpdate` hook corrects that by mapping `file → file + suffix`. Source
maps point at the real `.md`, so errors and devtools show the right file.

### I11 — Frontmatter validation through Standard Schema (resolves Q3)

Rather than coupling to Zod or Valibot, `frontmatter.schema` accepts anything implementing
[Standard Schema](https://standardschema.dev). Zod 4, Valibot and ArkType implement it out of the
box. No dependency added, no lock-in. A validation failure produces E007 with the field's path.

### I12 — No highlighter by default (resolves Q6)

`highlight` defaults to `false`: code blocks come out as `<pre><code class="language-js">` with
escaped content. Anyone who wants Shiki installs `@svmd/shiki`, a separate package implementing
the `Highlighter` interface and declaring `shiki` as its own peer dependency.

The adapter lives outside `core` by the same rule that separates everything else: a dependency
boundary is a package boundary. So `core` has no optional peers, `shikiHighlighter()` stops being
exported twice from two packages, and a future `@svmd/prism` fits in symmetrically.

Reason: the core should not drag ~10 MB of grammars along for the case where the user already uses
`rehype-pretty-code`, Prism, or their own CSS. Explicit over magic.

### I13 — `smartypants` is not an option

Spec §7.3 listed it. Rejected: it is exactly what `remarkPlugins` solves, and adding it would mean
carrying `remark-smartypants` as a dependency for a typographic choice not everyone wants. It is
documented in the README as one line of configuration instead.

Effect: the public surface is **seven** options, not ten (NF9).

### I14 — Frontmatter is YAML 1.2

The parser (`yaml`) uses the YAML 1.2 core schema, which has no timestamps: `date: 2026-09-12` is
a string. `js-yaml`, which mdsvex uses, applies YAML 1.1 and returns a `Date`.

1.2 is chosen deliberately: implicit conversion is a classic source of surprises, and the explicit
path already exists and is better — `z.coerce.date()` in the schema (I11). The schema's output is
what ends up in `metadata`, and `devalue` serialises the resulting `Date` correctly.

### I15 — Stepping outside markdown is opt-in, not the default

**Decision:** markdown is parsed inside every component. `rawComponents` lists the ones that
prefer to handle their own content, and inside those the text reaches Svelte verbatim: markdown
syntax stays literal and braces are **not** escaped.

**Reason.** Markdown inside components is F5 (_Must_) and L6 — one of the four things this project
fixes relative to mdsvex. Removing it by default would take that with it. But some components have
no use for parsed content: one that shows code, an editor, anything that cares about whitespace.

**Why in the configuration and not an attribute.** A component handling its own children is a
property of the component, not of where it is used. A `<Code raw>` here and a `<Code>` there is
exactly the kind of inconsistency that makes markdown unpredictable. Same reasoning as
`blockElements` (I5).

**Implementation:** it reuses the raw-text scanner from `<script>` and `<style>`, with two
additions those do not need — case-sensitive matching (Svelte distinguishes `<Code>` from
`<code>`) and depth counting, because a component really can contain another of the same name. The
lookahead reads the opening tag through to its `>` so that `<Code />`, which opens nothing, is not
counted.

### Other open questions from the spec

|                              | Decision                                                               |
| ---------------------------- | ---------------------------------------------------------------------- |
| **Q1** name                  | `svmd` (the main package), `@svmd/*` (the rest)                        |
| **Q2** preprocessor          | No. Vite plugin only. A preprocessor reintroduces CR1                  |
| **Q4** `.svx`                | Not by default; reachable with `include: ['**/*.svx']`                 |
| **Q5** explicit escape       | No new syntax needed: I3 covers prose, and `{'{'}` is the escape hatch |
| **Q7** migration from mdsvex | Out of scope for v1                                                    |

---

## 2. Pipeline

```
 .md on disk
      │
      ▼  svmd (Vite, enforce: 'pre')            [D1][D3][I10]
      │  include/exclude filter → shadow id
      │
      ▼  @svmd/core · compile()
      │
      ├─ 1. frontmatter        micromark-extension-frontmatter + yaml   [F2][I11]
      │
      ├─ 2. parse              micromark + @svmd/micromark-extension-svelte
      │                        (htmlFlow/htmlText OFF)                  [I1][I6]
      │
      ├─ 3. from-markdown      @svmd/mdast-util-svelte → MDAST
      │
      ├─ 4. transform          block and tag tree construction,
      │                        nesting validation (E001–E005)           [I4][I5]
      │                        <script>/<style> extraction              [I6]
      │
      ├─ 5. remarkPlugins      the user's · `code` nodes are real       [F15][F16]
      │
      ├─ 6. mdast → hast       remark-rehype, passing svelte* nodes through
      │
      ├─ 7. rehypePlugins      the user's                               [F15]
      │
      ├─ 8. highlight          optional                                 [F17][I12]
      │
      ├─ 9. generate           hast → Svelte source, SourceBuilder      [D2][I9]
      │                        brace escaping in text/raw               [D5][I3]
      │
      └─ 10. scripts           AST-guided merge, bindings, metadata     [D6][I7][I8]
      │
      ▼  { code: <.svelte source>, map, metadata }
      │
      ▼  @sveltejs/vite-plugin-svelte  →  JS + CSS
```

---

## 3. Data model (MDAST)

```ts
// Expressions
{ type: 'svelteFlowExpression' | 'svelteTextExpression', value: string }

// Special tags: {@html …}, {@const …}, {@render …}, {@debug …}, {@attach …}
{ type: 'svelteFlowTag' | 'svelteTextTag', name: 'html'|'const'|…, value: string }

// Control blocks — always a uniform tree of branches
{ type: 'svelteBlock', name: 'if'|'each'|'await'|'key'|'snippet',
  children: SvelteBranch[] }
{ type: 'svelteBranch', marker: '#if'|':else if'|':then'|…, value: string,
  children: Content[] }

// Elements
{ type: 'svelteFlowElement' | 'svelteTextElement',
  name: string,                       // 'div', 'Callout', 'Foo.Bar', 'svelte:head'
  attributes: Attribute[],
  children: Content[] }

// Attributes
{ type: 'svelteAttribute', name: string, shorthand?: boolean,
  value: null | Array<{ type:'text', value:string } | { type:'expression', value:string }>,
  quote: '"' | "'" | null }
{ type: 'svelteSpreadAttribute', value: string }

// Raw (hoisted; these never reach the markup generator)
{ type: 'svelteScript', module: boolean, lang: string|null, value: string, attributes: Attribute[] }
{ type: 'svelteStyle', value: string, attributes: Attribute[] }
{ type: 'svelteComment', value: string }
```

An attribute's `name` is stored **verbatim**, directive and modifiers included
(`transition:fade|local`). Taking it apart is a helper's job, not the tree's.

---

## 4. Escaping table (implements §8.3)

| hast node                                         | `<` `&`           | `{` `}`             |
| ------------------------------------------------- | ----------------- | ------------------- |
| `text`                                            | HTML-escaped      | `&#123;` / `&#125;` |
| `element` (text properties)                       | attribute-escaped | `&#123;` / `&#125;` |
| `raw` (from rehype or the highlighter)            | verbatim          | `&#123;` / `&#125;` |
| `svelteRaw` (explicit opt-in)                     | verbatim          | verbatim            |
| `svelte*Expression`, `svelte*Tag`, `svelteBranch` | verbatim          | verbatim            |
| `svelteScript`, `svelteStyle`                     | verbatim          | verbatim            |

`raw` nodes have their braces escaped because that is what Shiki produces: the highlighted HTML of
`function f() {` contains real braces that Svelte would read as expressions. `&#123;` inside an
attribute or in text is valid HTML, and Svelte decodes it correctly.

---

## 5. Error catalogue

Extends §10.2 with the codes that appeared while designing.

| Code   | Condition                                                             |
| ------ | --------------------------------------------------------------------- |
| `E001` | Unclosed `{#…}` block                                                 |
| `E002` | `{/…}` close with no opening                                          |
| `E003` | Crossed nesting, or a branch outside its block                        |
| `E005` | Unclosed tag, orphan close, or crossed close                          |
| `E006` | Invalid YAML frontmatter                                              |
| `E007` | Frontmatter does not match the schema                                 |
| `E008` | Duplicate declaration across `<script>` blocks                        |
| `E009` | More than one instance `<script>`, or more than one `<script module>` |
| `W001` | Content indented 4+ spaces inside an element or branch (G5)           |
| `W002` | A `<script>` or `<style>` hoisted out of the block it was written in  |

Every error is a `SvmdError` carrying `code`, `filename`, `start`, `end`, `hint` and `frame`, and
exposes `loc`/`frame` in the shape Rollup and Vite already know how to print. Warnings travel in
`CompileResult.warnings`, and the Vite plugin emits them with `this.warn()`.

**On the spec's `E004`** (_"expression that acorn cannot parse"_): it does not exist, as a direct
consequence of I2. In text context, an expression that does not parse is not an error — it is
prose, and it gets escaped. In the other contexts acorn deliberately does not validate, because
`{#each a as b}` and `{#snippet f(x)}` are not JavaScript expressions. The semantic error comes
from Svelte, and thanks to NF1 it points at the right `.md` line. An error code that is never
emitted is worse than not having one.

**On the spec's `W002`** (_"attribute with unwrapped spaces"_): that one does not exist either,
because the G1 gotcha behind it disappeared with I1 — `<Chart data={{ a: 1 }} />` simply works.
The code is reused for a warning that was actually needed: a `<script>` written inside an `{#if}`
is hoisted to the top of the component and therefore does **not** run conditionally, which the
source does not say anywhere.

---

## 6. Repository layout

```
svmd/
├── ARCHITECTURE.md            ← this document
├── SPEC.md                    what the language is
├── CONTRIBUTING.md            how the work is done
├── CHANGELOG.md               one changelog; every package shares a version
├── docs/structure.md          why the repository is split the way it is
├── package.json               workspace root (private)
├── pnpm-workspace.yaml
├── tsconfig.json              one type-check for the whole workspace
├── eslint.config.js  .prettierrc  .lintstagedrc.json  .editorconfig
├── packages/
│   ├── micromark-factory-svelte-expression/   fork · brace balancing       [I1]
│   │   └── index.js
│   ├── micromark-extension-svelte/            fork · the grammar           [I1]
│   │   ├── FORK.md                  what diverges from upstream, and why
│   │   ├── index.js                 the public types, hand-written
│   │   └── lib/
│   │       ├── syntax.js            the assembled extension
│   │       ├── factory-tag.js       fork of mdx-jsx · tags
│   │       ├── factory-raw-text.js  ours · <script> / <style>       [I6]
│   │       ├── tag-flow.js          fork · a tag in flow
│   │       ├── tag-text.js          fork · an inline tag
│   │       ├── expression.js        fork · {expr} in flow and text  [I3]
│   │       ├── block.js             ours · {#if} {:else} {@html}    [I4]
│   │       └── comment.js           ours · <!-- … -->
│   ├── mdast-util-svelte/                     fork · tokens → MDAST        [I1]
│   │   ├── index.js
│   │   └── lib/
│   │       ├── index.js             fork of mdast-util-mdx-jsx
│   │       ├── nodes.d.ts           MDAST types
│   │       └── unwrap.js            ours · unwraps blocks from paragraphs [I5]
│   ├── core/                                  the compiler
│   │   └── src/
│   │       ├── index.ts             the public API
│   │       ├── compile.ts           orchestrates the three stages
│   │       ├── parse/               text → MDAST
│   │       │   ├── pipeline.ts      unified, cached
│   │       │   └── frontmatter.ts                                   [I11]
│   │       ├── transform/           MDAST → HAST
│   │       │   ├── to-hast.ts
│   │       │   ├── hoist.ts         extracts <script> / <style>
│   │       │   └── highlight.ts     the Highlighter contract        [I12]
│   │       ├── generate/            HAST → Svelte source            [I9]
│   │       │   ├── component.ts     final assembly
│   │       │   ├── markup.ts  attributes.ts  escape.ts
│   │       │   ├── metadata.ts      export const metadata
│   │       │   └── script/          AST-guided merge                [I7][I8]
│   │       ├── diagnostics/         errors.ts · warnings.ts
│   │       └── internal/            source-builder.ts               [I9]
│   │                                names.ts
│   ├── shiki/                                 highlighting adapter  [I12]
│   │   └── src/index.ts
│   ├── svmd/                                  the Vite plugin
│   │   └── src/index.ts                                             [I10]
│   └── content/                               runtime, zero deps
│       └── src/index.ts                                             [D8]
├── test/                                      pipeline integration
│   ├── fixtures/                    the cases from §11.3 and appendix C
│   ├── snapshots/
│   └── *.test.ts
├── scripts/
│   ├── smoke.mjs                    the built dist/, on the oldest Node
│   └── consumer-check.mjs           the tarballs, installed clean
├── examples/kit-blog/               the SvelteKit verification app
└── .github/workflows/{ci,release}.yml
```

The four TypeScript packages (`core`, `shiki`, `svmd`, `content`) are built with **tsdown**, one
at a time and in topological order. The three forks are not built: they publish their JavaScript
as it stands, the way upstream does, and their public declarations are hand-written in each
package's root `index.d.ts` — see [CONTRIBUTING.md](./CONTRIBUTING.md#the-forks) for why.

---

## 7. Verification

The suite is the executable specification. Every level is mandatory:

| Level       | What it proves                                                                           | Where                                      |
| ----------- | ---------------------------------------------------------------------------------------- | ------------------------------------------ |
| Grammar     | the tokens emitted, and above all **what is not** tokenised                              | `packages/micromark-extension-svelte/test` |
| Tree        | nesting, and errors E001–E005 with their positions                                       | `packages/mdast-util-svelte/test`          |
| Fixtures    | every `.md` from §11.3 against a snapshot **and** against `svelte.compile`, warning-free | `test/fixtures.test.ts`                    |
| Regression  | the mdsvex issues from appendix C, one per test                                          | `test/regressions.test.ts`                 |
| Diagnostics | the whole §5 catalogue                                                                   | `test/diagnostics.test.ts`                 |
| Source maps | NF1, with `@jridgewell/trace-mapping`                                                    | `test/sourcemap.test.ts`                   |
| Integration | a real Vite build and dev server                                                         | `test/vite-plugin.test.ts`                 |
| Performance | NF3, plus linearity and brace-heavy prose                                                | `test/performance.test.ts`                 |
| Invariants  | the fixtures against micromark's _development_ build, which asserts token balance        | `test/assertions.test.ts`                  |
| Typed API   | that `entry.data` infers from a collection's schema                                      | `test/content.test.ts`                     |
| End-to-end  | a SvelteKit app that prerenders                                                          | `examples/kit-blog`                        |

Two further lanes exist because the suite above resolves `@svmd/core` to the source tree through a
vitest alias, which makes the loop fast and means a broken `exports` map passes in green:

| Lane                         | What runs                                | What it catches                                     |
| ---------------------------- | ---------------------------------------- | --------------------------------------------------- |
| `scripts/smoke.mjs`          | the **built** dist/, on the oldest Node  | a broken build, a dropped export, a false `engines` |
| `scripts/consumer-check.mjs` | the **packed tarballs**, installed clean | `exports` maps, `files` lists, peer ranges          |

**A snapshot is never enough on its own.** Every fixture is also compiled with `svelte.compile`
and required to produce zero warnings: a pretty snapshot that Svelte rejects is not a passing
test. That rule found three real bugs — imports duplicated across scopes, globs resolved against
`process.cwd()`, and tabs breaking the raw-text tokenizer.

### What it measured

- 5.9 ms median for a 256-line document with components, blocks, code and tables (the NF3 budget
  is 20 ms).
- 375 tests in ~6 s.
