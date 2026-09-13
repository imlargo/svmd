import { uneval } from 'devalue';
import type { SourceBuilder } from '../internal/source-builder.js';

/**
 * Names that must not be bound from frontmatter.
 *
 * The reserved words plus `metadata` itself, which is the binding they would be
 * destructured from.
 */
const RESERVED = new Set([
  ...`arguments await break case catch class const continue debugger default delete do else
	enum eval export extends false finally for function if implements import in instanceof
	interface let new null package private protected public return static super switch this
	throw true try typeof var void while with yield`.split(/\s+/),
  'metadata',
]);

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Frontmatter keys that can be exposed as local constants.
 *
 * `# {title}` has to work without ceremony, which means the keys have to reach
 * the template's scope. A key is skipped when it could not be a variable, when
 * binding it would shadow something the author declared, or when it names a
 * reserved word — all of which would otherwise turn a perfectly good document
 * into a syntax error somewhere the author cannot see.
 */
function bindableKeys(metadata: Record<string, unknown>, declared: ReadonlySet<string>): string[] {
  const names: string[] = [];

  for (const key of Object.keys(metadata)) {
    if (!IDENTIFIER.test(key)) continue;
    if (RESERVED.has(key)) continue;
    if (declared.has(key)) continue;
    names.push(key);
  }

  return names;
}

/**
 * Write `export const metadata = …` and the bindings that go with it.
 *
 * `devalue` rather than `JSON.stringify` because a schema may coerce a
 * frontmatter string into a `Date`, and losing it back to a string is mdsvex
 * #745.
 */
export function appendMetadata(
  builder: SourceBuilder,
  metadata: Record<string, unknown>,
  declared: ReadonlySet<string>,
): void {
  builder.append('export const metadata = ' + uneval(metadata) + ';\n');

  const names = bindableKeys(metadata, declared);
  if (names.length > 0) {
    builder.append('const { ' + names.join(', ') + ' } = metadata;\n');
  }
}
