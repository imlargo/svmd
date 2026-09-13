<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { resolve } from '$app/paths';

	let { data } = $props();
	// The component is data, so it has to be a `$derived` local before it can be
	// used as a tag — the markdown supplies its own heading.
	const Content = $derived(data.Content);
</script>

<svelte:head><title>{data.data.title}</title></svelte:head>

<article class="mx-auto max-w-2xl space-y-6 px-6 py-12">
	<a href={resolve('/blog')} class="text-sm text-muted-foreground hover:underline"
		>&larr; Back to blog</a
	>

	<div class="prose max-w-none prose-neutral dark:prose-invert">
		<Content />
	</div>

	<Separator />

	<footer class="flex items-center justify-between text-sm text-muted-foreground">
		<time datetime={data.data.date.toISOString()}>
			{data.data.date.toLocaleDateString('en', { dateStyle: 'long' })}
		</time>
		<div class="flex gap-2">
			{#each data.data.tags as tag (tag)}
				<Badge variant="outline">{tag}</Badge>
			{/each}
		</div>
	</footer>
</article>
