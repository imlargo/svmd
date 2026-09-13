import { getCollection, getEntry } from '$lib/content';
import { error } from '@sveltejs/kit';
import type { Component } from 'svelte';

export const prerender = true;

export const entries = () => getCollection('blog').map((post) => ({ slug: post.slug }));

export const load = async ({ params }) => {
  const entry = getEntry('blog', params.slug);
  if (!entry) error(404, `No such post: ${params.slug}`);

  // The body is fetched here and nowhere else, which is what keeps the index
  // page from bundling every post.
  const module = await entry.load();

  return { data: entry.data, Content: module.default as Component };
};
