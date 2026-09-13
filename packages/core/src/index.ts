export {
  compile,
  createCompiler,
  type Compiler,
  type CompileOptions,
  type CompileResult,
} from './compile.js';
export { SvmdError, codeFrame, type SvmdPoint, type SvmdWarning } from './diagnostics/errors.js';
export type { FrontmatterOptions } from './parse/frontmatter.js';
export type { Highlighter, HighlightInput } from './transform/highlight.js';
export type { EncodedSourceMap } from './internal/source-builder.js';
export type { StandardSchemaV1 } from '@standard-schema/spec';
