// The public type surface, hand-written, the way upstream writes its own.
//
// Not re-exported from `./lib/*.js`: the declarations generated for that
// JavaScript are emitted into `types/`, which is unreachable from here, so a
// re-export resolves to `any` and every call into this package goes unchecked.
// Nor emitted beside the JavaScript, which would shadow it and turn `checkJs`
// into a no-op. Written here, both failure modes are gone and the file says
// what the package promises rather than whatever JSDoc happens to infer.
import type {Extension} from 'mdast-util-from-markdown'
import type {Root} from 'mdast'

/** Configuration. */
export type Options = {
  /**
   * Names to treat as block-level on top of the HTML ones, for components that
   * render a block — shadcn's `Card`, say. See `unwrapBlockElements`.
   */
  blockElements?: ReadonlyArray<string> | null | undefined
}

/** Create an extension for `mdast-util-from-markdown` to enable Svelte syntax. */
export declare function svelteFromMarkdown(
  options?: Options | null | undefined
): Extension

/** Keep block-level elements out of the paragraph markdown wrapped them in. */
export declare function unwrapBlockElements(
  tree: Root,
  blockElements?: ReadonlyArray<string> | null | undefined
): Root

export type * from './lib/nodes.js'
import './lib/nodes.js'
