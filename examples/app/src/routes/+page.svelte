<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
</script>

<svelte:head><title>svmd example</title></svelte:head>

<div class="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-24 text-center">
	<h1 class="text-4xl font-semibold tracking-tight">svmd example</h1>
	<p class="text-muted-foreground">
		A minimal SvelteKit app, scaffolded with <code>sv create</code> and shadcn-svelte, wired to svmd.
		The blog is the real demonstration — components, expressions, control blocks and syntax highlighting,
		all compiled from markdown.
	</p>
	<div class="flex justify-center gap-3">
		<Button href="/blog">Read the blog</Button>
		<Button href="/about" variant="outline">About this example</Button>
	</div>
</div>
