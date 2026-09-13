<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';

	let count = $state(0);
</script>

<Button onclick={() => count++}>Clicked {count} time{count === 1 ? '' : 's'}</Button>
