# Architecture

How `svmd` turns markdown into Svelte 5 component source, and how the repository is organized
around that.

## Packages

| Package                                     | Responsibility                                                  | Depends on          |
| ------------------------------------------- | --------------------------------------------------------------- | ------------------- |
| `@svmd/micromark-factory-svelte-expression` | Brace balancing, as a micromark factory                         | `micromark-util-*`  |
| `@svmd/micromark-extension-svelte`          | The grammar: a micromark tokenizer extension                    | the above           |
| `@svmd/mdast-util-svelte`                   | Tokens → MDAST nodes, plus block tree construction              | the above           |
| `@svmd/core`                                | The whole pipeline: `compile(source) → { code, map, metadata }` | the above + unified |
| `@svmd/shiki`                               | Shiki highlighting, as an optional adapter                      | `@svmd/core`        |
| `@svmd/vite`                                | The Vite plugin: scoping, resolution, HMR                       | `@svmd/core`        |
| `@svmd/content`                             | A minimal collections layer over `import.meta.glob`             | nothing             |

Package boundaries follow dependency boundaries, not layers. `@svmd/shiki` is separate because it
has a different peer dependency (`shiki`) than `core`. `@svmd/content` is separate because it runs
in the browser and stays at zero runtime dependencies. `core`, `shiki` and `vite` never point
"upward": `core` does not know Vite exists, and `content` touches neither.

The three grammar packages (`micromark-factory-svelte-expression`, `micromark-extension-svelte`,
`mdast-util-svelte`) are published on their own because each one's public surface is a single
function whose shape micromark or mdast dictates, not us. Anyone writing a Prettier plugin, an
ESLint parser, or an LSP for this dialect needs exactly those packages and none of the compiler.

```
                      @standard-schema/spec  (types only, external)
                         │                    │
    micromark-factory-svelte-expression       │
                         │                    │
            micromark-extension-svelte        │
                    │                         │
             mdast-util-svelte                │
                    │                         │
                 @svmd/core ─────────────────-┘
                 │        ▲
                 │        │ (the Highlighter interface only)
      @svmd/vite │        │
                 │   @svmd/shiki ──peer──> shiki
                 └──peer──> vite, @sveltejs/vite-plugin-svelte, svelte

    @svmd/content  ── zero runtime dependencies ──> (@standard-schema/spec, types only)
```

## The forks

`packages/micromark-extension-svelte`, `packages/micromark-factory-svelte-expression` and
`packages/mdast-util-svelte` are forks of Titus Wormer's MDX packages
(`micromark-extension-mdx-jsx`, `micromark-factory-mdx-expression`, `mdast-util-mdx-jsx`), with
their JavaScript, JSDoc types, state names and tests. `FORK.md` in each package records the
upstream commit and every divergence, with its reason.

They are forked rather than depended on because three things Svelte needs cannot be reached
through configuration of the upstream packages:

- **The failure policy is inverted.** Upstream throws on a malformed tag or an unclosed brace,
  which is correct for JSX. In markdown, `a < b` and `use the {#if} block` are prose, so every dead
  end has to become a backtrack (`nok`) instead of a throw — that touches the core of most states.
- **Directives are not JSX.** `transition:fade|local`'s `|`, and unquoted or `--`-prefixed
  attribute names, are not valid JSX.
- **Quoted attribute values interpolate.** `class="a {b} c"` is Svelte; in JSX a quoted value is
  opaque text.

They are forked rather than reimplemented because the upstream tag tokenizer already handles a
long tail of edge cases (Unicode identifiers, ES whitespace, quotes, members, namespaces) backed
by roughly 7000 lines of tests, all of which the fork inherits.

The forks are excluded from ESLint and Prettier, and keep upstream's `tsconfig.json`, file names
and `test/*.js` suites: reformatting them would make future diffs against upstream unreadable,
and that diff is the property that makes pulling in an upstream fix possible at all. Their public
types are hand-written in each package's root `index.d.ts` rather than generated from JSDoc,
because JSDoc-generated declarations land in `types/`, which is unreachable from the package root
and silently resolves re-exports to `any`.

