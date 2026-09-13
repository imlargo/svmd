/**
 * A content layer in about a hundred lines.
 *
 * Everything here is built on `import.meta.glob`, which Vite resolves at build
 * time. There is no separate build step, no generated directory and no alias to
 * configure — the three things that make the heavyweight alternatives feel
 * magic (D8). If cross-collection references or an image pipeline are ever
 * needed, `content-collections` is a drop-in replacement for this file.
 */

import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Component } from 'svelte';

/**
 * Re-exported so a caller can name the type without adding the dependency. The
 * spec package is types-only, which is what keeps this package at zero runtime
 * dependencies while still sharing one definition with `@svmd/core`.
 */
export type { StandardSchemaV1 };

/**
 * What a compiled `.md` module exports.
 *
 * `import type { Component } from 'svelte'` costs nothing at runtime — it is
 * erased entirely, the same as the `@standard-schema/spec` import above — so
 * this stays true to zero runtime dependencies while letting a caller use
 * `entry.load()`'s `default` directly as a component, `<Content />`, instead
 * of casting away from `unknown` themselves on every call site.
 */
export interface ContentModule<Data> {
  default: Component<Record<string, never>>;
  metadata: Data;
}

export interface CollectionDefinition<Data = Record<string, unknown>> {
  /**
   * Eager glob of frontmatter only:
   * `import.meta.glob('/src/content/blog/**\/*.md', { eager: true, import: 'metadata' })`
   *
   * Importing just `metadata` is what keeps the index cheap: the bodies stay
   * out of the bundle until something actually renders one (§9.3).
   */
  meta: Record<string, unknown>;

  /**
   * Lazy glob of the same files:
   * `import.meta.glob('/src/content/blog/**\/*.md')`
   */
  body?: Record<string, () => Promise<unknown>> | undefined;

  /** Path prefix to strip when deriving slugs. Inferred when omitted. */
  base?: string | undefined;

  /** Any Standard Schema validator. Its output becomes `entry.data`. */
  schema?: StandardSchemaV1<unknown, Data> | undefined;

  /** Override slug derivation entirely. */
  slug?: ((path: string) => string) | undefined;
}

export interface Entry<Name extends string, Data> {
  collection: Name;
  slug: string;
  /** Absolute module path, as it appears in the glob. */
  path: string;
  data: Data;
  /** Load the component and its metadata on demand. */
  load(): Promise<ContentModule<Data>>;
}

/**
 * The bound for a map of definitions.
 *
 * `unknown` and not `never`: `Data` sits in an output position, so bounding it
 * by `never` demands a schema that validates to `never`, which nothing
 * satisfies — every collection carrying a real schema failed the constraint,
 * and `entry.data` collapsed to `never`.
 */
export type Collections = Record<string, CollectionDefinition<unknown>>;

/**
 * Matches on the `schema` property rather than on the type parameter: with no
 * schema there is nothing to infer from, and the fallback has to win.
 */
type DataOf<Definition> = Definition extends {
  schema: StandardSchemaV1<unknown, infer Data>;
}
  ? Data
  : Record<string, unknown>;

export interface ContentApi<Defs extends Collections> {
  getCollection<Name extends keyof Defs & string>(
    name: Name,
    filter?: (entry: Entry<Name, DataOf<Defs[Name]>>) => boolean,
  ): Entry<Name, DataOf<Defs[Name]>>[];

  getEntry<Name extends keyof Defs & string>(
    name: Name,
    slug: string,
  ): Entry<Name, DataOf<Defs[Name]>> | undefined;
}

export function createContent<Defs extends Collections>(definitions: Defs): ContentApi<Defs> {
  const built = new Map<string, Map<string, Entry<string, unknown>>>();

  function entriesOf(name: string): Map<string, Entry<string, unknown>> {
    const cached = built.get(name);
    if (cached) return cached;

    const definition = definitions[name];
    if (!definition) {
      throw new Error(
        `Unknown content collection "${name}". Known collections: ${Object.keys(definitions).join(', ')}.`,
      );
    }

    const paths = Object.keys(definition.meta).sort();
    const base = definition.base ?? commonPrefix(paths);
    const entries = new Map<string, Entry<string, unknown>>();

    for (const path of paths) {
      const slug = definition.slug ? definition.slug(path) : deriveSlug(path, base);
      const clash = entries.get(slug);
      if (clash) {
        throw new Error(
          `Duplicate slug "${slug}" in collection "${name}": ${clash.path} and ${path}.`,
        );
      }

      entries.set(slug, {
        collection: name,
        slug,
        path,
        data: validate(definition.schema, definition.meta[path], name, path),
        load: loader(definition, path, name),
      });
    }

    built.set(name, entries);
    return entries;
  }

  return {
    getCollection(name, filter) {
      const all = [...entriesOf(name).values()] as Entry<never, never>[];
      return filter ? all.filter(filter as never) : all;
    },
    getEntry(name, slug) {
      return entriesOf(name).get(slug) as never;
    },
  };
}

function loader(
  definition: CollectionDefinition<unknown>,
  path: string,
  name: string,
): () => Promise<ContentModule<unknown>> {
  return async () => {
    const load = definition.body?.[path];
    if (!load) {
      throw new Error(
        `Collection "${name}" has no lazy glob, so the body of ${path} cannot be loaded. ` +
          "Add `body: import.meta.glob('<same pattern>')` to the definition.",
      );
    }
    return (await load()) as ContentModule<unknown>;
  };
}

/**
 * Validation is synchronous on purpose: `getCollection` is called from
 * `+page.ts` and from templates, where an async index would be contagious.
 * Every mainstream validator is synchronous for plain data.
 */
function validate<Data>(
  schema: StandardSchemaV1<unknown, Data> | undefined,
  value: unknown,
  name: string,
  path: string,
): Data {
  if (!schema) return value as Data;

  const result = schema['~standard'].validate(value);
  if (result instanceof Promise) {
    throw new Error(
      `The schema for collection "${name}" validates asynchronously, which is not supported here. ` +
        'Use a synchronous validator, or validate inside your `load` function.',
    );
  }

  if (result.issues) {
    throw new Error(
      `Frontmatter of ${path} does not match the schema for "${name}":\n` +
        result.issues.map((issue) => '  · ' + issue.message).join('\n'),
    );
  }

  return result.value;
}

/** Longest shared directory prefix, so `base` rarely has to be given. */
function commonPrefix(paths: string[]): string {
  const [head] = paths;
  if (!head) return '';
  if (paths.length === 1) return head.slice(0, head.lastIndexOf('/') + 1);

  let prefix = head;
  for (const path of paths) {
    while (!path.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (prefix === '') return '';
    }
  }
  return prefix.slice(0, prefix.lastIndexOf('/') + 1);
}

function deriveSlug(path: string, base: string): string {
  let slug = path.startsWith(base) ? path.slice(base.length) : path;
  slug = slug.replace(/\.md$/, '');
  slug = slug.replace(/(^|\/)index$/, '');
  return slug.replace(/^\/+|\/+$/g, '');
}
