import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  // Mirrors the `paths` in tsconfig.json: tests run against source, not against
  // a sibling's `dist`, so no build is needed to run them. What `dist` actually
  // resolves to is covered separately, by scripts/consumer-check.mjs.
  resolve: {
    alias: {
      '@svmd/content': source('content'),
      '@svmd/core': source('core'),
      '@svmd/shiki': source('shiki'),
      svmd: source('svmd'),
    },
  },
  test: {
    // The forks keep upstream's JavaScript and upstream's file names, so their
    // suites are `test/*.js`, not `*.test.ts`.
    include: ['test/**/*.test.ts', 'packages/*/test/*.js'],
    exclude: ['**/node_modules/**', 'examples/**'],
    environment: 'node',
    // performance.test.ts asserts the NF3 budget in wall-clock time, which is
    // meaningless while other workers compete for the same cores.
    fileParallelism: false,
  },
});