`micromark-util-events-to-acorn` is used unforked, since nothing about it needs to change.

## Pipeline

```
 .md on disk
      │
      ▼  svmd (Vite, enforce: 'pre')
      │  include/exclude filter → shadow id (see "Vite integration" below)
      │
      ▼  @svmd/core · compile()
      │
      ├─ 1. frontmatter        micromark-extension-frontmatter + yaml (YAML 1.2 core schema)
      │
      ├─ 2. parse              micromark + @svmd/micromark-extension-svelte
      │                        (CommonMark's htmlFlow/htmlText are disabled)
      │
      ├─ 3. from-markdown      @svmd/mdast-util-svelte → MDAST
      │
      ├─ 4. transform          block and tag tree construction, nesting validation (E001–E005)
      │                        <script>/<style> extraction
      │
      ├─ 5. highlight          optional (off by default; see "Highlighting" below)
      │
      ├─ 6. remarkPlugins      the user's — unhighlighted fenced code arrives as a real `code` node
      │
      ├─ 7. mdast → hast       remark-rehype, passing svelte* nodes through
      │
      ├─ 8. rehypePlugins      the user's
      │
      ├─ 9. generate           hast → Svelte source, via SourceBuilder
      │                        brace escaping in text; raw HTML as `{@html}`
      │
      └─ 10. scripts           AST-guided merge, frontmatter bindings, metadata
      │
      ▼  { code: <.svelte source>, map, metadata }
      │
      ▼  @sveltejs/vite-plugin-svelte  →  JS + CSS
```

### Brace handling

Balancing `{...}` (finding the matching close, aware of strings, templates, comments and regexes)
is a lexical problem, solved by `factoryBraced`, a purpose-built state scanner that runs inside
micromark character by character — no parser, no reserialization, linear time.

Deciding whether a bare `{something}` in prose is a Svelte expression or literal text is a
different, syntactic problem, solved with `acorn`. A bare `{…}` is accepted as an expression only
if all of the following hold:

1. The scanner finds the closing brace without crossing a blank line.
2. `acorn.parseExpressionAt` parses it completely, with nothing left over.
3. The parsed expression is not an `ObjectExpression`, a `SequenceExpression`, or empty.

| Prose input                        | Why                                    | Result            |
| ---------------------------------- | -------------------------------------- | ----------------- |
| `use the {#if} block in your code` | `#` never opens an expression in text  | escaped, literal  |
| `{ "name": "foo" }`                | rejected as an `ObjectExpression`      | escaped, literal  |
| `put {a, b} here`                  | rejected as a `SequenceExpression`     | escaped, literal  |
| `a { stray unclosed one`           | no closing brace before EOF/blank line | escaped, literal  |
| `{price}`                          | a plain identifier expression          | Svelte expression |
| `{items.length}`                   | a plain member expression              | Svelte expression |

`{({ a: 1 })}` is the escape hatch for an object literal: acorn runs with `preserveParens: true`,
so the root node is a `ParenthesizedExpression` rather than an `ObjectExpression`.

Block clauses (`{#each items as item, i (item.id)}`, `{#snippet row(a, b)}`) are not validated
with acorn, because they are not JavaScript expressions — validating them would mean
reimplementing Svelte's own parser. Delimiting them correctly is enough; a semantic error there
comes from the Svelte compiler itself, pointed at the right `.md` line via source maps.

### Control blocks and tags

The micromark extension emits flat markers at the flow level rather than building a nested tree
directly — writing a container in micromark is the hardest and most fragile part of its API:

```
{#if a}      → svelteBlockOpen
text         → paragraph        (ordinary flow, untouched)
{:else}      → svelteBlockBranch
text         → paragraph
{/if}        → svelteBlockClose
```

Nesting is built afterwards, in `@svmd/mdast-util-svelte`, in one pass over the finished MDAST
with a stack. That stack also holds exact positions for every marker, which is what gives errors
`E001`–`E003` real line and column information, including which line a block was opened on.

