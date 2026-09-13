<script lang="ts">
	import { Card, CardHeader, CardTitle, CardDescription } from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { resolve } from '$app/paths';

	let { data } = $props();
</script>

<svelte:head><title>Blog</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-6 px-6 py-12">
	<h1 class="text-3xl font-semibold tracking-tight">Blog</h1>

	<div class="grid gap-4">
		{#each data.posts as post (post.slug)}
			<a href={resolve('/blog/[slug]', { slug: post.slug })}>
				<Card class="transition-colors hover:bg-accent">
					<CardHeader>
						<CardTitle>{post.data.title}</CardTitle>
						<CardDescription>
							{post.data.date.toLocaleDateString('en', { dateStyle: 'long' })}
						</CardDescription>
					</CardHeader>
					{#if post.data.tags.length > 0}
						<div class="flex gap-2 px-6 pb-6">
							{#each post.data.tags as tag (tag)}
								<Badge variant="outline">{tag}</Badge>
							{/each}
						</div>
					{/if}
				</Card>
			</a>
		{/each}
	</div>
</div>
