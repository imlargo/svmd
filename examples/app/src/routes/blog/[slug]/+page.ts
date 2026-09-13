import { error } from '@sveltejs/kit';
import { getCollection, getEntry } from '$lib/content';

export const prerender = true;

// adapter-static needs every dynamic slug named up front — there is no server
// around at request time to ask "what slugs exist?".
export const entries = () => getCollection('blog').map((post) => ({ slug: post.slug }));

export const load = async ({ params }) => {
	const entry = getEntry('blog', params.slug);
	if (!entry) error(404, 'Post not found');

	const { default: Content } = await entry.load();
	return { data: entry.data, Content };
};
