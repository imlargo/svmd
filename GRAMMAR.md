# Grammar reference

The full contract between your markdown and the Svelte it compiles to. What is listed here
works; anything else is escaped as text. This is the up-to-date reference.
[`SPEC.md`](./SPEC.md) is the original design document, kept as written even where the
implementation later diverged, and [`ARCHITECTURE.md`](./ARCHITECTURE.md) explains _why_ each
rule exists, not just what it is.

## Expressions

```md
The price is {price} and there are {items.length} items.
```

Any valid JavaScript expression is accepted. What looks like an expression but is almost always
prose is **not**:

| You write                   | You get      |
| --------------------------- | ------------ |
| `{price}`                   | expression   |
| `{items.length}`            | expression   |
| `{fmt(date, 'long')}`       | expression   |
| `use the {#if} block here`  | literal text |
| `paste { "name": "foo" }`   | literal text |
| `pick {a, b} from the list` | literal text |
| `a { stray brace`           | literal text |

The rule: accepted if it parses as **one** complete expression whose root is neither an object
literal nor a sequence. If you really do want an object literal, wrap it in parentheses:
`{({ a: 1 })}`.

An expression cannot cross a blank line.

## Block components

```md
<Callout type="warning">

This **is** parsed as markdown, with [links](/x) and lists.

</Callout>
```

The blank lines are optional; the content is parsed as markdown either way.

## Inline components

```md
This is <Badge>new</Badge> in version 2.
```

## HTML elements

They work like components, markdown inside included:

```md
<div class="note">

With **bold** inside.

</div>
```

A block element that fits on one line works too:

```md
<div class="note">with **bold**</div>
```

## Control blocks

```md
{#if premium}

## Subscriber-only content

{:else if trial}

You have {days} days left.

{:else}

[Subscribe](/pricing)

{/if}
```

Supported: `{#if}`, `{#each}`, `{#await}`, `{#key}`, `{#snippet}`, with their `{:else}`,
`{:else if}`, `{:then}` and `{:catch}` branches.

Each token must be **alone on its line**. An `{#if}` in the middle of a paragraph is prose, not
syntax.

## Special tags

```md
{@const total = price * qty}

{@html rawContent}

{@render row(item)}
```

They work inline too: `the total is {@html total}`.

## Attributes and directives

```md
<Widget
bind:value
onclick={go}
on:custom={go}
use:action
class:active
transition:fade|local={{ duration: 200 }}
style:color="red"
--accent="#f00"
data={{ a: 1, b: "}" }}
class="a {b} c"
{shorthand}
{...rest}
disabled
/>
```

Every Svelte attribute form, including `|` modifiers, object literals with spaces, and braces
inside strings.

Dotted and namespaced names work as well:

```md
<Foo.Bar />
<svelte:head><title>Page</title></svelte:head>
```

## Scripts and styles

```md
<script module>
  export const prerender = true;
</script>

<script lang="ts">
  import Counter from '$lib/Counter.svelte';
  let count: number = $state(0);
</script>

<style>
  h1 { color: var(--accent) }
</style>
```

You can write several blocks: they are merged into one. Repeated imports are dropped, `lang="ts"`
is preserved, and two declarations of the same name are an error that names the line.

## Frontmatter

```md
---
title: My post
tags: [svelte, markdown]
---

# {title}
```

It is exported as `metadata`, and every key is also declared as a local constant, so `{title}`
works with nothing else. Keys you already declare in a `<script>` are left alone.

Frontmatter is parsed as YAML 1.2, so an unquoted date is a string. Use a schema to convert it
(see [Configuration](./README.md#configuration) in the README).

## What gets escaped

| Context                                          | Braces escaped? |
| ------------------------------------------------ | --------------- |
| Paragraph, heading, list and table text          | yes             |
| Code blocks and inline code                      | yes             |
| Raw HTML from a rehype plugin or the highlighter | yes             |
| Expressions, blocks and `{@…}` tags              | no              |
| Attributes                                       | no              |
| `<script>` and `<style>`                         | no              |
| Content of a component listed in `rawComponents` | no              |

## Components that handle their own content

By default markdown is parsed inside every component, which is the main reason this project
exists. Sometimes you do not want it: a component that shows code, an editor, anything that cares
about whitespace. For those, say so once:

```js
svmd({ rawComponents: ['Code', 'Editor'] });
```

Inside one of them, **what you write is what Svelte gets**:

```md
<Code>
**this** is not bold, and {value} really is an expression
</Code>
```

```svelte
<Code>
**this** is not bold, and {value} really is an expression
</Code>
```

Markdown stays literal and braces are **not** escaped: inside that component you are writing
Svelte, so expressions, control blocks and nested components all work, parsed by Svelte rather
than by svmd.

It is a property of the component, not of where you use it, which is why it is declared in the
config rather than with an attribute.

## Block elements inside a paragraph

Markdown puts loose text in a `<p>`, and a block element cannot live inside one: Svelte rejects
the result outright. So the paragraph is split:

```md
text <div>x</div> more
```

```svelte
<p>text </p>
<div>x</div>
<p> more</p>
```

For a **component** that cannot be decided: there is no way to know from here whether shadcn's
`<Card>` renders a `<div>` or `<Badge>` a `<span>`. Position is the only signal:

```md
Press <Button>here</Button> now. ← inline, stays in the paragraph
```

```md
<Card> ← alone on its line, it is a block
content
</Card>
```

If you use a component that renders a block **in the middle of a sentence**, say so once:

```js
svmd({ blockElements: ['Card', 'Alert', 'Accordion'] });
```

Then `text <Card>x</Card> more` splits exactly like a `<div>`.

## Known limits

- **Do not indent content inside a component.** Four spaces make it a code block; that is
  CommonMark, not svmd.
- An expression cannot contain a blank line.
- Control blocks go on their own line; inline they are prose.
- **A markdown list inside `{#each}` produces one list per iteration.** That is arithmetic, not a
  bug: each pass repeats the whole block, `<ul>` included. Write the markup if you want one list:

  ```md
  <ul>
  {#each rows as row (row.id)}
  <li>row {row.id}</li>
  {/each}
  </ul>
  ```
