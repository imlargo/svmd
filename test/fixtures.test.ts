import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from '@svmd/core';
import { compile as compileSvelte } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';

const directory = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fixtures = readdirSync(directory)
  .filter((name) => name.endsWith('.md'))
  .sort();

describe('fixtures', () => {
  for (const name of fixtures) {
    const source = readFileSync(directory + name, 'utf8');

    describe(name, () => {
      it('compiles to the expected Svelte source', async () => {
        const result = await compile(source, { filename: name });
        await expect(result.code).toMatchFileSnapshot(
          `./snapshots/${name.replace(/\.md$/, '.svelte')}`,
        );
      });

      // The whole point of emitting Svelte instead of JavaScript is that the
      // official compiler is the arbiter of correctness (D2). A fixture that
      // snapshots cleanly but does not compile is not a passing fixture.
      it('is accepted by the Svelte compiler without warnings', async () => {
        const result = await compile(source, { filename: name });
        const compiled = compileSvelte(result.code, {
          filename: name + '.svelte',
          generate: 'client',
        });
        expect(compiled.warnings.map((warning) => `${warning.code}: ${warning.message}`)).toEqual(
          [],
        );
      });

      it('server-renders', async () => {
        const result = await compile(source, { filename: name });
        expect(() =>
          compileSvelte(result.code, { filename: name + '.svelte', generate: 'server' }),
        ).not.toThrow();
      });
    });
  }
});
