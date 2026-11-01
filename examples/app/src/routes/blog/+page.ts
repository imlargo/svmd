import { getCollection } from '#lib/content.js';

export const prerender = true;

export const load = () => ({
	posts: getCollection('blog', (post) => !post.data.draft).sort(
		(a, b) => b.data.date.getTime() - a.data.date.getTime()
	)
});
