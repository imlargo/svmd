import type { Root } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { PluggableList } from 'unified';
import { VFile } from 'vfile';
import { emitComponent } from './generate/component.js';
import { SvmdError, type SvmdPoint, type SvmdWarning } from './diagnostics/errors.js';
import { extractFrontmatter, type FrontmatterOptions } from './parse/frontmatter.js';
import { hoistScriptsAndStyles } from './transform/hoist.js';
import type { Highlighter } from './transform/highlight.js';
import { createPipeline, getPipeline, type Pipeline } from './parse/pipeline.js';
import { mergeScripts } from './generate/script/merge.js';
import { SourceBuilder, type EncodedSourceMap } from './internal/source-builder.js';
import { svelteToHast } from './transform/to-hast.js';
import { collectWarnings } from './diagnostics/warnings.js';

export interface CompileOptions {
  /** Path of the file being compiled; used in diagnostics and source maps. */
  filename?: string | undefined;
  remarkPlugins?: PluggableList | undefined;
  rehypePlugins?: PluggableList | undefined;
  /** Syntax highlighting for fenced code blocks. Off by default (§I12). */
  highlight?: Highlighter | false | undefined;
  frontmatter?: FrontmatterOptions | undefined;
  /** GitHub Flavoured Markdown: tables, strikethrough, task lists. Default on. */
  gfm?: boolean | undefined;
  /**
   * Components that render a block-level element, such as shadcn's `Card`.
   *
   * Markdown puts loose inline content in a `<p>`, and what a component
   * renders is not knowable from here. Naming it keeps it out of one, the way
   * a `<div>` already is.
   */
  blockElements?: readonly string[] | undefined;
  /**
   * Components whose content is handed to Svelte untouched.
   *
   * Markdown inside a component is the default and the point of the project.
   * This is the way out for a component that would rather handle its own
   * children — a code sample, an editor, anything that cares about
   * whitespace. Inside one of these, what you write is what Svelte gets:
   * markdown syntax stays literal and braces are not escaped.
   */
  rawComponents?: readonly string[] | undefined;
}

export interface CompileResult {
  /** Svelte component source. */
  code: string;
  map: EncodedSourceMap;
  /** The frontmatter, after optional schema validation. */
  metadata: Record<string, unknown>;
  /** Non-fatal diagnostics, in document order. */
  warnings: SvmdWarning[];
  /** Data collected by remark/rehype plugins on the virtual file. */
  data: Record<string, unknown>;
}

/**
 * Compile markdown into Svelte component source.
 *
 * The result is Svelte, not JavaScript: `@sveltejs/vite-plugin-svelte` compiles
 * it afterwards, which is what gives TypeScript, HMR and the rest of the
 * toolchain for free (D2).
 *
 * Compiling many files with the same settings — a build, a dev server — should
 * go through `createCompiler` instead, which builds the pipeline once.
 */
export async function compile(
  source: string,
  options: CompileOptions = {},
): Promise<CompileResult> {
  const { filename, ...rest } = options;
  return compileWith(getPipeline(rest), rest, source, filename);
}

export interface Compiler {
  compile(source: string, filename?: string): Promise<CompileResult>;
}

/**
 * Build a compiler for one set of options.
 *
 * Freezing a unified processor instantiates every plugin, so a caller that
 * compiles a whole content directory wants to do it once. It also stops the
 * options object from having to be identical from call to call, which a caller
 * that spreads a filename into it cannot manage.
 */
export function createCompiler(options: CompileOptions = {}): Compiler {
  const { filename: _ignored, ...rest } = options;
  const pipeline = createPipeline(rest);

  return {
    compile(source, filename) {
      return compileWith(pipeline, rest, source, filename);
    },
  };
}

async function compileWith(
  pipeline: Pipeline,
  options: Omit<CompileOptions, 'filename'>,
  source: string,
  filename: string | undefined,
): Promise<CompileResult> {
  const file = new VFile({ value: source, ...(filename ? { path: filename } : {}) });

  const tree = parseMarkdown(source, pipeline, filename);
  const { metadata } = await extractFrontmatter(tree, source, filename, options.frontmatter ?? {});

  // Before the user's plugins run: the warnings are about what the author
  // wrote, not about what a plugin left behind.
  const warnings = collectWarnings(tree, source, filename);

  await pipeline.markdown.run(tree, file);

  const hoisted = hoistScriptsAndStyles(tree, source, filename);
  warnings.push(...hoisted.warnings);

  const scripts = mergeScripts(hoisted.scripts, hoisted.styles, { filename, source });

  const hast = svelteToHast(tree);
  await pipeline.html.run(hast, file);

  const builder = new SourceBuilder();
  emitComponent(builder, { hast, metadata, scripts });

  return {
    code: builder.toString(),
    map: builder.toMap({
      source: filename ?? 'source.md',
      sourceContent: source,
      ...(filename ? { file: filename + '.svelte' } : {}),
    }),
    metadata,
    warnings,
    data: file.data,
  };
}

function parseMarkdown(source: string, pipeline: Pipeline, filename: string | undefined): Root {
  try {
    return fromMarkdown(source, {
      extensions: pipeline.micromarkExtensions as never,
      mdastExtensions: pipeline.fromMarkdownExtensions as never,
    });
  } catch (cause) {
    throw toSvmdError(cause, source, filename);
  }
}

/**
 * Structure errors arrive as vfile messages from the mdast layer; give them the
 * shape everything downstream expects.
 */
function toSvmdError(cause: unknown, source: string, filename: string | undefined): unknown {
  if (cause instanceof SvmdError) return cause;

  const message = cause as
    | {
        ruleId?: string;
        source?: string;
        reason?: string;
        hint?: string;
        place?: { start?: SvmdPoint; line?: number; column?: number };
      }
    | null
    | undefined;

  if (message?.source !== 'svmd' || !message.ruleId) return cause;

  const place = message.place ?? {};
  const start: SvmdPoint | undefined =
    place.start ??
    (place.line !== undefined ? { line: place.line, column: place.column ?? 1 } : undefined);

  return new SvmdError({
    code: message.ruleId,
    message: message.reason ?? 'Invalid Svelte structure',
    hint: message.hint,
    filename,
    source,
    start,
    cause,
  });
}
