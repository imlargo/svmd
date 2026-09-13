---
title: Typed
---

<script lang="ts">
  import type { Snippet } from 'svelte';
  import Counter from './Counter.svelte';

  interface Props { children?: Snippet }
  let { children }: Props = $props();
  let count: number = $state(0);
</script>

# {title}

<Counter bind:count />
