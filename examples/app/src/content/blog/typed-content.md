---
title: TypeScript, snippets, and each
date: 2026-09-05
tags: [svelte, typescript]
---

<script lang="ts">
	interface Feature {
		name: string;
		done: boolean;
	}

	const features: Feature[] = [
		{ name: 'Real grammar, not regex over parsed HTML', done: true },
		{ name: 'Markdown inside components', done: true },
		{ name: 'Deny-by-default brace escaping', done: true }
	];
</script>

# {title}

A typed `<script>` block, merged into the component's own script through the AST, not by
concatenating strings. String concatenation is what breaks TypeScript in most markdown-to-Svelte
tools the moment a layout is involved.

{#each features as feature (feature.name)}

- {feature.done ? '✅' : '⬜️'} {feature.name}

{/each}

## A snippet

Every feature above, rendered again through one snippet instead of repeating the markup:

{#snippet status(done: boolean)}
<span class="font-mono text-xs">{done ? 'done' : 'pending'}</span>
{/snippet}

{#each features as feature (feature.name)}

{feature.name}: {@render status(feature.done)}

{/each}
