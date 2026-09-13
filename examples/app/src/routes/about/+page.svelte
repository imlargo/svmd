<script lang="ts">
	import Post, { metadata } from './content.md';
</script>

<svelte:head><title>{metadata.title}</title></svelte:head>

<article class="mx-auto prose max-w-2xl px-6 py-12 prose-neutral dark:prose-invert">
	<Post />
</article>
