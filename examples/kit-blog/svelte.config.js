import adapter from '@sveltejs/adapter-static';

/**
 * Note what is *not* here: no `extensions: ['.svelte', '.md']`.
 *
 * That single line is the root of most mdsvex integration bugs, and svmd never
 * needs it — scoping lives in the Vite plugin's `include` globs instead.
 *
 * @type {import('@sveltejs/kit').Config}
 */
export default {
  kit: {
    adapter: adapter({ fallback: undefined }),
    prerender: { entries: ['*'] },
  },
};
