# Changelog

Notable changes to the `svmd` packages. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[semantic versioning](https://semver.org/spec/v2.0.0.html). Since 1.0.0 a breaking change means a
major bump. Before it, while the major is `0`, a minor bump means a real capability changed -
something added, or something that could break a caller - and a patch means a fix with nothing new
to learn.

Every package in this repository shares one version and is released by one tag, so this is the
only changelog. Entries name the package they are about when it is not `svmd` itself.

Entries say what changed for someone _using_ the library. A refactor nobody can observe from the
outside does not get a line here — the git history already has it.

## [Unreleased]

## [0.3.0] - 2026-11-01

### Added

- `post.md?metadata` imports a module holding only the frontmatter. `@svmd/content`'s `meta` glob
  should use it (`query: '?metadata'`): without it the eager index imported every body, and the
  lazy `body` glob could not split them into their own chunks.
- Every compiled file exports `headings`: `{ depth, text, id? }` for each heading with static
  text, after the rehype plugins ran.
- Route files (`+page.md`, `+layout.md`, `+error.md`) are compiled whenever their extension is in
  SvelteKit's `extensions`; they no longer need a glob in `include`.
- `@svmd/shiki`: `defaultColor`, and the fence's info string reaches transformers as `meta`.
- `@svmd/core`: `compiler.compileMetadata()` and `compiler.imports()`.

### Changed

- Highlighter and plugin HTML reaches Svelte as `{@html "…"}`. Svelte no longer reports
  `a11y_no_noninteractive_tabindex` on Shiki's scrollable `<pre tabindex="0">`, and no longer
  compiles each highlighted token as a template node.
- A `{key}` naming a frontmatter string, number or boolean is written out as text before the
  rehype plugins run, so `# {title}` gets an id from `rehype-slug`.
- Svelte's warnings about markup in a `.md` name the `.md`, its line and a frame from it
  (vite-plugin-svelte 7).
- On Vite 8, packages imported only from markdown are found by the dependency scan at startup,
  instead of failing the first request with `504 Outdated Optimize Dep` and reloading the page.
- `resolveId` and `load` declare hook filters, so Rolldown calls them only for markdown ids.

### Fixed

- A `$`-prefixed frontmatter key (`$schema`) failed the Svelte compile with
  `dollar_prefix_invalid`; it stays in `metadata` and is no longer bound as a local.
- Editing a `.md` in `vite dev` served the old output: the compiled module was never
  invalidated, so the client skipped the update and SSR re-rendered stale content. A `+page.md`
  now hot-updates; a `?metadata` module only reloads the page when the frontmatter changed.
- A route `.md` re-imported by URL in dev failed with `Failed to load url …/+page.md.svelte`, and
  an HMR re-import of `….md.svmd.svelte?t=…` failed with `ENOENT`.

## [0.2.0] - 2026-09-19

### Added

- `@svmd/vite/client`: an ambient `declare module '*.md'`, so a static
  `import Post, { metadata } from './post.md'` type-checks with a one-line
  `/// <reference types="@svmd/vite/client" />`, instead of every project writing that
  declaration itself.
- A `.md` can now be a SvelteKit route file. `src/routes/notes/+page.md` serves `/notes`,
  prerendering included, given `.md` in SvelteKit's `extensions` and the file inside svmd's
  globs. See [Markdown as a SvelteKit route](./README.md#markdown-as-a-sveltekit-route).

### Fixed

- A `.md` route file used to build in `vite dev` and then fail the adapter build with
  `Could not find file "src/routes/x/+page.md" in Vite manifest`. SvelteKit resolves a route to
  its chunk through that manifest, keyed by the real path, while svmd's ids carry a shadow
  suffix; the compiled file is now keyed under both.

## [0.1.1] - 2026-09-13

### Fixed

- `@svmd/vite`, `@svmd/core`, `@svmd/content` had no `description` in their `package.json`, so
  their npm listing showed a blank summary. All packages now have one.

## [0.1.0] - 2026-09-13

### Added

- `@svmd/vite`: a Vite plugin that compiles markdown to Svelte 5 source. Components, expressions,
  control blocks and directives are tokens the parser recognizes, not patterns matched after the
  markdown is already parsed.
- Markdown parses inside components by default, so wrapping a paragraph in `<Callout>` does not
  stop it from parsing; `rawComponents` opts a component out.
- Deny-by-default braces: a bare `{...}` becomes a Svelte expression only if it parses as one
  complete, non-object, non-sequence JS expression. `use the {#if} block` and a pasted JSON object
  in prose render as literal text instead of breaking the build.
- `@svmd/core`: the compiler on its own — `compile()` and `createCompiler()` — for tool authors who
  need the pipeline without Vite.
- `@svmd/shiki`: an optional Shiki `Highlighter` adapter.
- `@svmd/content`: a collections layer over `import.meta.glob`, with typed frontmatter through any
  Standard Schema validator (Zod, Valibot, ArkType).
- `@svmd/micromark-extension-svelte`, `@svmd/mdast-util-svelte`,
  `@svmd/micromark-factory-svelte-expression`: the grammar and its brace-balancing factory,
  published standalone for a Prettier plugin, an ESLint parser, or an LSP for this dialect.
- Every diagnostic carries a line and column in the source `.md` file, never in generated code.
