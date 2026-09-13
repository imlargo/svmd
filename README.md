# svmd

> A markdown compiler for Svelte 5. Built as a Vite plugin, with a grammar of its own.

[![CI](https://github.com/imlargo/svmd/actions/workflows/ci.yml/badge.svg)](https://github.com/imlargo/svmd/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

- Components, expressions, control blocks and directives are tokens the parser recognizes, not
  patterns matched after the markdown is already parsed.
- Markdown parses **inside** components by default, so wrapping a paragraph in `<Callout>` does
  not stop that paragraph from being parsed.
- Deny by default on braces: `use the {#if} block` in prose renders as text; only what parses as
  one complete, non-object, non-sequence JS expression becomes Svelte.
- Scoped by `include`/`exclude` glob, like any other Vite plugin. Nothing to register in
  `svelte.config.js`, nothing that becomes a route by accident.
- Emits Svelte, not JavaScript. `@sveltejs/vite-plugin-svelte` compiles the output, so
  TypeScript, HMR and source maps come from the same toolchain every Svelte project already uses.
- Every error carries a line and column **in your `.md`**, never in generated code.

## Behavior

If you're coming from mdsvex, most of the syntax is familiar. The table below covers where the
two diverge, since that matters more for choosing between them than a feature list would:

| Case                                          | mdsvex                                            | svmd                                           |
| --------------------------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| Markdown inside `<Callout>…</Callout>`        | not parsed (CommonMark's HTML block rule)         | parsed, with links and lists                   |
| `use the {#if} block` in a sentence           | passed to Svelte as written                       | rendered as literal text                       |
| `{ "name": "foo" }` pasted into prose         | passed to Svelte as written                       | rendered as literal text                       |
| Two `<script>` blocks importing the same name | a duplicate declaration error                     | deduplicated automatically                     |
| `<script lang="ts">` combined with a layout   | can conflict (mdsvex #485)                        | merged through the AST                         |
| A fenced code block, seen by a remark plugin  | arrives as an `html` node (mdsvex #93)            | arrives as a `code` node, with `lang`/`meta`   |
| An unclosed `{#if}`                           | reported by Svelte, on the generated file         | reported as `E001`, with the line it opened on |
| Scoping to one folder                         | needs the global `extensions` array (mdsvex #241) | `include: ['src/content/**']`                  |

Each row traces to a real case, most from mdsvex's own issue tracker. The full list is in
[`SPEC.md` appendix C](./SPEC.md#c-mdsvex-issues-to-use-as-fixtures), and every one has a
regression test in [`test/regressions.test.ts`](./test/regressions.test.ts).

## Install

```sh
pnpm add -D svmd
```

Requires Svelte 5+, Vite 6+ and `@sveltejs/vite-plugin-svelte`.

```js
// vite.config.js
import { svmd } from 'svmd';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default {
  // svmd goes before the Svelte plugin. It hands vite-plugin-svelte
  // already-compiled Svelte, not markdown.
  plugins: [svmd({ include: ['src/content/**/*.md'] }), svelte()],
};
```

## Usage

```md
---
title: My first post
---

<script lang="ts">
  import Counter from '$lib/Counter.svelte';
  let count = $state(0);
</script>

# {title}

Press the button: <Counter bind:count />

{#if count > 3}

> You have pressed it **{count}** times.

{/if}
```

```svelte
<script>
  import Post, { metadata } from './content/post.md';
</script>

<h1>{metadata.title}</h1>
<Post />
```

No `svelte.config.js` to touch. No separate build step. No layout system of its own.

## The grammar

The full contract, including every construct, escaping rules, `rawComponents`, `blockElements`,
and the known limits, lives in [`GRAMMAR.md`](./GRAMMAR.md). The short version:

```md
---
title: My post
---

<script lang="ts">
  let count = $state(0);
</script>

# {title}

An expression: {count * 2}. A component in block form:

<Callout type="warning">

Markdown parses **inside** it, with [links](/x) and lists.

</Callout>

{#if count > 3}
You have {count} clicks.
{/if}

use the {#if} block in a sentence, and it renders as literal text, not Svelte.
```

| Construct                                  | Example                                                |
| ------------------------------------------ | ------------------------------------------------------ |
| Expressions                                | `{price}`, `{items.length}`                            |
| Block and inline components                | `<Callout>…</Callout>`, `<Badge>new</Badge>`           |
| Control blocks                             | `{#if}`, `{#each}`, `{#await}`, `{#key}`, `{#snippet}` |
| Special tags                               | `{@html}`, `{@const}`, `{@render}`                     |
| Every attribute and directive form         | `bind:`, `on:`, `class:`, `transition:x\|y`, spread    |
| `<script>` / `<script module>` / `<style>` | merged through the AST, `lang="ts"` preserved          |
| Frontmatter                                | YAML, exported as `metadata` and as local bindings     |

One rule matters more than the rest of the reference: a bare `{…}` becomes an expression only if
it parses as **one** complete JS expression whose root is not an object literal or a sequence. A
stray brace, a pasted JSON object, or `{#if}` written mid-sentence all render as literal text.

## Configuration

```ts
interface SvmdOptions {
  include?: string | RegExp | (string | RegExp)[]; // ['**/*.md']
  exclude?: string | RegExp | (string | RegExp)[]; // ['**/node_modules/**']
  remarkPlugins?: PluggableList;
  rehypePlugins?: PluggableList;
  highlight?: Highlighter | false; // false
  frontmatter?: { parse?(raw: string): unknown; schema?: StandardSchema };
  gfm?: boolean; // true
  blockElements?: string[]; // []
  rawComponents?: string[]; // []
}
```

Nine options, and each one earns its place by doing something a userland plugin cannot: `include`
and `exclude` need the module graph, `highlight` and the plugin lists need to run inside the
compile pipeline, `blockElements` and `rawComponents` resolve an ambiguity nothing outside the
grammar can see.

To compile many files with the same options (a build, a dev server), use `createCompiler`, which
builds the pipeline once:

```js
import { createCompiler } from '@svmd/core';

const compiler = createCompiler({ gfm: true });
const { code, map } = await compiler.compile(source, 'post.md');
```

The Vite plugin already does this internally.

Globs resolve against Vite's `root`, and the extension the plugin compiles comes from them:
`include: ['src/content/**/*.svx']` compiles `.svx`.

### remark and rehype plugins

They work with no adapters. Code blocks arrive as real `code` nodes, with `lang` and `meta`:

```js
import remarkSmartypants from 'remark-smartypants';
import rehypeSlug from 'rehype-slug';

svmd({
  remarkPlugins: [remarkSmartypants],
  rehypePlugins: [rehypeSlug],
});
```

### Syntax highlighting

Off by default: blocks come out as `<pre><code class="language-js">` and you style them. To use
Shiki, install it and plug it in:

```sh
pnpm add -D @svmd/shiki shiki
```

```js
import { shikiHighlighter } from '@svmd/shiki';

svmd({
  highlight: await shikiHighlighter({ theme: 'github-dark' }),
});
```

Or write your own. It is one function:

```js
svmd({
  highlight: ({ value, lang, meta }) => `<pre data-lang="${lang}">${escape(value)}</pre>`,
});
```

### Frontmatter validation

`schema` accepts any validator implementing [Standard Schema](https://standardschema.dev), such
as Zod, Valibot or ArkType:

```js
import { z } from 'zod';

svmd({
  frontmatter: {
    schema: z.object({
      title: z.string(),
      date: z.coerce.date(),
      draft: z.boolean().default(false),
    }),
  },
});
```

The schema's output is what ends up in `metadata`, so coercions and defaults apply.

## Content collections

`@svmd/content` is a minimal layer over `import.meta.glob`. No build step, no generated directory,
no alias. About 200 lines that cover what this project's own example blog needs, kept in the
package so nobody has to write the same glob plumbing more than once.

```ts
// src/lib/content.ts
import { createContent } from '@svmd/content';
import { z } from 'zod';

export const { getCollection, getEntry } = createContent({
  blog: {
    // Cheap index: frontmatter only, eager.
    meta: import.meta.glob('/src/content/blog/**/*.md', {
      eager: true,
      import: 'metadata',
    }),
    // Body: lazy, loaded only on the post's own route.
    body: import.meta.glob('/src/content/blog/**/*.md'),
    schema: z.object({
      title: z.string(),
      date: z.coerce.date(),
      draft: z.boolean().default(false),
    }),
  },
});
```

```ts
// src/routes/blog/+page.ts
import { getCollection } from '$lib/content';

export const load = () => ({
  posts: getCollection('blog', (post) => !post.data.draft),
});
```

```ts
// src/routes/blog/[slug]/+page.ts
import { getEntry } from '$lib/content';
import { error } from '@sveltejs/kit';

export const load = async ({ params }) => {
  const entry = getEntry('blog', params.slug);
  if (!entry) error(404);
  const { default: Content } = await entry.load();
  return { data: entry.data, Content };
};
```

Keeping the bodies lazy matters: setting `eager: true` on both globs would put all 300 posts in
the client bundle.

## Errors

Every error points at your `.md`, with a line, a column and what to do:

```
[E001] Unclosed block `{#if}`
  at src/content/post.md:12:1

   10 | A paragraph.
   11 |
 > 12 | {#if premium}
      | ^
   13 |
   14 | Content.

  Add a matching `{/if}` on its own line.
```

| Code   | Condition                                       |
| ------ | ----------------------------------------------- |
| `E001` | unclosed `{#…}` block                           |
| `E002` | `{/…}` close with no opening                    |
| `E003` | crossed nesting, or a branch in the wrong block |
| `E005` | unclosed tag, or an orphan closing tag          |
| `E006` | invalid YAML frontmatter                        |
| `E007` | frontmatter that does not match the schema      |
| `E008` | the same name declared in two `<script>` blocks |
| `E009` | `<style>` blocks with incompatible languages    |

And two warnings, which do not fail the build but are reported:

| Code   | Condition                                                                                 |
| ------ | ----------------------------------------------------------------------------------------- |
| `W001` | indented content inside a component, which CommonMark turned into a code block            |
| `W002` | a `<script>` or `<style>` written inside a block: it is hoisted, so it is not conditional |

## Scope

svmd leaves out layouts, routing, a documentation framework, image optimisation, and support for
Svelte 3/4. Each cut is deliberate, and the full reasoning for each is in
[`CONTRIBUTING.md`](./CONTRIBUTING.md#non-goals):

- **No layout system.** Use SvelteKit's `+layout.svelte`, or wrap the component yourself.
  mdsvex's `layout` option predates Svelte snippets, and its relative path resolution has changed
  across versions (mdsvex #760).
- **No routing.** That is SvelteKit's job, and svmd has no reason to know about it.
- **Not a documentation framework.** No themes, no sidebar, no search, no versioning.
- **No image optimisation.** `enhanced:img` and `vite-imagetools` already do this, and work
  unmodified because svmd is an ordinary Vite plugin.
- **Svelte 5 only.** The grammar emits `{#snippet}` and `{@render}`, which do not exist before it.

The test a feature has to pass before it is added: does compiling markdown need it, or can a
plugin already do it through `remarkPlugins`/`rehypePlugins`? Smart typography does not need to be
built in, since `remark-smartypants` already covers it, so it stays a two-line recipe instead of
a dependency.

## Maintenance

One person maintains this. What bounds the risk if that changes:

- **No hidden runtime.** The compiler is ~1,900 lines across 18 files in
  [`packages/core`](./packages/core); the plugin, the content layer and the Shiki adapter add
  under 500 more. Reading it is an afternoon, not an archaeology project.
- **The forks are isolated and documented.** Three packages (the grammar, its expression
  factory, and the MDAST builder) are forks of Titus Wormer's MDX packages (MIT), kept
  deliberately diffable against upstream. [`FORK.md`](./packages/micromark-extension-svelte/FORK.md)
  records the exact commit each file came from and every divergence, so picking up an upstream
  fix later is a diff review too.
- **MIT, everywhere.** Every package, forks included, carries its own `LICENSE` and, where it
  applies, the upstream notice the fork requires.
- **375 tests**, across grammar tokens, tree construction, fixture-vs-`svelte.compile` snapshots,
  documented mdsvex regressions, source maps, and a real SvelteKit build. See [Testing](#testing).

## Runtimes

| Requirement                    | Version                                     |
| ------------------------------ | ------------------------------------------- |
| Node                           | 20, 22, 24 (verified in CI on every push)   |
| Svelte                         | 5.x only                                    |
| Vite                           | 6, 7 or 8                                   |
| `@sveltejs/vite-plugin-svelte` | 5, 6 or 7 (matched to the Vite major above) |

CI proves the peer range by building against it: every publishable package is packed into a real
tarball and installed into a clean project against each Vite/plugin pair, not tested only inside
the workspace. See [`scripts/consumer-check.mjs`](./scripts/consumer-check.mjs).

## Packages

| Package                                     | What it is                                                |
| ------------------------------------------- | --------------------------------------------------------- |
| `svmd`                                      | the Vite plugin                                           |
| `@svmd/core`                                | the compiler: `compile(source) → { code, map, metadata }` |
| `@svmd/shiki`                               | Shiki highlighting, as an optional adapter                |
| `@svmd/content`                             | collections over `import.meta.glob`                       |
| `@svmd/mdast-util-svelte`                   | tokens → MDAST, and tree construction                     |
| `@svmd/micromark-extension-svelte`          | the grammar                                               |
| `@svmd/micromark-factory-svelte-expression` | brace balancing                                           |

The last three are forks of the micromark extensions MDX uses, their test suites included, and
are useful on their own to anyone who wants to parse Svelte syntax inside markdown: a Prettier
plugin, an ESLint parser, an LSP for this dialect. None of them need the compiler.

Architecture and the reasoning behind the package split: [`ARCHITECTURE.md`](./ARCHITECTURE.md)
and [`docs/structure.md`](./docs/structure.md).

## Example

[`examples/kit-blog`](./examples/kit-blog) is a real SvelteKit site: frontmatter, a typed
collection with Zod, an interactive component inside a post, prerendering. It builds in CI on
every push, against the built `dist/` of every package rather than against source directly.

```sh
git clone https://github.com/imlargo/svmd
cd svmd && pnpm install
pnpm --filter @svmd/example-kit-blog dev
```

## Testing

Four lanes, each catching what the others structurally cannot:

| Lane                         | What runs                                           | What it catches                                                                                         |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `packages/*/test/`           | unit tests against each package's own source        | grammar and tree behavior; the forks keep upstream's suites                                             |
| `test/`                      | the whole pipeline, fixtures and snapshots          | behavior regressions (every fixture also compiles with `svelte.compile` and must produce zero warnings) |
| `scripts/smoke.mjs`          | the **built** `dist/`, on the oldest supported Node | a broken build, a dropped export, a false `engines` claim                                               |
| `scripts/consumer-check.mjs` | the packed **tarballs**, installed clean            | broken `exports` maps, missing `files`, peer ranges                                                     |

`examples/kit-blog` is the fifth: a real SvelteKit build that prerenders, run in CI.

```sh
pnpm check   # what CI runs: format check, lint, typecheck, build, test
pnpm test:watch
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full testing philosophy and the code
conventions, and [CHANGELOG.md](./CHANGELOG.md) for releases.

## License

MIT
