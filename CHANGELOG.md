# Changelog

Notable changes to the `svmd` packages. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[semantic versioning](https://semver.org/spec/v2.0.0.html). Since 1.0.0 a breaking change means a
major bump; before it, while the major is `0`, a minor bump carries them.

Every package in this repository shares one version and is released by one tag, so this is the
only changelog. Entries name the package they are about when it is not `svmd` itself.

Entries say what changed for someone _using_ the library. A refactor nobody can observe from the
outside does not get a line here — the git history already has it.

## [Unreleased]

## [0.1.2] - 2026-09-13

### Added

- `@svmd/vite/client`: an ambient `declare module '*.md'`, so a static
  `import Post, { metadata } from './post.md'` type-checks with a one-line
  `/// <reference types="@svmd/vite/client" />`, instead of every project writing that
  declaration itself.

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
