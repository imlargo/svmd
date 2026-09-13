<script module>
export const metadata = {};

  export const prerender = true;
  import { base } from './shared.js';
</script>
<script>
  
  let open = $state(false);


  import { extra } from './more.js';
  let closed = $derived(!open);
</script>
<p>Base is {base}, extra is {extra}, open is {open}, closed is {closed}.</p>