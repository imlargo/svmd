/**
 * Ambient module declaration for the files svmd compiles, so a static
 * `import Post, { metadata } from './post.md'` type-checks without a project writing this itself.
 * Reference it once, project-wide — in `src/app.d.ts`, or any other ambient `.d.ts` already in the
 * program:
 *
 * ```ts
 * /// <reference types="@svmd/vite/client" />
 * ```
 *
 * Declares `.md` only. A project compiling a different extension through `include` (`.svx`, ...)
 * needs its own `declare module '*.svx' { ... }`, copying the body below — TypeScript has no
 * mechanism to key an ambient module declaration off a plugin's runtime config.
 *
 * `metadata` is `unknown` here: this covers the plain static-import case, which has no schema to
 * infer from. `@svmd/content`'s `ContentModule<Data>` types the collection case, where a schema
 * gives frontmatter a real shape.
 */
declare module '*.md' {
  import type { Component } from 'svelte';

  const component: Component<Record<string, never>>;
  export default component;
  export const metadata: unknown;
}
