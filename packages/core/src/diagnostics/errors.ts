/**
 * Diagnostics.
 *
 * Every error carries a position in the *markdown*, never in the generated
 * Svelte, plus a hint that says what to do about it (§NF8). The shape also
 * matches what Rollup and Vite already know how to print, so the message a user
 * sees in the terminal needs no extra formatting.
 */

export interface SvmdPoint {
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  offset?: number | undefined;
}

export interface SvmdErrorOptions {
  code: string;
  message: string;
  hint?: string | undefined;
  filename?: string | undefined;
  source?: string | undefined;
  start?: SvmdPoint | undefined;
  end?: SvmdPoint | undefined;
  cause?: unknown;
}

export class SvmdError extends Error {
  /** Catalogue code, e.g. `E001`. */
  readonly code: string;
  readonly hint: string | undefined;
  readonly filename: string | undefined;
  readonly start: SvmdPoint | undefined;
  readonly end: SvmdPoint | undefined;
  /** Rollup reads this to attribute the error to a file and position. */
  readonly loc: { file: string | undefined; line: number; column: number } | undefined;
  /** Rendered excerpt of the offending source. */
  readonly frame: string | undefined;

  constructor(options: SvmdErrorOptions) {
    const frame =
      options.source && options.start
        ? codeFrame(options.source, options.start, options.end)
        : undefined;

    super(formatMessage(options, frame), options.cause ? { cause: options.cause } : undefined);

    this.name = 'SvmdError';
    this.code = options.code;
    this.hint = options.hint;
    this.filename = options.filename;
    this.start = options.start;
    this.end = options.end;
    this.frame = frame;
    this.loc = options.start
      ? { file: options.filename, line: options.start.line, column: options.start.column }
      : undefined;
  }
}

function formatMessage(options: SvmdErrorOptions, frame: string | undefined): string {
  const where =
    options.filename && options.start
      ? `${options.filename}:${options.start.line}:${options.start.column}`
      : options.filename;

  let message = `[${options.code}] ${options.message}`;
  if (where) message += `\n  at ${where}`;
  if (frame) message += `\n\n${frame}`;
  if (options.hint) message += `\n\n  ${options.hint}`;
  return message;
}

/** Lines of context shown either side of the offending one. */
const GUTTER = 2;
/** Columns of the offending line to show before giving up and scrolling. */
const WIDTH = 96;
/** What a tab is worth, so the caret lands under the right character. */
const TAB = 4;

/**
 * Render the offending lines with a caret under the reported span.
 *
 * Two details do most of the work. Tabs are expanded, because a caret padded
 * with spaces under a line indented with tabs points at the wrong column — and
 * a diagnostic that points at the wrong column is worse than none. And a long
 * line is windowed around the caret rather than printed whole, because a
 * minified or generated line would otherwise push the caret off the terminal.
 */
export function codeFrame(source: string, start: SvmdPoint, end?: SvmdPoint): string {
  const lines = source.split('\n');

  // A file ending in a newline splits into a trailing empty string. Showing it
  // puts a phantom blank line under every error near the end of a file.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();

  const first = Math.max(1, start.line - GUTTER);
  const last = Math.min(lines.length, start.line + GUTTER);
  const width = String(last).length;

  // The caret's column, after tabs on the offending line are expanded.
  const offending = lines[start.line - 1] ?? '';
  const caretFrom = expandedWidth(offending.slice(0, Math.max(0, start.column - 1)));
  const caretTo =
    end?.line === start.line
      ? Math.max(caretFrom + 1, expandedWidth(offending.slice(0, Math.max(0, end.column - 1))))
      : caretFrom + 1;

  // Window long lines around the caret, keeping its position meaningful.
  const shift = caretFrom > WIDTH - 20 ? caretFrom - Math.floor(WIDTH / 2) : 0;
  const out: string[] = [];

  for (let line = first; line <= last; line++) {
    const text = window(expandTabs(lines[line - 1] ?? ''), shift);
    out.push(`${line === start.line ? '>' : ' '} ${String(line).padStart(width)} | ${text}`);

    if (line === start.line) {
      const from = caretFrom - shift + (shift > 0 ? 1 : 0);
      out.push(
        `  ${' '.repeat(width)} | ${' '.repeat(Math.max(0, from))}${'^'.repeat(caretTo - caretFrom)}`,
      );
    }
  }

  return out.join('\n');
}

/** Column a prefix ends at, counting a tab as reaching the next tab stop. */
function expandedWidth(prefix: string): number {
  let column = 0;

  for (const character of prefix) {
    column = character === '\t' ? column + TAB - (column % TAB) : column + 1;
  }

  return column;
}

function expandTabs(text: string): string {
  let out = '';

  for (const character of text) {
    out += character === '\t' ? ' '.repeat(TAB - (out.length % TAB)) : character;
  }

  return out;
}

/** Show at most `WIDTH` columns, marking either end that was cut. */
function window(text: string, shift: number): string {
  const head = shift > 0 ? '…' : '';
  const body = text.slice(shift, shift + WIDTH);
  const tail = text.length > shift + WIDTH ? '…' : '';
  return head + body + tail;
}

export interface SvmdWarning {
  /** Catalogue code, e.g. `W001`. */
  code: string;
  message: string;
  hint: string;
  filename: string | undefined;
  start: SvmdPoint | undefined;
  end: SvmdPoint | undefined;
  /** Rendered excerpt of the offending source. */
  frame: string | undefined;
}

export function createWarning(options: SvmdErrorOptions): SvmdWarning {
  return {
    code: options.code,
    message: options.message,
    hint: options.hint ?? '',
    filename: options.filename,
    start: options.start,
    end: options.end,
    frame:
      options.source && options.start
        ? codeFrame(options.source, options.start, options.end)
        : undefined,
  };
}
