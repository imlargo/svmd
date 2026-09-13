<script module>
  export const prerender = true;
  import { base } from './shared.js';
</script>

<script>
  import { base } from './shared.js';
  let open = $state(false);
</script>

<script>
  import { extra } from './more.js';
  let closed = $derived(!open);
</script>

Base is {base}, extra is {extra}, open is {open}, closed is {closed}.
