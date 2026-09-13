import type {Acorn, AcornOptions} from 'micromark-util-events-to-acorn'

/**
 * Configuration for the Svelte syntax extension.
 *
 * Hand-written rather than derived from JSDoc: this is the package's public
 * surface, and a declaration emitted beside its own source would shadow it.
 */
export interface Options {
  /**
   * Parser used to tell an interpolation apart from prose (default: the
   * bundled acorn). Anything with an acorn 8 compatible `parseExpressionAt`
   * works; pass acorn extended with `acorn-typescript` to accept
   * TypeScript-only syntax inside expressions.
   */
  acorn?: Acorn | null | undefined
  /** Configuration for acorn. */
  acornOptions?: AcornOptions | null | undefined
  /**
   * Components whose content is handed to Svelte untouched rather than parsed
   * as markdown.
   */
  rawComponents?: ReadonlyArray<string> | null | undefined
}
