<script lang="ts">
	let { data } = $props();
	// The component is data, so it has to be a `$derived` local before it can be
	// used as a tag — the markdown supplies its own heading.
	const Content = $derived(data.Content);
</script>

<article>
	<Content />
	<footer>
		<time datetime={data.data.date.toISOString()}>
			{data.data.date.toLocaleDateString('es')}
		</time>
		{#each data.data.tags as tag (tag)}<span class="tag">{tag}</span>{/each}
	</footer>
</article>
