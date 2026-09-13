/**
 * svmd does not ship an ambient `*.md` module declaration yet, so a static
 * `import Post, { metadata } from './content.md'` (see src/routes/about/) has
 * no type without this. `metadata` is `any` here since it varies per file —
 * `@svmd/content`'s glob-based collections type it properly through the
 * schema instead, which is what `src/lib/content.ts` uses for the blog.
 */
declare module '*.md' {
	import type { Component } from 'svelte';

	const component: Component<Record<string, never>>;
	export default component;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	export const metadata: any;
}
