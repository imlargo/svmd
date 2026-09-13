---
title: About this example
---

# {title}

This page is the simplest way to use svmd: no collection, no glob, just one `.md` file imported
by name from a `+page.svelte`, the way the top of svmd's own README shows it.

```svelte
<script>
	import Post, { metadata } from './content.md';
</script>

<h1>{metadata.title}</h1>
<Post />
```

The blog you came from uses [`@svmd/content`](/blog) instead, because a growing list of posts
needs an index — but a one-off page like this one does not.
