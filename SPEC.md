# Technical specification — Markdown for Svelte

> **Working name:** `svmd` (undecided at the time of writing)
> **Status:** design draft — pre-implementation
> **Date:** September 2026
> **Reference versions:** Svelte 5.57.x · SvelteKit 2.70.x stable / 3.0 release candidate · mdsvex 0.12.8
>
> This is the original design document, kept as written. What was decided differently once the
> code existed is recorded in [`ARCHITECTURE.md`](./ARCHITECTURE.md), which refines these
> decisions and answers the open questions in §14.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Context and problem](#2-context-and-problem)
3. [Prior art](#3-prior-art)
4. [Scope](#4-scope)
5. [Requirements](#5-requirements)
6. [Design decisions](#6-design-decisions)
7. [Architecture](#7-architecture)
8. [Grammar specification](#8-grammar-specification)
9. [Content layer](#9-content-layer)
10. [Errors and diagnostics](#10-errors-and-diagnostics)
11. [Testing strategy](#11-testing-strategy)
12. [Roadmap](#12-roadmap)
13. [Risks](#13-risks)
14. [Open questions](#14-open-questions)
15. [Appendices](#15-appendices)

---

## 1. Executive summary

### What is being built

A markdown-to-Svelte-component compiler, delivered as a Vite plugin, that fixes mdsvex's
structural defects without inheriting its architecture.

### The project's four theses

**Thesis 1 — The problem is not markdown, it is scoping.**
The worst part of using mdsvex does not come from parsing, but from having to register `.md` in
the global `extensions` array in `svelte.config.js`. A Vite plugin with glob `include`/`exclude`
removes that entire class of bugs.

**Thesis 2 — There is no need to write a tokenizer from scratch.**
Two of the three grammar pieces already exist, are generic, and are proven in production:
`micromark-extension-mdx-expression` and `micromark-extension-mdx-jsx`. They are not "MDX"; they
are infrastructure MDX consumes. Only the third has to be written (Svelte's control blocks).

**Thesis 3 — Deny by default, not allow by default.**
mdsvex never escapes braces and lets the Svelte compiler fail afterwards. That hands the bug to
the user with an opaque error. The correct policy is to recognise valid Svelte tokens explicitly
and escape everything else.

**Thesis 4 — Do not compile to JavaScript.**
Emit valid Svelte and let `@sveltejs/vite-plugin-svelte` do the rest. TypeScript, HMR, source maps
and ecosystem compatibility all come for free.

### What is NOT being built

Content collections as a product (third parties have solved it), a site framework, a routing
system, themes, search.

---

## 2. Context and problem

### 2.1 What mdsvex actually is

mdsvex is a **Svelte markup preprocessor**. It is a function that takes a string and returns a
string. It does four things:

1. Extracts YAML frontmatter and exposes it as `export const metadata`, using an internal object
   called `_fm`.
2. Runs the markdown body through unified: remark parses to MDAST → `remarkPlugins` run →
   `remark-rehype` converts to HAST → `rehypePlugins` run → stringify to HTML.
3. Tries not to destroy whatever Svelte syntax is inside.
4. Optionally wraps the result in a layout component.

The output is valid Svelte source. **That is all.**

### 2.2 What mdsvex does NOT do

It is smaller than it appears. It does not do:

- Routing (none at all)
- Content querying or indexing
- Frontmatter typing
- HMR (that is Vite)
- Site scaffolding

### 2.3 Where the feeling that it "mixes routing into everything" comes from

From **one line of configuration**: adding `.md` to the `extensions` array in `svelte.config.js`.

That option belongs to Svelte/SvelteKit, not to mdsvex, and it is **global**. Turning it on means:

- Every `.md` in the project becomes a component.
- Every `.md` under `src/routes` becomes a page.

It is the direct root of several of the worst integration bugs.

### 2.4 Observed limitations (with real issue references)

| #   | Limitation                                              | Reference               | Solvable?                      |
| --- | ------------------------------------------------------- | ----------------------- | ------------------------------ |
| L1  | Processing cannot be limited to a subfolder             | mdsvex #241             | Yes — glob scoping             |
| L2  | TypeScript breaks as soon as you use a layout           | mdsvex #485             | Yes — AST merge                |
| L3  | `<script>` collisions between layout and content        | community reports       | Yes — AST merge                |
| L4  | Svelte 5: custom components and HTML do not work        | mdsvex #815, #555       | Yes — target Svelte 5+ only    |
| L5  | Code blocks reach remark plugins as `html`, not `code`  | mdsvex #93              | Yes — a correct grammar        |
| L6  | Markdown inside HTML/components is not parsed           | a CommonMark limitation | Yes — a micromark extension    |
| L7  | Relative layout paths broken since 0.12.4               | mdsvex #760             | N/A — there will be no layouts |
| L8  | Editor errors with import aliases                       | mdsvex #794             | Hard — requires tooling        |
| L9  | `load` only works in page-defining components           | a SvelteKit constraint  | Not directly — worked around   |
| L10 | Breaks out of the box when combined with `+page.svelte` | sveltejs/cli #384       | Yes — a consequence of L1      |
| L11 | Incompatibilities with rolldown-vite and Deno           | mdsvex #744, #743       | Yes — a standard Vite plugin   |
| L12 | No `enhanced:img` integration                           | mdsvex #750             | Yes — a standard Vite plugin   |

**Maintenance context:** ~163 open issues, essentially one maintainer, 3.1k stars, 13k dependents,
integrated into the official CLI via `npx sv add mdsvex`.

### 2.5 Root-cause diagnosis

The limitations above are not independent bugs. They are symptoms of five architectural decisions.

#### CR1 — It is a markup preprocessor, not a compiler

Svelte's preprocessor API takes a string and returns a string. Consequences:

- It has to guess where `<script>` blocks begin and end through partial parsing.
- It cannot coordinate with other preprocessors → **causes L2, L3**.
- It has no access to Vite's module graph → no precise HMR, no collections.
- The order of the `preprocess` array produces unpredictable interactions.

#### CR2 — It uses CommonMark as-is and patches around it

By specification, CommonMark treats raw HTML as opaque blocks: on seeing `<div>` it stops parsing
markdown until the next blank line. mdsvex does not extend the lexer; it intercepts at the block
level.

Three symptoms that look different are the same bug: **L5, L6**, and the general fragility of
inline Svelte syntax.

#### CR3 — It generates code by concatenating strings

That is why `<script>` blocks collide and why `lang="ts"` breaks everything → **causes L2, L3**.

#### CR4 — The "escape nothing" policy

From mdsvex's own documentation: it does not escape braces outside code blocks or `exec` blocks,
so that dynamic values can be passed as props.

It is a deliberate design bet, but it **does not solve the problem, it relocates it**. Write
`use the {#if} block` in prose without meaning to, and mdsvex passes it literally to Svelte,
Svelte tries to compile it as a real block, and the error points at generated code rather than at
your markdown line. It is the source of the "why is my content not showing" phantom bugs.

mdsvex chooses not to fix it because without a real parser extension there is no reliable way to
tell prose from syntax.

#### CR5 — The layout system predates SvelteKit and snippets

It competes with `+layout.svelte` instead of integrating with it → **causes L7**, and contributes
to L2 and L3.

---

## 3. Prior art

### 3.1 Layer 1 — markdown to Svelte component

| Project               | Approach                          | Notes                                                                                                                                                                                          |
| --------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **mdsvex**            | Preprocessor, remark plus patches | The de facto standard. The problems in §2.                                                                                                                                                     |
| **composably**        | Vite plugin, content-first        | **Must study.** Typed content plus dynamic Svelte components at build time. Attacks the same problem from the opposite end, and positions itself explicitly as an alternative model to mdsvex. |
| **svelte-exmarkdown** | Runtime, not compilation          | Dynamic, pluggable rendering. A different use case (markdown that arrives at runtime).                                                                                                         |
| **MDX**               | A markdown+JSX+React compiler     | Not applicable as a format, but **its internal pieces are** (see §6.D4).                                                                                                                       |

### 3.2 Layer 2 — content collections

**This layer is already solved.** Do not build it as a product.

| Project                    | Notes                                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **content-collections**    | An official SvelteKit adapter via Vite, Zod schemas, generated types. Requires a separate build step, a `.content-collections/generated` directory, and an alias in `svelte.config.js`. |
| **Velite**                 | Framework-agnostic, compiles to typed JSON with an `index.d.ts`.                                                                                                                        |
| **mdx-collections-svelte** | A light wrapper over `import.meta.glob` with Zod.                                                                                                                                       |

### 3.3 Layer 4 — site frameworks

**SveltePress** — does far too much for this use case (themes, sidebars, search, versioning).
Explicitly rejected.

---

## 4. Scope

### 4.1 The layer model

```
Layer 4 — Site framework (sidebars, search, themes, i18n)
          └─ SveltePress · OUT OF SCOPE

Layer 3 — Routing
          └─ SvelteKit already does it · OUT OF SCOPE

Layer 2 — Typed content collections
          └─ content-collections / Velite · SOLVED BY THIRD PARTIES
             (a minimal implementation is provided for the blog, §9)

Layer 1 — Markdown → Svelte component with Svelte syntax inside
          └─ mdsvex · ★ THIS IS THE REAL GAP · IN SCOPE

Layer 0 — Markdown → HTML
          └─ remark / markdown-it · SOLVED A DECADE AGO
```

### 4.2 The question that defines the scope

> **Do you need interactive Svelte components inside your markdown?**

- **No** → You do not need this project. `import.meta.glob` + remark + `{@html}` builds a blog in
  an afternoon.
- **Yes** → You need a compiler. That is Layer 1, and it is the only thing that justifies building
  anything.

### 4.3 In scope

- **S1** — Compile `.md` to valid Svelte components
- **S2** — Svelte syntax inside markdown: components, expressions, control blocks, directives
- **S3** — Markdown inside components (with a blank line, see §8)
- **S4** — Typed YAML frontmatter, exported as `metadata`
- **S5** — Glob scoping, without touching the global `extensions`
- **S6** — Full TypeScript support
- **S7** — remark/rehype ecosystem compatibility (correct nodes)
- **S8** — Source maps that point at the original `.md`
- **S9** — Correct HMR
- **S10** — A minimal collections layer for internal use (§9)

### 4.4 Explicit non-goals

Documenting this matters as much as documenting the scope. Without this section, the project
becomes SveltePress in six months.

- **N1** — No Svelte 3 or Svelte 4 support. Only 5+.
- **N2** — No layout system of its own. Layouts are the user's, through `+layout.svelte` or
  explicit wrappers.
- **N3** — No routing, and no touching SvelteKit's router.
- **N4** — Not a documentation framework. No themes, no sidebars, no search, no docs versioning.
- **N5** — No competing with content-collections/Velite. The collections layer is minimal and
  internal.
- **N6** — No MDX or JSX as an input format.
- **N7** — No image optimisation of its own. Delegate to `enhanced:img` / `vite-imagetools`.
- **N8** — No runtime rendering (that is `svelte-exmarkdown`).
- **N9** — No 100% compatibility with mdsvex's API. Compatibility can break if the design improves.

---

## 5. Requirements

### 5.1 Functional

| ID  | Requirement                                                                   | Priority |
| --- | ----------------------------------------------------------------------------- | -------- |
| F1  | Compile `.md` → a Svelte 5 component                                          | Must     |
| F2  | YAML frontmatter → `export const metadata`                                    | Must     |
| F3  | Block Svelte components: `<Callout>...</Callout>`                             | Must     |
| F4  | Inline components: `text <Badge>x</Badge> text`                               | Must     |
| F5  | Markdown inside components (with a blank line)                                | Must     |
| F6  | Expressions: `{price}`, `{items.length}`                                      | Must     |
| F7  | Control blocks: `{#if}`, `{#each}`, `{#await}`, `{#key}`                      | Must     |
| F8  | Special tags: `{@html}`, `{@const}`, `{@render}`, `{@debug}`                  | Must     |
| F9  | Snippets: `{#snippet}`                                                        | Must     |
| F10 | Attribute directives: `bind:`, `on:`, `use:`, `class:`, `transition:`, spread | Must     |
| F11 | The user's `<script>` and `<script module>`, with `lang="ts"`                 | Must     |
| F12 | The user's `<style>`, with preprocessors                                      | Must     |
| F13 | Automatic brace escaping in prose                                             | Must     |
| F14 | `include` / `exclude` glob configuration                                      | Must     |
| F15 | `remarkPlugins` / `rehypePlugins` passthrough                                 | Must     |
| F16 | Code blocks reach plugins as `code` nodes                                     | Must     |
| F17 | Configurable syntax highlighting (Shiki by default)                           | Should   |
| F18 | `exec` blocks (code evaluated at build time)                                  | Could    |
| F19 | Generated types for frontmatter                                               | Should   |

### 5.2 Non-functional

| ID  | Requirement                        | Acceptance criterion                                         |
| --- | ---------------------------------- | ------------------------------------------------------------ |
| NF1 | Correct source maps                | A Svelte error points at the real `.md` line                 |
| NF2 | HMR                                | Editing a `.md` refreshes without a full reload              |
| NF3 | Performance                        | < 20 ms per file cold, median, for a 200-line `.md`          |
| NF4 | No separate build step             | Everything happens inside Vite's pipeline                    |
| NF5 | Zero global configuration          | Does not require touching `extensions` in `svelte.config.js` |
| NF6 | rolldown-vite compatible           | The plugin uses only stable Vite API                         |
| NF7 | SvelteKit 2.70+ and 3.x compatible | A test suite against both                                    |
| NF8 | Actionable errors                  | Every error includes file, line, column and a suggestion     |
| NF9 | Small API surface                  | < 10 public configuration options                            |

---

## 6. Design decisions

Format: decision → reason → rejected alternatives.

### D1 — A Vite plugin, not a Svelte preprocessor

**Decision:** The package ships as a Vite plugin with `enforce: 'pre'`.

**Reason:** It fixes CR1 at the root. It gives order control, access to the module graph (fine
HMR, invalidation), the ability to emit virtual modules, and glob `include`/`exclude`.

**Rejected:** A Svelte preprocessor. That is the trap mdsvex fell into. A preprocessor cannot
resolve L1, L10, L11 or L12 by construction.

**Note:** A thin preprocessor wrapper could be offered for compatibility, but the plugin is the
main path.

---

### D2 — Emit Svelte, do not compile to JavaScript

**Decision:** The plugin's output is valid `.svelte` source. `@sveltejs/vite-plugin-svelte`
compiles it afterwards.

**Reason:** TypeScript (F11), `vitePreprocess`, compiler source maps, official HMR, and anything
Svelte adds in the future all come for free. It drastically reduces the maintenance surface.

**Rejected:** Compiling straight to JS. It multiplies the work, breaks with every Svelte release,
and badly reimplements what the official compiler already does well.

**Implication:** We have to coordinate with `vite-plugin-svelte`, which filters by extension.
Strategy: the plugin runs at `enforce: 'pre'` and rewrites `foo.md` to a virtual module with a
`.svelte` extension.

---

### D3 — Glob scoping, never global `extensions`

**Decision:** Configuration is `include: string[]` / `exclude: string[]`. The user never touches
`extensions` in `svelte.config.js`.

**Reason:** It kills L1, L10, and the entire class of circular-dependency errors. It is the
highest value-to-effort improvement in the whole project.

**Example:**

```js
svmd({
  include: ['src/content/**/*.md'],
  exclude: ['**/_*.md', '**/README.md'],
});
```

**Rejected:** Registering extensions globally. That is exactly mdsvex's defect.

---

### D4 — Grammar through micromark, reusing MDX's pieces

**Decision:** Use MDX's micromark extensions **unmodified** where they apply, and write only the
missing piece.

**A critical clarification worth writing down:** the micromark extensions **are not MDX**. They
are very low-level packages MDX consumes as dependencies, and they know nothing about JSX or
React. `micromark-extension-mdx-expression` in agnostic mode merely balances braces; its own
documentation says the content could be Rust if you wanted. They produce **tokens**, not React.
What is generated afterwards is our decision: Svelte.

**Division of labour:**

| Piece                                                   | Source                               | Work                                                                                                |
| ------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Expressions `{expr}`                                    | `micromark-extension-mdx-expression` | **None.** Used as-is with `acorn`.                                                                  |
| Tags `<Comp attr={x} />`                                | `micromark-extension-mdx-jsx`        | **Almost none.** Covers names, quoted and unquoted attributes, expression attributes, self-closing. |
| Inline ESM `import`/`export`                            | `micromark-extension-mdxjs-esm`      | Optional.                                                                                           |
| Blocks `{#if}`, `{#each}`, `{:else}`, `{/if}`, `{@...}` | **Ours**                             | ~200–400 lines, cloning `micromark-factory-mdx-expression` and changing the opening delimiter.      |

**Why the third piece is necessary:** Svelte's control-block syntax does not exist in JSX. React
solves conditionals with `{cond && <div/>}`, so MDX never needed `{#if}...{/if}`.

**Reusable low-level engine:**

- `micromark-factory-mdx-expression` — the brace balancer that knows about JS strings and comments
- `micromark-util-events-to-acorn` — translates micromark tokens into a JS AST

**Why this matters so much:** it changes the estimate from months to weeks. We are not writing an
ambiguous-grammar tokenizer from scratch; we are writing **one** bounded extension on top of a
disambiguation engine already proven by millions of projects.

**Rejected:**

- Writing the whole tokenizer from scratch — unnecessary months.
- Using MDX as the input format — ties us to JSX and to a mental model that does not fit Svelte.
- remark plugins alone over the already-built AST — cheaper (days) but leaves the §8.4 gotchas
  unsolved. **A valid option for a v0.1**, see §12.

---

### D5 — Deny by default on braces

**Decision:** Valid Svelte tokens are recognised explicitly. Everything else in text nodes is
escaped to `&#123;` / `&#125;`.

**Reason:** It inverts mdsvex's policy (CR4). With D4 in place, the `acorn`-backed balancer
disambiguates automatically: if the content does not parse as a valid JS expression, it is not an
expression, it is text.

**Behaviour comparison:**

| Case                                | mdsvex                           | This project                       |
| ----------------------------------- | -------------------------------- | ---------------------------------- |
| `<Counter count={x} />`             | Passes through                   | Passes through                     |
| An `{#if}` block alone on its line  | Passes through                   | Passes through                     |
| `{#if}` with no closing `{/if}`     | Opaque error in generated code   | Error with a position in the `.md` |
| `use {#if} in your code` in prose   | Leaks through as Svelte → breaks | Escaped → renders as literal text  |
| ` ```js exec `                      | Passes through                   | Passes through                     |
| `{ "name": "foo" }` pasted in prose | Leaks through → breaks           | Escaped                            |

**A deliberate exception:** `exec` blocks are not escaped, just as in mdsvex, because the user
declared them explicitly as code. There is no ambiguity there.

---

### D6 — Merge scripts at the AST level

**Decision:** `<script>` blocks are parsed with `acorn` or `oxc` and merged as ASTs, never by
concatenating strings.

**Reason:** Fixes CR3, L2 and L3 at the root.

**Required operations:**

- Hoisting and deduplicating imports
- Renaming colliding identifiers
- Preserving the `lang="ts"` attribute
- Correct separation between `<script>` and `<script module>`

**Rejected:** Concatenating strings. That is CR3.

---

### D7 — No layout system of our own

**Decision:** There is no `layout` option. The concept is removed.

**Reason:** Fixes CR5, L7, and much of L2 and L3. With Svelte 5, `{@render children()}` and
SvelteKit's `+layout.svelte`, the abstraction is redundant.

**Replacement:** The user wraps explicitly, or uses SvelteKit's layout.

**Rejected:** Reimplementing layouts better. It is complexity that buys nothing and competes with
SvelteKit.

---

### D8 — Collections with no build step

**Decision:** For our own use, Vite's `import.meta.glob`, with no external dependency, no
generated directory and no alias.

**Reason:** The user explicitly asked for "something reliable like Astro but with less magic".
content-collections requires a separate build step, writes to `.content-collections/generated`,
and asks for an alias to be configured. That is precisely the magic to avoid. The core of the
functionality is ~40 lines.

**Trade-off accepted:** No cross-collection references, no image pipeline, no incremental build
cache. If those become necessary, migrating to content-collections is undramatic.

---

## 7. Architecture

### 7.1 The full pipeline

```
.md file on disk
        │
        ▼
┌─────────────────────────────────────────┐
│ Vite plugin · transform hook            │
│ enforce: 'pre'                          │
│ filter: include/exclude globs   [D3]    │
└─────────────────────────────────────────┘
        │
        ▼
  Extract YAML frontmatter
  (gray-matter or equivalent)
        │
        ├──────────────► metadata (an object)
        ▼
┌─────────────────────────────────────────┐
│ micromark + extensions           [D4]   │
│  · mdx-expression   (reused)            │
│  · mdx-jsx          (reused)            │
│  · svelte-blocks    (ours)              │
└─────────────────────────────────────────┘
        │
        ▼
     MDAST with our own nodes:
     svelteExpression, svelteElement,
     svelteBlock, code, heading, text...
        │
        ▼
  The user's remarkPlugins        [F15]
  (`code` nodes are real          [F16])
        │
        ▼
  Brace escaping in text nodes    [D5]
        │
        ▼
     remark-rehype → HAST
        │
        ▼
  The user's rehypePlugins        [F15]
        │
        ▼
┌─────────────────────────────────────────┐
│ Generator → Svelte source        [D2]   │
│  · script merge through the AST  [D6]   │
│  · magic-string for source maps  [NF1]  │
└─────────────────────────────────────────┘
        │
        ▼
  a virtual module with a .svelte extension
        │
        ▼
  @sveltejs/vite-plugin-svelte (official)
        │
        ▼
       JS + CSS
```

### 7.2 Package structure

A monorepo, publishable in parts:

```
packages/
├── core/                        # the compiler: md → Svelte source
├── vite-plugin/                 # Vite integration [D1][D3]
├── micromark-extension-svelte/  # our own grammar piece [D4]
├── mdast-util-svelte/           # tokens → mdast nodes
└── content/                     # minimal collections [D8][§9]
```

**Why split:** `micromark-extension-svelte` is useful on its own to anyone wanting to parse Svelte
inside markdown. Publishing it separately widens both adoption and the surface for outside
contributions.

### 7.3 Configuration surface

NF9's target: fewer than 10 options.

```ts
interface SvmdOptions {
  include?: string[]; // default: ['**/*.md']
  exclude?: string[]; // default: ['**/node_modules/**']
  remarkPlugins?: PluggableList;
  rehypePlugins?: PluggableList;
  highlight?: false | HighlightOptions;
  frontmatter?: { marker?: string; parse?: (raw: string) => unknown };
  smartypants?: boolean;
}
```

---

## 8. Grammar specification

This section **is the contract with the user**. It goes in the README from day one.

### 8.1 Supported constructs

#### Block components

```md
<Callout type="warning">

This **is** parsed as markdown, with [links](/x) and lists.

</Callout>
```

The blank lines are required for the content to be treated as markdown.

#### Inline components

```md
This is <Badge>new</Badge> in version 2.
```

Works without blank lines. The surrounding text is still markdown.

#### Expressions

```md
The price is {price} and there are {items.length} items.
```

#### Control blocks

```md
{#if premium}

## Subscriber-only content

For subscribers only.

{/if}
```

Each token goes **alone on its line**.

#### Special tags

```md
{@const total = price * qty}

{@html rawContent}
```

#### Scripts and styles

```md
---
title: My post
---

<script lang="ts">
  import Counter from '$lib/Counter.svelte';
  let count = $state(0);
</script>

# {title}

<Counter bind:count />
```

### 8.2 Authoring rules

1. Block component tags go alone on their line, with a blank line before and after.
2. For markdown inside a component, leave a blank line after the opening tag and before the
   closing one.
3. The `{#...}`, `{:...}`, `{/...}` and `{@...}` tokens go alone on their line.
4. Braces in prose are written literally and escaped automatically.
5. **Do not indent content inside a component.** Four spaces turn it into a code block.

### 8.3 Escaping decision table

| Node context                            | Braces escaped?             |
| --------------------------------------- | --------------------------- |
| A `text` node in a paragraph            | Yes                         |
| A `text` node in a heading, list, table | Yes                         |
| A `code` node (fenced or inline)        | Yes (they render literally) |
| A ` ```js exec ` block                  | No                          |
| A `svelteExpression` node               | No                          |
| A `svelteBlock` node                    | No                          |
| `svelteElement` attributes              | No                          |
| `<script>` / `<style>` content          | No                          |

### 8.4 Known and documented limitations

These are accepted as part of the contract. Documenting them keeps them from being reported as
bugs.

#### G1 — Attributes with unwrapped spaces

CommonMark allows unquoted attribute values, but not ones containing spaces.

```md
<Chart data={items} /> ✅ works
<Chart data={{ a: 1 }} /> ❌ the space breaks the inline grammar
```

**Workaround:** define the object in the `<script>` and pass the reference.

**Note:** with D4 implemented, `mdx-jsx` handles expression attributes correctly and this gotcha
mostly disappears. It stays documented for the v0.1 path (remark plugins only).

#### G2 — Dotted tag names

CommonMark names are `[A-Za-z][A-Za-z0-9-]*`.

```md
<Foo.Bar /> ❌ does not parse
```

**Workaround:** reassign to a plain identifier in the `<script>`.

#### G3 — `allowDangerousHtml` is mandatory

It has to be passed to both `remark-rehype` and `rehype-stringify`, or all the Svelte comes out
escaped as `&lt;Callout&gt;`. It is one line, but it costs half an afternoon to discover. Handled
internally; documented for anyone extending the pipeline.

#### G4 — Detecting unbalanced blocks

On the v0.1 path (remark plugins only), an `{#if}` without its `{/if}` is caught by Svelte, not by
us, pointing at generated code. Mitigated with `magic-string` (NF1). With D4 complete, the error
is detected in the parser with an exact position.

#### G5 — Indentation inside components

Four spaces inside a component block produce a code block, not indented content. That is
CommonMark behaviour and will not be changed.

---

## 9. Content layer

A minimal implementation for our own use, per D8. It is not a product.

### 9.1 Target API

Modelled on Astro Content Collections, without the build step.

```ts
// src/lib/content/index.ts
import { z } from 'zod';

const schemas = {
  blog: z.object({
    title: z.string(),
    date: z.coerce.date(),
    draft: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
  }),
};

type Collection = keyof typeof schemas;

type Entry<C extends Collection> = {
  slug: string;
  collection: C;
  data: z.infer<(typeof schemas)[C]>;
  Content: import('svelte').Component;
};

export function getCollection<C extends Collection>(
  collection: C,
  filter?: (e: Entry<C>) => boolean,
): Entry<C>[];

export function getEntry<C extends Collection>(collection: C, slug: string): Entry<C> | undefined;
```

### 9.2 Use in routes

```ts
// src/routes/blog/[slug]/+page.ts
import { getEntry } from '$lib/content';
import { error } from '@sveltejs/kit';

export const load = ({ params }) => {
  const entry = getEntry('blog', params.slug);
  if (!entry) error(404);
  return { entry };
};
```

### 9.3 The critical footgun: eager vs lazy

**Problem:** `import.meta.glob(..., { eager: true })` puts **every** post in the client bundle.
With 20 posts it does not matter. With 300 it hurts.

**Mandatory solution from the start:** separate metadata from content.

```ts
// Index: cheap, frontmatter only, eager
const meta = import.meta.glob('/src/content/**/*.md', {
  eager: true,
  import: 'metadata',
});

// Body: lazy, loaded only on the post's own route
const bodies = import.meta.glob('/src/content/**/*.md');
```

`getCollection()` uses `meta`. `getEntry()` resolves the body on demand.

### 9.4 What is lost relative to Astro

- Cross-collection references
- The image optimisation pipeline
- Incremental build cache

Accepted. If they become necessary, migrate to content-collections.

---

## 10. Errors and diagnostics

Satisfying NF8. This is the most visible practical difference from mdsvex.

### 10.1 Principles

1. Every error carries a file path, line and column **of the `.md`**, never of the generated code.
2. Every error carries an actionable suggestion.
3. Never let a Svelte error be the first sign of a markdown problem.

### 10.2 Minimum error catalogue

| Code   | Condition                                 | Suggested message                                       |
| ------ | ----------------------------------------- | ------------------------------------------------------- |
| `E001` | `{#if}` with no `{/if}`                   | Unclosed block, opened on line N                        |
| `E002` | `{/if}` with no opening                   | Close with no matching block                            |
| `E003` | Crossed close (`{#if}...{#each}...{/if}`) | Invalid nesting                                         |
| `E004` | An expression acorn cannot parse          | Invalid JS expression; if it is literal text, escape it |
| `E005` | An unclosed component tag                 | `<Callout>` with no `</Callout>`                        |
| `E006` | Invalid YAML frontmatter                  | A YAML error with its line                              |
| `E007` | Frontmatter does not match the schema     | Missing field, or wrong type                            |
| `W001` | Indented content inside a component       | The G5 warning                                          |
| `W002` | Attribute with unwrapped spaces           | The G1 warning                                          |

### 10.3 Source maps

`magic-string` throughout the generator. **Never string concatenation.** It is the requirement
that makes everything above possible.

---

## 11. Testing strategy

### 11.1 The central idea

> **mdsvex's ~163 issues are the test specification.**

Before writing the grammar, extract the cases from the open issues into a fixture matrix. If the
prototype passes the 30 most upvoted, there is a project. If not, two weeks were lost rather than
six months.

### 11.2 Levels

| Level       | What it proves                                   | Tool                                  |
| ----------- | ------------------------------------------------ | ------------------------------------- |
| Unit        | The micromark extension: the tokens emitted      | Vitest                                |
| Unit        | The AST script merge                             | Vitest                                |
| Snapshot    | Input `.md` → generated Svelte source            | Vitest snapshots                      |
| Integration | Full compilation with `svelte/compiler`          | Vitest                                |
| Render      | The component's SSR and CSR output               | `vitest-browser-svelte` or Playwright |
| Regression  | Fixtures derived from mdsvex issues              | Vitest snapshots                      |
| Matrix      | SvelteKit 2.70.x and 3.x, Vite and rolldown-vite | CI                                    |

### 11.3 Fixtures required from day one

- Markdown inside a component, with and without a blank line
- A stray brace in prose (`use {#if} in your code`)
- A nested object in an attribute (`{{ a: 1 }}`)
- A code block with Svelte syntax inside
- A code block with meta (` ```js foo bar `)
- `<script lang="ts">` with imports
- `<script module>` and `<script>` together
- A control block nested inside another
- A component with every directive (`bind:`, `on:`, `use:`, `class:`, spread)
- Frontmatter with awkward types (dates, arrays, nulls)
- A file with `<style>` and a preprocessor

---

## 12. Roadmap

Each phase is independently useful and shippable. Phases 1 and 2 can be built **around** mdsvex,
rewriting nothing.

### Phase 0 — Spike (1–2 weeks)

An ugly but complete end-to-end prototype. A Vite plugin turning `.md` into `.svelte` with basic
remark. **Goal: find out where it actually hurts.** Nothing is optimised.

Before writing anything: **clone and read `composably`.** It attacks the same problem from the
opposite end. It will save weeks of design decisions, whether by copying it or by rejecting it
with arguments.

### Phase 1 — Scoping (days)

A Vite plugin with `include`/`exclude` [D3]. Internally it may call mdsvex. Fixes L1, L10 and the
integration problem people complain about most. **Shippable as a standalone package.**

### Phase 2 — Scripts and TypeScript (2–3 weeks)

AST-level script merging [D6]. Kills L2 and L3. Still buildable around mdsvex.

### Phase 3 — Grammar (3–6 weeks, not months)

The estimate drops from "months" to "weeks" thanks to D4.

- 3a: integrate `mdx-expression` and `mdx-jsx` unmodified (days)
- 3b: write `micromark-extension-svelte` for control blocks (2–4 weeks)
- 3c: `mdast-util-svelte` to map tokens to nodes (1 week)

Fixes L5, L6, and removes G1 and G4.

### Phase 4 — Our own generator (2–3 weeks)

Replace mdsvex entirely. An AST → Svelte generator with `magic-string`. Satisfies NF1.

### Phase 5 — Content and types (2–4 weeks)

The collections layer [§9] and generated frontmatter types [F19].

### Phase 6 — Tooling (ongoing)

An editor extension or a plugin for `svelte-language-server`. Fixes L8. **Perpetual maintenance;
evaluate whether it is worth it.**

### The decision rule between phases

At the end of each phase: are there real users? If not, stop and reassess. The project's risk is
not technical, it is scope and maintenance.

---

## 13. Risks

| ID  | Risk                                                                   | Impact | Mitigation                                                                      |
| --- | ---------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| R1  | The ground moves: Svelte 5.57 and climbing, SvelteKit 3 in RC          | High   | D2 (emit Svelte, not JS) cuts the exposure drastically. A CI matrix.            |
| R2  | `svelte/compiler`'s parse API is not stable across versions            | Medium | Do not depend on it. D2 avoids needing it.                                      |
| R3  | Competing with mdsvex: 3.1k stars, 13k dependents, in the official CLI | High   | Do not compete head-on. Phases 1–2 compose with mdsvex instead of replacing it. |
| R4  | Scope creep towards a site framework                                   | High   | The non-goals in §4.4 are binding.                                              |
| R5  | A single maintainer, just like mdsvex                                  | High   | Small API surface (NF9). The package split (§7.2) to make contributions easier. |
| R6  | The escaping rules will annoy someone                                  | Low    | Documented in §8 as a contract, not as a bug.                                   |
| R7  | Editor tooling eats the project                                        | Medium | Phase 6 is explicitly optional.                                                 |
| R8  | Nobody uses it                                                         | Medium | Validate with real users at the end of each phase.                              |

---

## 14. Open questions

- **Q1** — What are the project and package names?
- **Q2** — Is a preprocessor wrapper offered for compatibility, or is it a Vite plugin only?
- **Q3** — Which frontmatter validator: Zod, Valibot, or Standard Schema (agnostic)?
- **Q4** — Is `.svx` supported for compatibility, or only `.md`?
- **Q5** — An explicit escape syntax for prose interpolation, or only the §8.2 rules?
- **Q6** — Shiki by default, or no highlighter by default (a lighter bundle)?
- **Q7** — Is an automated migration path from mdsvex worth it?
- **Q8** — After reading `composably`: collaborate with that project rather than start a new one?

> All eight are answered in [`ARCHITECTURE.md §1`](./ARCHITECTURE.md#1-implementation-decisions).

---

## 15. Appendices

### A. Glossary

| Term                      | Definition                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **micromark**             | A markdown tokenizer. A state machine that reads character by character and emits tokens. Implements CommonMark strictly.                       |
| **MDAST**                 | Markdown Abstract Syntax Tree. The tree `mdast-util-from-markdown` builds from the tokens. Where remark plugins run.                            |
| **HAST**                  | HTML Abstract Syntax Tree. The tree after `remark-rehype`. Where rehype plugins run.                                                            |
| **unified**               | The framework that orchestrates parse → transform → stringify.                                                                                  |
| **remark**                | unified's markdown toolset (operates on MDAST).                                                                                                 |
| **rehype**                | unified's HTML toolset (operates on HAST).                                                                                                      |
| **A micromark extension** | Code that hooks into the tokenizer's state machine to add new constructs _to the grammar itself_.                                               |
| **CommonMark HTML block** | A spec rule: on seeing `<div>` at the start of a line, the parser swallows everything literally until the next blank line. **L6's root cause.** |
| **Flow vs text**          | In micromark, "flow" is block context (paragraphs, headings); "text" is inline context. Many constructs need both variants.                     |

### B. Key dependencies

| Package                              | Use                         | Modification needed        |
| ------------------------------------ | --------------------------- | -------------------------- |
| `micromark`                          | The base tokenizer          | None                       |
| `micromark-extension-mdx-expression` | `{...}` expressions         | **None**                   |
| `micromark-extension-mdx-jsx`        | `<Comp />` tags             | **None**                   |
| `micromark-factory-mdx-expression`   | The reusable brace balancer | The base for our extension |
| `micromark-util-events-to-acorn`     | Tokens → JS AST             | None                       |
| `mdast-util-from-markdown`           | Tokens → MDAST              | None                       |
| `mdast-util-mdx-jsx`                 | Tag nodes                   | None                       |
| `acorn`                              | Parsing JS expressions      | None                       |
| `oxc` or `acorn`                     | The script merge            | None                       |
| `magic-string`                       | Source maps                 | None                       |
| `remark-rehype` / `rehype-stringify` | Conversion and output       | `allowDangerousHtml: true` |

> The "modification needed" column was wrong for the first three. See
> [`ARCHITECTURE.md` I1](./ARCHITECTURE.md#i1--fork-the-mdx-extensions-neither-depend-on-them-nor-reimplement-them-refines-d4)
> for why they had to be forked instead.

### C. mdsvex issues to use as fixtures

`#93` (code blocks as html) · `#241` (scoping to a subfolder) · `#289` (props in a code fence's
meta) · `#485` (TS + layouts) · `#555` (Svelte 5) · `#744` (rolldown-vite) · `#743` (Deno) ·
`#745` (metadata stringification) · `#750` (`enhanced:img`) · `#760` (relative layout paths) ·
`#777` (a variable in a code block) · `#794` (aliases in the editor) · `#815` (Svelte 5, custom
components) · `sveltejs/cli#384` (breaks with `+page.svelte`)

### D. Projects to study before writing code

1. **`composably`** — highest priority. Same problem, content-first approach.
2. **`micromark-extension-mdx-jsx`** — ~1k lines. The reference for how a well-built extension is
   written.
3. **`micromark-factory-mdx-expression`** — the direct base for our own extension.
4. **`mdsvex`** — read the generator to learn what not to do.
5. **`svelte-exmarkdown`** — to understand the runtime approach and confirm it is not the path.

---

_A living document. Updated as phases close and open questions are resolved._
