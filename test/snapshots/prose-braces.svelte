<script module>
export const metadata = {};
</script>
<p>Use the &#123;#if&#125; block when you need a branch, and close it with &#123;/if&#125; at the end.</p>
<p>Paste &#123; "name": "foo", "n": 1 &#125; into your config.</p>
<p>Pick &#123;a, b&#125; from the list, and leave an unclosed &#123; brace alone.</p>
<p>Empty &#123;&#125; braces and a lone &#125; too.</p>
<p>Real ones still work: {price} and {items.length} and {fmt(date)}.</p>
<p>Escape hatch for an object: {({ a: 1 })}</p>