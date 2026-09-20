---
title: A route that is a markdown file
---

# {title}

This page is a `+page.md` — SvelteKit's router resolves it directly, with no
`+page.svelte` wrapper importing it.

- Frontmatter binds as a local: the heading above reads `{title}`.
- Markdown parses normally: **bold**, `code`, and a list.
