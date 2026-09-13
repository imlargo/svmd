<script lang="ts">
	let { data } = $props();
</script>

<h1>Posts</h1>

<ul>
	{#each data.posts as post (post.slug)}
		<li>
			<a href="/blog/{post.slug}">{post.data.title}</a>
			<time datetime={post.data.date.toISOString()}>
				{post.data.date.toLocaleDateString('es')}
			</time>
		</li>
	{/each}
</ul>
