{#each rows as row, index (row.id)}

{#if row.visible}

## {row.title}

{#await row.body}

Loading…

{:then body}

{@html body}

{:catch error}

Failed: {error.message}

{/await}

{:else}

Hidden.

{/if}

{/each}

{#key version}

<Chart />

{/key}

{#snippet cell(value)}

<td>{value}</td>

{/snippet}

{@render cell('x')}
