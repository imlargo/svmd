import { createContent } from '@svmd/content';
import { z } from 'zod';

/**
 * The whole content layer: two globs and a schema.
 *
 * `meta` is eager but imports only `metadata`, so listing pages pay for the
 * frontmatter and nothing else. `body` is lazy, so a post's markup — and every
 * component it imports — only enters the bundle for the route that renders it.
 */
export const { getCollection, getEntry } = createContent({
	blog: {
		// The negative pattern has to mirror svmd's `include`: a file this glob
		// skips is not a component, so pulling it in here would hand Vite a `.md`
		// it does not know how to parse.
		meta: import.meta.glob(['/src/content/blog/**/*.md', '!**/_*.md'], {
			eager: true,
			import: 'metadata'
		}),
		body: import.meta.glob(['/src/content/blog/**/*.md', '!**/_*.md']),
		schema: z.object({
			title: z.string(),
			date: z.coerce.date(),
			draft: z.boolean().default(false),
			tags: z.array(z.string()).default([])
		})
	}
});
