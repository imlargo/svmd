import type { Root as HastRoot } from 'hast';
import type { SvmdPoint } from '../diagnostics/errors.js';
import { generateMarkup } from './markup.js';
import type { MergedBlock, MergeResult } from './script/merge.js';
import type { SourceBuilder } from '../internal/source-builder.js';
import { appendMetadata } from './metadata.js';

export interface ComponentParts {
  hast: HastRoot;
  metadata: Record<string, unknown>;
  scripts: MergeResult;
}

/**
 * Assemble the Svelte component.
 *
 * The shape is fixed — module script, instance script, markup, styles — because
 * that is the order a Svelte file is conventionally written in, and the
 * generated file is something people read when a source map is not enough.
 */
export function emitComponent(builder: SourceBuilder, parts: ComponentParts): void {
  const { hast, metadata, scripts } = parts;

  emitModuleScript(builder, metadata, scripts);
  emitInstanceScript(builder, scripts.instance);

  generateMarkup(hast, builder);

  emitStyle(builder, scripts.style);
}

/**
 * The module script always exists, even for a document with no frontmatter and
 * no script of its own: `import { metadata } from './post.md'` has to work
 * everywhere, or the content layer cannot rely on it.
 */
function emitModuleScript(
  builder: SourceBuilder,
  metadata: Record<string, unknown>,
  scripts: MergeResult,
): void {
  const block = scripts.module;

  // `module` is emitted here, so it must not come through twice.
  const attributes = block ? block.attributes.replace(' module', '') : '';

  builder.append('<script module' + attributes + '>\n');
  appendMetadata(builder, metadata, scripts.declared);
  if (block) appendBlock(builder, block);
  builder.append('</script>\n');
}

function emitInstanceScript(builder: SourceBuilder, block: MergedBlock | null): void {
  if (!block) return;

  builder.append('<script' + block.attributes + '>');
  appendBlock(builder, block);
  builder.append('</script>\n');
}

function emitStyle(builder: SourceBuilder, block: MergedBlock | null): void {
  if (!block) return;

  builder.append('\n<style' + block.attributes + '>');
  appendBlock(builder, block);
  builder.append('</style>\n');
}

function appendBlock(builder: SourceBuilder, block: MergedBlock): void {
  appendMapped(builder, block.value, block.origin);
  if (!block.value.endsWith('\n')) builder.append('\n');
}

/**
 * Append text line by line, each mapped to where it came from.
 *
 * Mapping the block as a whole would put every TypeScript or CSS error on its
 * first line, which is worse than no source map at all.
 */
function appendMapped(builder: SourceBuilder, text: string, origin: SvmdPoint): void {
  const lines = text.split('\n');

  for (let index = 0; index < lines.length; index++) {
    if (index > 0) builder.append('\n');
    builder.append(lines[index] ?? '', {
      line: origin.line + index,
      column: index === 0 ? origin.column : 1,
    });
  }
}
