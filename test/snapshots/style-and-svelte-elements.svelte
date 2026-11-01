<script module>
export const metadata = {};
export const headings = [{"depth":1,"text":"A heading"}];
</script>
<svelte:head>
<title>Page</title>
</svelte:head>
<h1>A heading</h1>
<Foo.Bar prop="x" />
<p>Some text with a <!-- comment --> in it.</p>
<!-- a flow comment -->
<style>
  h1 { color: red }


  p { margin: 0 }
</style>
