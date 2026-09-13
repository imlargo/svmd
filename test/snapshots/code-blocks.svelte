<script module>
export const metadata = {};
</script>
<p>Inline code with syntax: <code>&#123;#if cond&#125;</code> and <code>&#123;price&#125;</code>.</p>
<pre><code class="language-svelte">&lt;script&gt;
  let count = $state(0);
&lt;/script&gt;

&#123;#if count &gt; 0&#125;
  &lt;p&gt;&#123;count&#125;&lt;/p&gt;
&#123;/if&#125;
</code></pre>
<pre><code class="language-js">const a = &#123; b: 1 &#125;;
</code></pre>
<pre><code>indented code with &#123;braces&#125;
</code></pre>