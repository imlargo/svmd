<script>
  import { fade } from 'svelte/transition';
  import Widget from './Widget.svelte';
  let value = $state('');
  let active = $state(false);
  let rest = $state({});
  function go() {}
  function action(node) {}
</script>

<Widget bind:value onclick={go} on:custom={go} --accent="#f00" {...rest} disabled />

<div
  class:active
  style:color="red"
  transition:fade|local={{ duration: 200 }}
  use:action
  {...rest}
>
  <input bind:value />
</div>
