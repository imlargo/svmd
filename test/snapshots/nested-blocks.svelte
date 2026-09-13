<script module>
export const metadata = {};
</script>
{#each rows as row, index (row.id)}
{#if row.visible}
<h2>{row.title}</h2>
{#await row.body}
<p>Loading…</p>
{:then body}
{@html body}
{:catch error}
<p>Failed: {error.message}</p>
{/await}
{:else}
<p>Hidden.</p>
{/if}
{/each}
{#key version}
<Chart />
{/key}
{#snippet cell(value)}
<td>
{value}
</td>
{/snippet}
{@render cell('x')}