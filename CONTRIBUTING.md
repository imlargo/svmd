# Contributing to svmd

This document is for anyone changing the source: the philosophy behind the design, the rules that
must stay exact, and decisions already settled. For how to _use_ the library, see
[README.md](./README.md). For how it works inside, see [ARCHITECTURE.md](./ARCHITECTURE.md); for
what the language is, [SPEC.md](./SPEC.md); for why the repository is shaped this way,
[docs/structure.md](./docs/structure.md).

---

## Philosophy

**Deny by default.** mdsvex does not escape braces, so an unintended one reaches the Svelte
compiler as written and fails there, pointing at generated code rather than at the markdown line
that caused it. svmd recognises the Svelte tokens it can prove are valid and escapes everything
else. When in doubt, escape: a brace that renders literally is a cosmetic issue the author can
see; a brace Svelte tries to compile is a build failure they cannot trace back to their markdown.

**Emit Svelte, not JavaScript.** The output is Svelte component source, and
`@sveltejs/vite-plugin-svelte` compiles it. That is what gives TypeScript, HMR, source maps and
the rest of the ecosystem for free. Never reach past it.

**A package boundary follows a dependency boundary.** Different peer dependencies, or a different
runtime (browser vs. build), mean a different package. A layer on its own does not — layers are
folders. This is why `@svmd/shiki` is not inside `@svmd/core`, and why `@svmd/content` keeps zero
runtime dependencies.

### Non-goals

- **Content collections as a product.** `@svmd/content` is ~200 dependency-free lines that save
  every user writing the same `import.meta.glob` plumbing. It does not grow: no querying, no
  indexing, no pagination, no sorting helpers. If you need those, `content-collections` is a
  drop-in replacement for that one file.
- **Routing, theming, search, a site framework.** None of it. svmd compiles markdown to a Svelte
  component and stops.
