<script lang="ts">
	import type { Snippet } from 'svelte';

	let { type = 'info', children }: { type?: 'info' | 'warning'; children?: Snippet } = $props();
</script>

<aside class={type}>
	{@render children?.()}
</aside>

<style>
	aside {
		border-left: 3px solid currentColor;
		padding-left: 1rem;
	}
	.warning {
		color: #b45309;
	}
</style>
