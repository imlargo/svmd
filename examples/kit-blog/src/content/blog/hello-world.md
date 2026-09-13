---
title: Hello world
date: 2026-09-01
tags: [svelte, markdown]
---

<script lang="ts">
	import Counter from '$lib/Counter.svelte';
	import Callout from '$lib/Callout.svelte';

	let count = $state(0);
</script>

# {title}

Published with the tags: {tags.join(', ')}.

An interactive component inside the markdown:

<Counter bind:count />

{#if count > 2}

<Callout type="warning">

You have pressed it **{count}** times. This is markdown inside a component,
with [links](/) and lists:

- one
- two

</Callout>

{/if}

## Braces in prose

To write a condition in Svelte you use the {#if} block and close it with
{/if}. Neither breaks anything: they are escaped, because they are text.

An object pasted as-is, { "name": "foo" }, does not break anything either.

## Code

```svelte
<script>
	let count = $state(0);
</script>

{#if count > 0}
	<p>{count}</p>
{/if}
```

| Syntax    | Works |
| --------- | :---: |
| `{expr}`  |  yes  |
| `<Comp/>` |  yes  |
