import type { Root, Yaml } from 'mdast';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { SvmdError, type SvmdPoint } from '../diagnostics/errors.js';
import type { StandardSchemaV1 } from '@standard-schema/spec';

export interface FrontmatterOptions {
  /**
   * Replace the YAML parser. Receives the raw block, without the fences.
   */
  parse?: ((raw: string) => unknown) | undefined;
  /**
   * Any Standard Schema validator (Zod, Valibot, ArkType, …). Its output
   * replaces the parsed value, so coercions and defaults apply.
   */
  schema?: StandardSchemaV1 | undefined;
}

export interface FrontmatterResult {
  metadata: Record<string, unknown>;
}

/**
 * Pull the frontmatter out of an already-parsed tree.
 *
 * The block is parsed as part of the document rather than stripped beforehand,
 * which is why every line number the compiler reports — in the body as well as
 * in the frontmatter — matches the file the user is looking at.
 */
export async function extractFrontmatter(
  tree: Root,
  source: string,
  filename: string | undefined,
  options: FrontmatterOptions,
): Promise<FrontmatterResult> {
  const index = tree.children.findIndex((child) => child.type === 'yaml');
  if (index === -1) return { metadata: {} };

  const node = tree.children[index] as Yaml;
  tree.children.splice(index, 1);

  const start: SvmdPoint = node.position?.start ?? { line: 1, column: 1 };
  let value: unknown;

  try {
    value = options.parse ? options.parse(node.value) : parseYaml(node.value);
  } catch (cause) {
    throw new SvmdError({
      code: 'E006',
      message: 'Invalid YAML in frontmatter: ' + describeYamlError(cause),
      hint: 'Check indentation and quoting; a value containing `:` must be quoted.',
      filename,
      source,
      // The YAML body starts on the line after the opening fence.
      start: yamlErrorPoint(cause, start),
      cause,
    });
  }

  if (value === null || value === undefined) return { metadata: {} };

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new SvmdError({
      code: 'E006',
      message: 'Frontmatter must be a mapping, got ' + describeType(value),
      hint: 'Write `key: value` pairs at the top level of the frontmatter block.',
      filename,
      source,
      start,
    });
  }

  let metadata = value as Record<string, unknown>;

  if (options.schema) {
    let result = options.schema['~standard'].validate(metadata);
    if (result instanceof Promise) result = await result;

    if (result.issues) {
      throw new SvmdError({
        code: 'E007',
        message:
          'Frontmatter does not match the schema:\n' +
          result.issues.map((issue) => '  · ' + formatPath(issue.path) + issue.message).join('\n'),
        hint: 'Fix the frontmatter, or relax the schema for this collection.',
        filename,
        source,
        start,
      });
    }

    metadata = result.value as Record<string, unknown>;
  }

  return { metadata };
}

function formatPath(path: StandardSchemaV1.Issue['path']): string {
  if (!path || path.length === 0) return '';
  const parts = path.map((segment) =>
    typeof segment === 'object' && 'key' in segment ? String(segment.key) : String(segment),
  );
  return parts.join('.') + ': ';
}

function describeType(value: unknown): string {
  if (Array.isArray(value)) return 'a list';
  return typeof value;
}

function describeYamlError(cause: unknown): string {
  return cause instanceof Error ? (cause.message.split('\n')[0] ?? cause.message) : String(cause);
}

/** Map a YAML error's own line number onto the document. */
function yamlErrorPoint(cause: unknown, blockStart: SvmdPoint): SvmdPoint {
  if (cause instanceof YAMLParseError && cause.linePos?.[0]) {
    const { line, col } = cause.linePos[0];
    return { line: blockStart.line + line, column: col };
  }
  return blockStart;
}
