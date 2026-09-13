import { sveltekit } from '@sveltejs/kit/vite';
import { svmd } from 'svmd';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    svmd({
      // Only these files are markdown components. Everything else — the
      // README, the changelog, anything under src/routes — is left alone.
      include: ['src/content/**/*.md'],
      exclude: ['**/_*.md'],
    }),
    sveltekit(),
  ],
});
