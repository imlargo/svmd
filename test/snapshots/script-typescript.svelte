<script module>
export const metadata = {title:"Typed"};
const { title } = metadata;
export const headings = [{"depth":1,"text":"Typed"}];
</script>
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Counter from './Counter.svelte';

  interface Props { children?: Snippet }
  let { children }: Props = $props();
  let count: number = $state(0);
</script>
<h1>Typed</h1>
<Counter bind:count />