- **Layouts.** mdsvex's `layout` option predates Svelte snippets, and its relative path
  resolution has changed across versions (mdsvex #760). A component that imports the compiled
  module and wraps it does the same job with no new machinery.
- **Supporting Svelte 4.** The grammar emits Svelte 5 syntax and the target is Svelte 5 only.

---

## The forks

`packages/micromark-extension-svelte`, `packages/micromark-factory-svelte-expression` and
`packages/mdast-util-svelte` are forks of Titus Wormer's MDX packages. `FORK.md` records the
upstream commit each file came from and every deliberate divergence.

**The rule: keep them diffable against upstream.** That is the one property that makes it possible
to pull an upstream fix in later, and everything else bends around it:

- They are **excluded from ESLint and Prettier**. Reformatting them would make the next upstream
  diff unreadable — which costs far more than consistent quote style is worth.
- They keep upstream's file names, upstream's JSDoc-typed JavaScript, upstream's `tsconfig.json`
  (verbatim: `strict` and `exactOptionalPropertyTypes`, but _not_ `noUncheckedIndexedAccess`), and
  upstream's `test/*.js` suites rather than `*.test.ts`.
- When you change one, record it in `FORK.md`. A divergence nobody wrote down is a merge conflict
  nobody can resolve.

**Their public types are hand-written**, in each package's root `index.d.ts`. This is not a style
choice. Declarations generated from the JSDoc go to `types/`, which is unreachable from the
package root, so an `export … from './lib/x.js'` silently resolves to `any` and every call into
the grammar goes unchecked. Emitting them beside the JavaScript instead would shadow it and turn
`checkJs` into a no-op. Hand-writing the surface at the root avoids both, and says what the
package promises rather than whatever JSDoc happens to infer.

---

## Code conventions

- Prefer closures and factory functions over classes, unless a class is genuinely the better fit
  (it must extend `Error`, or it owns mutable state with an invariant).
- Named exports. `svmd` has a default export because a Vite plugin is conventionally imported that
  way; nothing else does.
- No comments explaining _what_ the code does — the code says that. Comment only _why_, and only
  for non-obvious decisions: a spec quirk, a runtime bug being worked around, a thing that was
  tried and reverted.
- Errors carry a code (`E001`…), a position, and a hint. See `packages/core/src/diagnostics/`.
  A diagnostic without a position is not finished.

### `core` is a pipeline, and its folders say so

```
parse/       text → mdast      pipeline construction, frontmatter
transform/   mdast → hast      node handlers, script hoisting, highlighting
generate/    hast → .svelte    markup, attributes, escaping, script merge
diagnostics/                   cross-cutting, not a stage
internal/                      source builder, safe identifiers
```

A new concern belongs in the stage it runs in. If it does not fit one, it is probably
cross-cutting and belongs in `diagnostics/` or `internal/` — or it is a sign the pipeline has a
stage nobody named yet.

---

## Testing

Four lanes, and each catches what the others structurally cannot. A change usually needs one of
them, not all four.

| Lane                         | What runs                                    | What it catches                                          |
| ---------------------------- | -------------------------------------------- | -------------------------------------------------------- |
| `packages/*/test/`           | unit tests against each package's own source | grammar and tree behaviour; the forks keep upstream's    |
| `test/`                      | the whole pipeline, fixtures and snapshots   | behaviour regressions; this is the development loop      |
| `scripts/smoke.mjs`          | the **built** `dist/`, on the oldest Node    | a broken build, a dropped export, an `engines` claim     |
| `scripts/consumer-check.mjs` | the **packed tarballs**, installed clean     | `exports` maps, `files` lists, peer ranges, missing deps |

`examples/kit-blog` is the fifth: a real SvelteKit build that prerenders, run in CI.

The reason the last two exist is that `test/` resolves `@svmd/core` to the source tree through a
vitest alias. That makes the loop fast, and it means a broken `exports` map passes the suite in
green. Do not remove them.

Type-level rules get type-level tests: `test/content.test.ts` asserts that `entry.data` infers
from the schema, because it once silently collapsed to `never` for every typed collection and
nothing caught it. `pnpm typecheck` covers `test/`, so loosening a type fails the build.

---

## CI and releasing

Four jobs in `ci.yml` — `check` (format, lint, types, tests, build, `pack:check`), `compat` (the
built output on Node 20/22/24), `consumer` (packed tarballs against Vite 6/7/8 with the matching
`vite-plugin-svelte`), and `example` (the SvelteKit app).

`check` and `compat` run on different Node versions on purpose: **tsdown requires Node
`^22.18 || >=24.11` to run at all**, a newer floor than the `>=20` these packages promise
consumers. So `compat` builds once on a modern Node and only then switches versions, to test the
artifact rather than the toolchain. If tsdown's minimum rises, bump the `node-version` used to
build — not `engines`, which describes something else.

### Versions are locked in step

Every package shares one version and one tag. `release.yml` refuses to publish if any
`package.json` disagrees with the tag, or if `CHANGELOG.md` has no section for it, then publishes
with `pnpm publish -r`, which walks the workspace in dependency order and rewrites every
`workspace:*` to the version being published.

This is deliberate over `changesets`: independent versioning solves the problem of collecting
changelog entries from many contributors, which a single maintainer does not have, and it would
make every cross-package refactor a coordinated multi-release. Revisit it if releases stop being
one person's decision.

Publishing uses **npm trusted publishing (OIDC)** — no `NPM_TOKEN` anywhere. Every package needs
its own trusted publisher configured on npmjs.com naming this repository and `release.yml`;
renaming that file breaks publishing until the setting is updated.

To cut a release: move the `Unreleased` entries under a new heading in `CHANGELOG.md`, set the
version in the root and every `packages/*/package.json`, commit, then:

```bash
git tag vX.Y.Z && git push origin vX.Y.Z
```

### Changelog

Hand-written, newest first, grouped under `Added` / `Changed` / `Fixed` / `Removed`. Two rules:

- **Only what is observable from outside.** A refactor, a test, a docs fix — none of them get a
  line. If a user cannot tell it happened, the git history is the right place for it.
- **Say why, not just what.** "Fixed the script merge" is not useful; explaining that two blocks
  importing the same name produced a duplicate declaration is.

Add entries under `## [Unreleased]` as the work lands, not at release time — reconstructing them
from `git log` afterwards is how the "why" gets lost.

---

## Working agreements

- **Small diffs.** One concern per change.
- **Before adding an option, ask:** would most users need this? Can it live in userland as a few
  lines the caller writes? Every option is a combination the test matrix has to cover forever.
- **Before removing one, ask the counterweight:** does this leave anything a user cannot do at
  all? A dead end is worse than an option nobody uses.
- **When a change is reverted, write down why** — in a comment, a test name, or this file.
