---
title: TypeScript without friction
date: 2026-09-05
tags: [typescript]
---

<script module>
	export const kind = 'guide';
</script>

<script lang="ts">
	interface Row {
		id: number;
		label: string;
	}

	const rows: Row[] = [
		{ id: 1, label: 'one' },
		{ id: 2, label: 'two' }
	];
</script>

# {title}

This post is of kind `{kind}`.

{#each rows as row (row.id)}

- row {row.id}: **{row.label}**

{/each}

{#snippet total(n: number)}

<strong>Total: {n}</strong>

{/snippet}

{@render total(rows.length)}
