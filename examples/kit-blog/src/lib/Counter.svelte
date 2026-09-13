<script lang="ts">
	let { count = $bindable(0) }: { count?: number } = $props();
</script>

<button onclick={() => count++}>pulsado {count} veces</button>
