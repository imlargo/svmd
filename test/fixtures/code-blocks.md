Inline code with syntax: `{#if cond}` and `{price}`.

```svelte
<script>
  let count = $state(0);
</script>

{#if count > 0}
  <p>{count}</p>
{/if}
```

```js twoslash foo=bar
const a = { b: 1 };
```

    indented code with {braces}
