import { svelteSyntax } from '@svmd/micromark-extension-svelte';
import { svelteFromMarkdown } from '@svmd/mdast-util-svelte';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { gfm } from 'micromark-extension-gfm';
import { frontmatter } from 'micromark-extension-frontmatter';
import { unified, type PluggableList, type Processor } from 'unified';
import { highlightCode, type Highlighter } from '../transform/highlight.js';

/**
 * Everything that shapes the pipeline.
 *
 * Deliberately not the whole of `CompileOptions`: `filename` and `frontmatter`
 * change per file or per call and must not take part in deciding whether a
 * pipeline can be reused.
 */
export interface PipelineOptions {
  remarkPlugins?: PluggableList | undefined;
  rehypePlugins?: PluggableList | undefined;
  highlight?: Highlighter | false | undefined;
  gfm?: boolean | undefined;
  blockElements?: readonly string[] | undefined;
  rawComponents?: readonly string[] | undefined;
}

/**
 * The two data slots `remark-parse` uses to collect parser extensions. Declared
 * locally rather than by augmenting unified's `Data`, so that a project which
 * also has remark-parse installed does not end up with conflicting types.
 */
interface ParserData {
  micromarkExtensions?: unknown[];
  fromMarkdownExtensions?: unknown[];
}

export interface Pipeline {
  /** Transformers that run on the markdown tree. */
  markdown: Processor;
  /** Transformers that run on the HTML tree. */
  html: Processor;
  /** Parser extensions, collected from this package and from remark plugins. */
  micromarkExtensions: unknown[];
  fromMarkdownExtensions: unknown[];
}

/**
 * Build the unified pipeline for a set of options.
 *
 * Freezing a processor walks and instantiates every plugin, which is far from
 * free, so a compiler holds on to one of these rather than building it per
 * file. `getPipeline` exists for the one-off `compile()` call.
 */
export function createPipeline(options: PipelineOptions): Pipeline {
  const markdown = unified();

  // Register the grammar through unified's normal data channels so that a
  // remark plugin adding its own micromark extension composes with ours
  // exactly as it would under remark-parse.
  markdown.use(function registerSvelte(this: Processor) {
    const data = this.data() as ParserData;
    const micromarkExtensions = (data.micromarkExtensions ??= []);
    const fromMarkdownExtensions = (data.fromMarkdownExtensions ??= []);

    micromarkExtensions.push(frontmatter(['yaml']));
    fromMarkdownExtensions.push(frontmatterFromMarkdown(['yaml']));

    if (options.gfm !== false) {
      micromarkExtensions.push(gfm());
      fromMarkdownExtensions.push(gfmFromMarkdown());
    }

    micromarkExtensions.push(svelteSyntax({ rawComponents: options.rawComponents }));
    fromMarkdownExtensions.push(svelteFromMarkdown({ blockElements: options.blockElements }));
  });

  if (options.highlight) {
    markdown.use(highlightCode, options.highlight);
  }

  if (options.remarkPlugins) markdown.use(options.remarkPlugins);
  markdown.freeze();

  const html = unified();
  if (options.rehypePlugins) html.use(options.rehypePlugins);
  html.freeze();

  const data = markdown.data() as ParserData;

  return {
    markdown,
    html,
    micromarkExtensions: data.micromarkExtensions ?? [],
    fromMarkdownExtensions: data.fromMarkdownExtensions ?? [],
  };
}

/**
 * Identity for values that cannot be compared by value.
 *
 * A plugin is a function, and two calls pass the same function rather than an
 * equal one, so the cache key is built from identities rather than from
 * contents.
 */
const identities = new WeakMap<object, number>();
let nextIdentity = 0;

function identify(value: unknown): string {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return String(value);
  }

  let id = identities.get(value);
  if (id === undefined) {
    id = nextIdentity++;
    identities.set(value, id);
  }

  return `#${id}`;
}

/**
 * A key that is equal for two option sets that would build the same pipeline.
 *
 * Keying on the options object itself looks right and never works: a caller
 * that spreads per-file state into it — `{...shared, filename}`, which is what
 * the Vite plugin does — hands over a new object every time, and the cache
 * misses on every file.
 */
function pipelineKey(options: PipelineOptions): string {
  return [
    options.gfm === false ? 'nogfm' : 'gfm',
    identify(options.highlight ?? false),
    (options.blockElements ?? []).join(','),
    (options.rawComponents ?? []).join(','),
    (options.remarkPlugins ?? []).map(identify).join(','),
    (options.rehypePlugins ?? []).map(identify).join(','),
  ].join('|');
}

const cache = new Map<string, Pipeline>();

/** Build a pipeline, or reuse one built for equivalent options. */
export function getPipeline(options: PipelineOptions): Pipeline {
  const key = pipelineKey(options);
  let pipeline = cache.get(key);

  if (!pipeline) {
    pipeline = createPipeline(options);
    cache.set(key, pipeline);
  }

  return pipeline;
}
