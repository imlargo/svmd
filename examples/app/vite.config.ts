import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { svmd } from '@svmd/vite';
import { shikiHighlighter } from '@svmd/shiki';

export default defineConfig({
	plugins: [
		tailwindcss(),
		// Before `sveltekit()`, the same way it goes before `svelte()` in a plain
		// Vite project: it has to hand vite-plugin-svelte already-compiled Svelte,
		// not markdown.
		svmd({
			// The blog collection under src/content/, and one-off pages that import
			// a sibling `content.md` directly (see src/routes/about/).
			include: ['src/content/blog/**/*.md', 'src/routes/**/content.md'],
			// Mirrors `content.ts`'s own glob: a file this excludes is not a
			// component, so compiling it here would produce a route `getCollection`
			// never lists — the exclusion has to live in both places.
			exclude: ['**/node_modules/**', '**/_*.md'],
			highlight: await shikiHighlighter({ theme: 'github-dark' })
		}),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Static: every route below is prerenderable, and it is the simplest
			// adapter to verify a real build with (no platform detection).
			adapter: adapter()
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
