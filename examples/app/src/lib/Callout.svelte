<script lang="ts">
	import { Card, CardContent } from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { Snippet } from 'svelte';

	let { type = 'note', children }: { type?: 'note' | 'warning'; children: Snippet } = $props();
</script>

<Card
	class="not-prose my-6 border-l-4 {type === 'warning'
		? 'border-l-destructive'
		: 'border-l-primary'}"
>
	<CardContent class="prose prose-sm max-w-none pt-0 dark:prose-invert">
		<Badge variant={type === 'warning' ? 'destructive' : 'secondary'} class="mb-2 uppercase">
			{type}
		</Badge>
		{@render children()}
	</CardContent>
</Card>
