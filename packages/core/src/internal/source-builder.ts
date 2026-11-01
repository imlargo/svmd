import { decode, encode, type SourceMapSegment } from '@jridgewell/sourcemap-codec';
import type { SvmdPoint } from '../diagnostics/errors.js';

export interface EncodedSourceMap {
  version: 3;
  file?: string;
  sources: (string | null)[];
  sourcesContent?: (string | null)[];
  names: string[];
  mappings: string;
}

export interface SourceMapOptions {
  /** Path of the generated file. */
  file?: string | undefined;
  /** Path of the original markdown. */
  source: string;
  /** Original markdown, embedded so tooling never has to read it back. */
  sourceContent?: string | undefined;
}

/**
 * Accumulates generated code while recording where each piece came from.
 *
 * `magic-string` is the right tool for *editing* an existing string; the
 * markup generator *builds* a new one from a tree, so it needs an append-only
 * builder instead. Mappings are only ever appended in increasing
 * generated position, which is exactly the order the source map format wants.
 */
export class SourceBuilder {
  #parts: string[] = [];
  #mappings: SourceMapSegment[][] = [[]];
  #line = 0;
  #column = 0;

  /**
   * Append `text`, optionally mapping its first character back to `origin`.
   */
  append(text: string, origin?: SvmdPoint | null): this {
    if (text.length === 0) return this;

    if (origin) {
      (this.#mappings[this.#line] ??= []).push([
        this.#column,
        0,
        origin.line - 1,
        origin.column - 1,
      ]);
    }

    let start = 0;
    let index = text.indexOf('\n', start);
    while (index !== -1) {
      this.#line++;
      this.#column = 0;
      this.#mappings.push([]);
      start = index + 1;
      index = text.indexOf('\n', start);
    }
    this.#column += text.length - start;
    this.#parts.push(text);
    return this;
  }

  /** Current position in the generated file, 1-based line, 0-based column. */
  get position(): { line: number; column: number } {
    return { line: this.#line + 1, column: this.#column };
  }

  toString(): string {
    return this.#parts.join('');
  }

  toMap(options: SourceMapOptions): EncodedSourceMap {
    const map: EncodedSourceMap = {
      version: 3,
      sources: [options.source],
      names: [],
      mappings: encode(this.#mappings),
    };
    if (options.file !== undefined) map.file = options.file;
    if (options.sourceContent !== undefined) map.sourcesContent = [options.sourceContent];
    return map;
  }
}

/**
 * Where a position in the generated component came from in the markdown.
 *
 * @param line 1-based line in the generated code.
 * @param column 0-based column in the generated code, as Svelte reports it.
 * @returns The nearest mapped point at or before it, or `undefined` when nothing
 *   before it is mapped.
 */
export function originalPosition(
  map: EncodedSourceMap,
  line: number,
  column: number,
): SvmdPoint | undefined {
  const lines = decode(map.mappings);

  for (let index = Math.min(line, lines.length) - 1; index >= 0; index--) {
    const segments = lines[index] ?? [];
    for (let at = segments.length - 1; at >= 0; at--) {
      const segment = segments[at];
      if (!segment || segment.length < 4) continue;
      if (index === line - 1 && segment[0] > column) continue;
      return { line: (segment[2] ?? 0) + 1, column: (segment[3] ?? 0) + 1 };
    }
  }

  return undefined;
}
