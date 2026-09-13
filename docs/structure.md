# Why the repository is split this way

> The **why** behind the package boundaries. For the layout itself, see
> [ARCHITECTURE.md §6](../ARCHITECTURE.md#6-repository-layout); for how the compiler works,
> the rest of that document.
>
> Status: everything in §6 is applied, except `remark-svelte`, which is still a proposal.

---

## 1. What kind of project this is

Not a library. A **compiler toolchain**, with three audiences that do not overlap — and those
audiences are what determine the package boundaries:

| Audience              | Share | Installs                | Needs                             |
| --------------------- | ----- | ----------------------- | --------------------------------- |
| Application dev       | ~99%  | `svmd`                  | the Vite plugin + runtime helpers |
| Tool author           | ~1%   | `@svmd/core`            | `compile()` with no Vite involved |
| The unified ecosystem | rare  | `micromark-…`/`mdast-…` | the grammar without the compiler  |

## 2. The rule

> **A package exists where a _dependency_ boundary exists, not where a layer exists.**
> Layers are folders. Audiences are packages.

Corollaries that follow on their own:

- Different peers → different package. (Vite, Shiki.)
- Different runtime, browser vs. build → different package. (`content`.)
- Same dependencies, same audience → same box, with a subpath if needed.

## 3. The ecosystem pattern

This shape has already converged. The four tiers are the same everywhere:

|             | svmd                                              | MDX                                                 | Svelte / Vue                                         |
| ----------- | ------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| grammar     | `micromark-extension-svelte`, `mdast-util-svelte` | `micromark-extension-mdx-jsx`, `mdast-util-mdx-jsx` | a parser of their own                                |
| compiler    | `@svmd/core`                                      | `@mdx-js/mdx`                                       | `svelte/compiler`, `@vue/compiler-sfc`               |
| integration | `svmd`                                            | `@mdx-js/rollup`, `/esbuild`, `/loader`             | `@sveltejs/vite-plugin-svelte`, `@vitejs/plugin-vue` |
| runtime     | `@svmd/content`                                   | `@mdx-js/react`, `/preact`, `/vue`                  | `svelte`, `vue`                                      |

---

## 4. The dependency graph

```
                      @standard-schema/spec  (types only, external)
                         │                    │
    micromark-factory-svelte-expression       │
                         │                    │
            micromark-extension-svelte        │
                    │         │               │
     mdast-util-svelte    remark-svelte       │
                    │                         │
                 @svmd/core ─────────────────-┘
                 │        ▲
                 │        │ (the Highlighter interface only)
            svmd │        │
                 │   @svmd/shiki ──peer──> shiki
                 └──peer──> vite, @sveltejs/vite-plugin-svelte, svelte

    @svmd/content  ── zero runtime dependencies ──> (@standard-schema/spec, types only)
```

Nothing points "upward". `content` touches nothing. `core` does not know Vite exists.

---

## 5. The decisions, and why

### D1 — The three grammar packages are published separately

Each one's public API is **a single function whose shape micromark dictates**, not us:
`svelte(options) → Extension`. `lib/*` is not exported. So the usual cost of publishing —
freezing internals — does not apply here, and only the benefit is left: anyone writing a Prettier
plugin, an ESLint parser or an LSP for this dialect needs exactly those packages, and **none** of
them needs the compiler.

### D2 — `@svmd/shiki` is not inside `@svmd/core`

`shiki` used to be an optional peer of `core`, and the highlighter was exported **twice**, as
`@svmd/core/shiki` and as `svmd/shiki`. By the rule in §2 it is an adapter: different peer,
different package. `core` keeps only the `Highlighter` **interface**. The result: `core` has no
optional peers, there is no duplicated subpath, and `@svmd/prism` or `@svmd/starry-night` would
fit in symmetrically later.

### D3 — `StandardSchemaV1` is declared once, and not here

It used to live in `core/src/standard-schema.ts` **and again**, under another name
(`StandardSchemaLike`), in `content/src/index.ts`. Two definitions of one public standard in one
repository, free to diverge silently. `content` cannot import from `core`, because it has to stay
at zero dependencies.

The way out: **`@standard-schema/spec`**, the standard's own package, which is types-only and
therefore costs nothing at runtime. Both depend on it. Interop with Zod, Valibot and ArkType is
then guaranteed by construction rather than by resemblance.

### D4 — A package's directory is named after the package

`packages/vite-plugin/` published as `svmd`, so it is now `packages/svmd/`. That name is what
`pnpm --filter` takes, what appears in stack traces, and what you type when you grep.

### D5 — `core`'s folders are the pipeline's stages

`emit/` and `generate/` were one stage under two names, and `frontmatter.ts`, `to-hast.ts` and
`hoist.ts` sat loose at the same level as the folders. With `parse/ → transform/ → generate/` the
folder names say SPEC §7 out loud, and `diagnostics/` and `internal/` are marked as what they are:
cross-cutting, not stages.

> Deviation while implementing: **`options.ts` was not created.** The plan proposed it for
> "CompileOptions plus normalisation", but there is no normalisation to extract — defaults are
> applied at the point of use — and `pipeline.ts` already declares its own `PipelineOptions`, so
> there was no cycle to break either. It would have moved an interface away from its only
> orchestrator in exchange for nothing.

### D6 — tsdown builds the TypeScript packages; the forks are not built

The four TypeScript packages are bundled with tsdown, one at a time, in topological order. This
follows the library template the repository is built on.

The three forks are **not** built. They publish their JavaScript exactly as it stands, the way
upstream micromark does, and their public types are hand-written in each package's root
`index.d.ts`. That is not a style preference: declarations generated from the JSDoc land in
`types/`, unreachable from the package root, so a re-export silently resolves to `any`; emitting
them next to the JavaScript instead shadows it and turns `checkJs` into a no-op. See §7.

Type-checking does not go through the build at all: one `tsc --noEmit` at the root covers every
package, every test and every config, with `paths` resolving siblings to source. So a change in
`core` is type-checked against its dependents without building anything first.

### D7 — The forks are excluded from ESLint and Prettier

`FORK.md` records the upstream commit each file came from. Every reformat makes the next diff
against upstream unreadable, and that diff is **the single most important maintenance property of
this repository**. They also keep upstream's own `tsconfig.json` rather than the stricter one used
everywhere else, for the same reason.

### D8 — Scope everything as `@svmd/*`, except the product

An unscoped `micromark-extension-*` reads as "blessed by the micromark org", and this is a
third-party fork. Scoping also keeps trusted-publishing configuration in one org. `svmd` is
unscoped because it is the product's name. It is reversible: publishing an unscoped alias later
breaks nothing.

### D9 — One version, one tag, one changelog

All seven packages share a version. `vX.Y.Z` validates tag ↔ every `package.json` ↔
`CHANGELOG.md`, then publishes in dependency order over OIDC. It is the model svelte/kit and vite
use. Changesets solves a problem — collecting entries from many contributors — that this
repository does not have.

### D10 — `@svmd/content` stays, but frozen

SPEC §1 says content collections are **not** the product, and it is right. It stays because it is
~200 dependency-free lines that keep every user from rewriting the same `import.meta.glob`
plumbing. It does not grow: no querying, no indexing, no pagination, no sorting. That is written
down as a non-goal in `CONTRIBUTING.md`.

---

## 6. Debt this design paid off

| #   | Debt                                                                     | Status                                |
| --- | ------------------------------------------------------------------------ | ------------------------------------- |
| 1   | `StandardSchemaV1` declared twice                                        | ✅ D3 — `@standard-schema/spec`       |
| 2   | `shiki` exported from two packages                                       | ✅ D2 — `@svmd/shiki`                 |
| 3   | `tsconfig.test.json` carried dead `paths`                                | ✅ removed                            |
| 4   | `repository.url` named `github.com/svmd/svmd`, an org that never existed | ✅ fixed in all seven manifests       |
| 5   | `emit/` vs `generate/`: a distinction nobody could guess                 | ✅ D5                                 |
| 6   | `.gitignore` had a duplicated comment block                              | ✅ rewritten                          |
| 7   | A committed `index.d.ts.map` in the factory package                      | ✅ deleted and ignored                |
| 8   | No ESLint, Prettier, CHANGELOG, CONTRIBUTING or automated release        | ✅ template applied                   |
| 9   | The suite never exercised the `exports` maps                             | ✅ `smoke.mjs` + `consumer-check.mjs` |
| 10  | `test/` was **outside** the build graph and never type-checked           | ✅ `typecheck` covers it              |
| 11  | `entry.data` collapsed to `never` for any schema (§7)                    | ✅ fixed, with a type-level test      |
| 12  | The grammar's types resolved to `any` throughout `core` (§8)             | ✅ hand-written public surfaces       |

---

## 7. Finding: `@svmd/content` was broken for any schema

Found while type-checking a consumer against the packed tarballs, as part of verifying D3.

`Collections` was bounded by `CollectionDefinition<never>`. But `Data` sits in an **output**
position (`schema?: StandardSchema<unknown, Data>`), so that bound demands a schema validating to
`never` — which nothing satisfies. Every collection with a schema failed the constraint, and
`entry.data` collapsed to `never`.

The bug **predates** unifying the standard; it reproduced identically against the old definition.
It survived because nothing exercised it:

- the runtime tests never passed a schema **with types** attached;
- `test/` was not in the `tsc` graph, so its type errors broke nothing — two were already sitting
  in `regressions.test.ts`;
- `examples/kit-blog` does use Zod, but CI only runs `vite build`, which does not type-check.

Fix: the bound becomes `unknown`, and `DataOf` matches on the `schema` **property** rather than on
the type parameter, so an absent schema falls back to `Record<string, unknown>`. A type-level test
covers all three cases — with a schema, without one, and mixed — and it was verified to fail when
the fix is reverted.

---

## 8. Finding: the grammar was being consumed as `any`

Found the first time ESLint ran with `strictTypeChecked`: `no-unsafe-call` in `parse/pipeline.ts`.

`mdast-util-svelte/index.d.ts` re-exported from `./lib/index.js`. The declarations for that
JavaScript are emitted into `types/`, unreachable from the package root, so TypeScript found none,
fell back to `any`, and `skipLibCheck` swallowed the error. The result: **every call from
`@svmd/core` into the grammar went unchecked** — the most important boundary in the repository.
`svelteSyntax` escaped only by accident, because its type was already hand-written.

The trap is that the two obvious placements fail in opposite ways:

- in `types/` → unreachable from the root, and everything resolves to `any`;
- beside the `.js` → they **shadow** it, and `checkJs` silently stops checking the source.

The way out is the third: the public surface is hand-written in the root `index.d.ts`, and `lib/`
never carries a `.d.ts` next to real `.js`. `types/` is left for internal verification only.
Verified with five deliberately mis-typed calls: all five passed before, all five fail now.