Tags follow the same flat-marker-then-tree approach. The rule for whether a tag is flow or inline:
a line consisting of exactly one tag (opening, closing, or self-closing), with up to three spaces
of indentation, is a flow tag; anything else containing `<` is inline.

```md
<Callout type="info"> ← flow (opening marker)

**markdown** text ← ordinary flow: a child paragraph

</Callout> ← flow (closing marker)

This is <Badge>x</Badge> here. ← a paragraph with inline tags
```

This is what lets markdown parse _inside_ components by default (`<Callout>` doesn't stop the
paragraph inside it from being parsed as markdown), lets component names use dots (`<Foo.Bar />`),
and lets object-literal attributes work (`<Chart data={{ a: 1 }} />`, since `factoryBraced` counts
braces rather than deferring to CommonMark's HTML tokenizer).

A paragraph whose content is _only_ block-level elements has its wrapping `<p>` removed
(`unwrapBlockElements`), since `<p><div>…</div></p>` is invalid nesting that Svelte rejects. A
paragraph that _mixes_ prose and a block element is split around the element instead
(`<p>text </p><div>x</div><p> more</p>`), which is the standard resolution and keeps the
surrounding prose in paragraphs. Whether an arbitrary component (as opposed to a known HTML block
element) counts as "block" is not generally decidable from here, so position is the default
signal (inline mid-sentence, block alone on its line), with `blockElements` available as an
explicit override list for components that get the default wrong.

CommonMark's `htmlFlow` and `htmlText` are disabled entirely — the tag grammar above replaces
them, because CommonMark's HTML-block rule would otherwise keep `<div>` swallowing markdown until
the next blank line. In their place: HTML comments (`<!-- … -->`, in both flow and text), and
raw-text elements — `<script>` and `<style>` consume their content unparsed up to their matching
closing tag. Components listed in the `rawComponents` option behave the same way: their content
reaches Svelte verbatim, markdown syntax stays literal, and braces are not escaped. This is a
property of the component (set once in config), not of a particular usage site, so there is no
per-usage `raw` attribute.

### Script merging

Multiple `<script>` / `<script module>` blocks across the document are merged with `acorn` +
`acorn-typescript`, used only to _analyze_ each block (collect top-level declarations and imports
for collision detection and deduplication). The original source text is kept and trimmed with
`magic-string` — nothing is regenerated from the AST, which is what preserves TypeScript syntax
that an AST-to-string emitter would otherwise mangle.

Imports are deduplicated across scopes too: Svelte flattens `<script module>` and `<script>` into
one output module, so a name imported in both is a duplicate-declaration error if left alone.
There is no identifier renaming — since there is no layout system of svmd's own, the only possible
collision is the user with themselves, and an explicit error (`E008`) is preferred there over a
silent rename.

Frontmatter keys are exposed to the template as `const { title, … } = metadata;`, generated in
`<script module>` for every frontmatter key that is a valid, non-reserved JS identifier not
already declared or imported by the user in either scope. This declares every key rather than only
the ones referenced, since detecting "referenced" would require scanning block clauses that are
not themselves valid JS expressions.

### Highlighting

Code highlighting is off by default: fenced code blocks come out as
`<pre><code class="language-js">` with escaped content. `@svmd/shiki` implements the `Highlighter`
interface as a separate package with `shiki` as its own peer dependency, so `core` never carries
highlighter weight for users who bring their own (`rehype-pretty-code`, Prism, plain CSS).

### Vite integration

`vite-plugin-svelte` filters modules by matching `^[^?#]+\.(svelte)(?:[?#]|$)` against the module
id — the only contract stable across its versions is "it compiles whatever ends in `.svelte`". So
`svmd` resolves each matched `.md` file to a shadow id ending in `.svmd.svelte`:

```
import './post.md'
   │
   ├─ svmd.resolveId  →  this.resolve() → /abs/post.md  →  /abs/post.md.svmd.svelte
   ├─ svmd.load       →  reads /abs/post.md, compiles, returns { code, map }
   └─ vite-plugin-svelte:preprocess / :compile  →  sees `.svelte` → compiles
```

Since the module id isn't a real file on disk, the file watcher can't find it directly; the
`hotUpdate` hook maps `file → file + suffix` to correct that. Source maps still point at the real
`.md`, so errors and devtools show the original file.

### Frontmatter validation

`frontmatter.schema` accepts anything implementing [Standard Schema](https://standardschema.dev)
(Zod 4, Valibot, ArkType, and others implement it directly), rather than coupling to one validation
library. A validation failure produces `E007` with the field's path. The YAML parser itself uses
the YAML 1.2 core schema, under which `date: 2026-09-12` is a plain string rather than an
implicitly-converted `Date` — coercion, where wanted, happens explicitly in the schema
(`z.coerce.date()`).

## Data model (MDAST)

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

An attribute's `name` is stored verbatim, directive and modifiers included
(`transition:fade|local`); taking it apart is left to whichever code needs the pieces.

## Escaping

| hast node                                         | `<` `&`           | `{` `}`             |
| ------------------------------------------------- | ----------------- | ------------------- |
| `text`                                            | HTML-escaped      | `&#123;` / `&#125;` |
| `element` (text properties)                       | attribute-escaped | `&#123;` / `&#125;` |
| `raw` (from rehype or the highlighter)            | `{@html "…"}`     | inside the string   |
| `svelteRaw` (explicit opt-in)                     | verbatim          | verbatim            |
| `svelte*Expression`, `svelte*Tag`, `svelteBranch` | verbatim          | verbatim            |
| `svelteScript`, `svelteStyle`                     | verbatim          | verbatim            |

`raw` nodes are HTML the author did not write, so Svelte gets them as an opaque string: a literal
brace in highlighted `function f() {` stays text, Svelte's a11y checks do not run on markup like
Shiki's scrollable `<pre tabindex="0">`, and a long code block costs one string instead of a
template node per token.

## Errors

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
| `W001` | Content indented 4+ spaces inside an element or branch                |
| `W002` | A `<script>` or `<style>` hoisted out of the block it was written in  |

Every error is a `SvmdError` carrying `code`, `filename`, `start`, `end`, `hint` and `frame`, and
exposes `loc`/`frame` in the shape Rollup and Vite already print. Warnings travel in
`CompileResult.warnings`, and the Vite plugin emits them with `this.warn()`.

`E004` and a brace-attribute warning that once lived in this table no longer apply: an expression
that fails to parse in text context isn't an error at all (it's prose, and gets escaped), and the
attribute case they covered (`<Chart data={{ a: 1 }} />`) simply works now that braces are counted
by `factoryBraced` rather than by CommonMark's tag grammar.

## Repository layout

```
svmd/
├── ARCHITECTURE.md            ← this document
├── CONTRIBUTING.md            how the work is done
├── CHANGELOG.md               one changelog; every package shares a version
├── package.json               workspace root (private)
├── pnpm-workspace.yaml
├── tsconfig.json              one type-check for the whole workspace
├── eslint.config.js  .prettierrc  .lintstagedrc.json  .editorconfig
├── packages/
│   ├── micromark-factory-svelte-expression/   fork · brace balancing
│   │   └── index.js
│   ├── micromark-extension-svelte/            fork · the grammar
│   │   ├── FORK.md                  what diverges from upstream, and why
│   │   ├── index.js                 the public types, hand-written
│   │   └── lib/
│   │       ├── syntax.js            the assembled extension
│   │       ├── factory-tag.js       fork of mdx-jsx · tags
│   │       ├── factory-raw-text.js  ours · <script> / <style>
│   │       ├── tag-flow.js          fork · a tag in flow
│   │       ├── tag-text.js          fork · an inline tag
│   │       ├── expression.js        fork · {expr} in flow and text
│   │       ├── block.js             ours · {#if} {:else} {@html}
│   │       └── comment.js           ours · <!-- … -->
│   ├── mdast-util-svelte/                     fork · tokens → MDAST
│   │   ├── index.js
│   │   └── lib/
│   │       ├── index.js             fork of mdast-util-mdx-jsx
│   │       ├── nodes.d.ts           MDAST types
│   │       └── unwrap.js            ours · unwraps blocks from paragraphs
│   ├── core/                                  the compiler
│   │   └── src/
│   │       ├── index.ts             the public API
│   │       ├── compile.ts           orchestrates the three stages
│   │       ├── parse/               text → MDAST
│   │       │   ├── pipeline.ts      unified, cached
│   │       │   └── frontmatter.ts
│   │       ├── transform/           MDAST → HAST
│   │       │   ├── to-hast.ts
│   │       │   ├── hoist.ts         extracts <script> / <style>
│   │       │   └── highlight.ts     the Highlighter contract
│   │       ├── generate/            HAST → Svelte source
│   │       │   ├── component.ts     final assembly
│   │       │   ├── markup.ts  attributes.ts  escape.ts
│   │       │   ├── metadata.ts      export const metadata
│   │       │   └── script/          AST-guided merge
│   │       ├── diagnostics/         errors.ts · warnings.ts
│   │       └── internal/            source-builder.ts · names.ts
│   ├── shiki/                                 highlighting adapter
│   │   └── src/index.ts
│   ├── vite/                                   the Vite plugin
│   │   └── src/index.ts
│   └── content/                               runtime, zero deps
│       └── src/index.ts
├── test/                                      pipeline integration
│   ├── fixtures/
│   ├── snapshots/
│   └── *.test.ts
├── scripts/
│   ├── smoke.mjs                    the built dist/, on the oldest Node
│   └── consumer-check.mjs           the tarballs, installed clean
├── examples/app/                              the SvelteKit verification app
└── .github/workflows/{ci,release}.yml
```

The four TypeScript packages (`core`, `shiki`, `vite`, `content`) are built with **tsdown**, one at
a time and in topological order. The three forks are not built: they publish their JavaScript as
it stands, the way upstream does — see [CONTRIBUTING.md](./CONTRIBUTING.md#the-forks) for why.

## Verification

| Level       | What it proves                                                                        | Where                                      |
| ----------- | ------------------------------------------------------------------------------------- | ------------------------------------------ |
| Grammar     | the tokens emitted, and above all what is _not_ tokenized                             | `packages/micromark-extension-svelte/test` |
| Tree        | nesting, and errors E001–E005 with their positions                                    | `packages/mdast-util-svelte/test`          |
| Fixtures    | every `.md` fixture against a snapshot **and** against `svelte.compile`, warning-free | `test/fixtures.test.ts`                    |
| Regression  | one test per historical mdsvex issue being fixed                                      | `test/regressions.test.ts`                 |
| Diagnostics | the whole error catalogue above                                                       | `test/diagnostics.test.ts`                 |
| Source maps | traced with `@jridgewell/trace-mapping`                                               | `test/sourcemap.test.ts`                   |
| Integration | a real Vite build and dev server                                                      | `test/vite-plugin.test.ts`                 |
| Performance | linearity and brace-heavy prose                                                       | `test/performance.test.ts`                 |
| Invariants  | fixtures against micromark's _development_ build, which asserts token balance         | `test/assertions.test.ts`                  |
| Typed API   | that `entry.data` infers from a collection's schema                                   | `test/content.test.ts`                     |
| End-to-end  | a SvelteKit app that prerenders                                                       | `examples/app`                             |

Two more lanes exist because the suite above resolves `@svmd/core` to the source tree through a
vitest alias, which keeps the loop fast but means a broken `exports` map would still pass in green:

| Lane                         | What runs                                | What it catches                                     |
| ---------------------------- | ---------------------------------------- | --------------------------------------------------- |
| `scripts/smoke.mjs`          | the **built** dist/, on the oldest Node  | a broken build, a dropped export, a false `engines` |
| `scripts/consumer-check.mjs` | the **packed tarballs**, installed clean | `exports` maps, `files` lists, peer ranges          |

A snapshot alone is never treated as sufficient: every fixture is also compiled with
`svelte.compile` and required to produce zero warnings, since a pretty snapshot that Svelte
rejects isn't a passing test.
