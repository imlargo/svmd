import { createContent } from '@svmd/content';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { describe, expect, it } from 'vitest';

const meta = {
  '/src/content/blog/2026-first.md': { title: 'First', draft: false },
  '/src/content/blog/2026-second.md': { title: 'Second', draft: true },
  '/src/content/blog/nested/deep.md': { title: 'Deep', draft: false },
};

const body = {
  '/src/content/blog/2026-first.md': async () => ({
    default: 'FirstComponent',
    metadata: meta['/src/content/blog/2026-first.md'],
  }),
  '/src/content/blog/2026-second.md': async () => ({
    default: 'SecondComponent',
    metadata: meta['/src/content/blog/2026-second.md'],
  }),
  '/src/content/blog/nested/deep.md': async () => ({
    default: 'DeepComponent',
    metadata: meta['/src/content/blog/nested/deep.md'],
  }),
};

const content = createContent({ blog: { meta, body } });

describe('content collections', () => {
  it('derives slugs from the common prefix', () => {
    expect(content.getCollection('blog').map((entry) => entry.slug)).toEqual([
      '2026-first',
      '2026-second',
      'nested/deep',
    ]);
  });

  it('exposes frontmatter without loading bodies', () => {
    expect(content.getCollection('blog')[0]!.data).toEqual({ title: 'First', draft: false });
  });

  it('filters', () => {
    const published = content.getCollection('blog', (entry) => !entry.data.draft);
    expect(published.map((entry) => entry.slug)).toEqual(['2026-first', 'nested/deep']);
  });

  it('looks an entry up by slug', () => {
    expect(content.getEntry('blog', 'nested/deep')?.data.title).toBe('Deep');
    expect(content.getEntry('blog', 'missing')).toBeUndefined();
  });

  it('loads the body on demand', async () => {
    const entry = content.getEntry('blog', '2026-first')!;
    expect((await entry.load()).default).toBe('FirstComponent');
  });

  it('validates against a Standard Schema and uses its output', () => {
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: (value: unknown) => ({
          value: { ...(value as object), normalised: true },
        }),
      },
    };

    const validated = createContent({ blog: { meta, schema } });
    expect(validated.getEntry('blog', '2026-first')!.data).toMatchObject({ normalised: true });
  });

  it('reports schema failures with the file path', () => {
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: () => ({ issues: [{ message: 'title is required' }] }),
      },
    };

    const broken = createContent({ blog: { meta, schema } });
    expect(() => broken.getCollection('blog')).toThrow(/2026-first\.md[\s\S]*title is required/);
  });

  it('refuses an unknown collection by name', () => {
    expect(() => content.getCollection('nope' as never)).toThrow(/Unknown content collection/);
  });

  it('explains what is missing when no lazy glob was given', async () => {
    const indexOnly = createContent({ blog: { meta } });
    await expect(indexOnly.getEntry('blog', '2026-first')!.load()).rejects.toThrow(/no lazy glob/);
  });

  it('treats index.md as the collection root', () => {
    const single = createContent({
      docs: {
        meta: {
          '/src/docs/index.md': {},
          '/src/docs/guide/index.md': {},
          '/src/docs/guide/install.md': {},
        },
      },
    });
    expect(single.getCollection('docs').map((entry) => entry.slug)).toEqual([
      'guide',
      'guide/install',
      '',
    ]);
  });
});

/**
 * Type-level, and the reason this file typechecks in CI.
 *
 * `entry.data` used to collapse to `never` for every collection that carried a
 * schema, because the bound was `CollectionDefinition<never>` and `Data` sits in
 * an output position. Nothing caught it: the runtime tests never passed a schema,
 * and `test/` was outside the build graph.
 */
describe('typed collections', () => {
  it('infers entry.data from the schema', () => {
    const schema: StandardSchemaV1<unknown, { title: string; draft: boolean }> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) => ({ value: value as { title: string; draft: boolean } }),
      },
    };

    const typed = createContent({ blog: { meta, body, schema } });
    const entry = typed.getCollection('blog')[0]!;

    // If `data` collapsed back to `never`, these two lines would not compile.
    const title: string = entry.data.title;
    typed.getCollection('blog', (candidate) => !candidate.data.draft);

    expect(title).toBe('First');
  });

  it('falls back to Record<string, unknown> without a schema', () => {
    const untyped = createContent({ blog: { meta, body } });
    const data: Record<string, unknown> = untyped.getCollection('blog')[0]!.data;
    expect(data.title).toBe('First');
  });
});
