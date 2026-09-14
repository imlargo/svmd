<script lang="ts">
	import Post, { metadata } from './content.md';

	// A static import's `metadata` is `unknown` — nothing here validates it against a schema.
	// `@svmd/content`'s collections do that; this page is a plain import on purpose (README).
	const { title } = metadata as { title: string };
</script>

<svelte:head><title>{title}</title></svelte:head>

<article class="mx-auto prose max-w-2xl px-6 py-12 prose-neutral dark:prose-invert">
	<Post />
</article>
