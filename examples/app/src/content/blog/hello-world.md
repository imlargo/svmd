---
title: Hello, svmd
date: 2026-09-01
tags: [svelte, markdown]
---

<script lang="ts">
	import Counter from '$lib/Counter.svelte';
	import Callout from '$lib/Callout.svelte';
</script>

# {title}

This paragraph is real markdown: **bold**, _italic_, and [a link](/about). Frontmatter keys are
bound as local constants, so `{title}` above works with nothing else declared.

A real Svelte component, interactive, right inside the markdown:

<Counter />

## Markdown inside a component

<Callout type="note">

This is parsed as markdown **because it is markdown** — svmd's whole reason to exist is that a
component's children get the same treatment as the rest of the page, not a block of opaque HTML.

- a list
- with items

</Callout>

{#if tags.includes('svelte')}

> This post is tagged `svelte`, so this blockquote renders. Try removing the tag from the
> frontmatter above and reloading — the whole block disappears, the way an `{#if}` should.

{/if}

## Braces in prose

Writing about Svelte syntax without triggering it is the actual hard problem markdown-to-Svelte
compilers have. Type the word for a conditional block and it stays a word: {#if}. Close it the
same way: {/if}. A stray object pasted from somewhere, { "not": "an expression" }, stays text too.
None of this is escaped by hand — svmd only accepts what parses as one real JavaScript expression,
and prose never does.

## Syntax highlighting

<Callout>

The fenced block below is highlighted at build time by Shiki, wired through `svmd({ highlight })`
in this project's own `vite.config.ts`.

</Callout>

```ts
interface Post {
	title: string;
	date: Date;
	draft: boolean;
}
```

## A table, because GFM is on by default

| Feature                | mdsvex                  | svmd                       |
| ---------------------- | ----------------------- | -------------------------- |
| Markdown in `<div>`    | not parsed (CommonMark) | parsed                     |
| Stray `{#if}` in prose | leaks through, breaks   | renders as text            |
| Scoping                | global `extensions`     | `include` / `exclude` glob |
