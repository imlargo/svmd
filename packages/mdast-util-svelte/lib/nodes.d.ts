/**
 * mdast nodes for Svelte syntax.
 *
 * Where MDX has `mdxJsxFlowElement` and `mdxFlowExpression`, this has the
 * Svelte equivalents plus two things JSX has no shape for: control blocks with
 * their branches, and the raw `<script>` / `<style>` blocks the compiler hoists
 * out of the markup.
 */
import type {Literal, Node, Parent, PhrasingContent, BlockContent, DefinitionContent} from 'mdast'
import type {Point as MicromarkPoint} from 'micromark-util-types'

// Pulls in the token types the grammar declares, so the handlers below can be
// checked against them.
import '@svmd/micromark-extension-svelte'

export type SvelteFlowContent = BlockContent | DefinitionContent

/** A literal run of characters inside an attribute value. */
export interface SvelteAttributeText {
  type: 'text'
  value: string
}

/** An `{expression}` embedded in an attribute value. */
export interface SvelteAttributeExpression {
  type: 'expression'
  value: string
}

export type SvelteAttributeValuePart = SvelteAttributeText | SvelteAttributeExpression

export interface SvelteAttribute extends Node {
  type: 'svelteAttribute'
  /**
   * Verbatim name, directive and modifiers included: `class`, `bind:value`,
   * `transition:fade|local`, `--accent`.
   */
  name: string
  /** Quote the author used, or `null` when unquoted or absent. */
  quote: '"' | "'" | null
  /** `null` for a boolean attribute. */
  value: SvelteAttributeValuePart[] | null
  /** True for `{value}`, which is sugar for `value={value}`. */
  shorthand: boolean
}

export interface SvelteSpreadAttribute extends Node {
  type: 'svelteSpreadAttribute'
  /** Expression source without the leading `...`. */
  value: string
}

export type SvelteAttributeLike = SvelteAttribute | SvelteSpreadAttribute

/** `{expression}` occupying a block of its own. */
export interface SvelteFlowExpression extends Literal {
  type: 'svelteFlowExpression'
}

/** `{expression}` inside a paragraph, heading, list item or table cell. */
export interface SvelteTextExpression extends Literal {
  type: 'svelteTextExpression'
}

/** `{@html …}`, `{@const …}`, `{@render …}`, `{@debug …}`, `{@attach …}`. */
export interface SvelteFlowTag extends Literal {
  type: 'svelteFlowTag'
  name: string
}

export interface SvelteTextTag extends Literal {
  type: 'svelteTextTag'
  name: string
}

/**
 * A control block and all of its branches.
 *
 * `{#if a}X{:else}Y{/if}` is one `svelteBlock` named `if` holding two
 * `svelteBranch` children. Representing every block as a uniform list of
 * branches gives the generator a single code path for `if`, `each`, `await`,
 * `key` and `snippet`.
 */
export interface SvelteBlock extends Parent {
  type: 'svelteBlock'
  name: string
  children: SvelteBranch[]
}

export interface SvelteBranch extends Parent {
  type: 'svelteBranch'
  /** Verbatim opener, e.g. `#if`, `:else`, `:then`. */
  marker: string
  /** Everything between the opener and the closing brace, trimmed. */
  value: string
  children: SvelteFlowContent[]
}

export interface SvelteFlowElement extends Parent {
  type: 'svelteFlowElement'
  /** `div`, `Callout`, `Foo.Bar`, `svelte:head`. */
  name: string
  attributes: SvelteAttributeLike[]
  /** Written as `<Name />`. Kept so the generator can round-trip it. */
  selfClosing: boolean
  children: SvelteFlowContent[]
}

export interface SvelteTextElement extends Parent {
  type: 'svelteTextElement'
  name: string
  attributes: SvelteAttributeLike[]
  selfClosing: boolean
  children: PhrasingContent[]
}

/** Where a raw body starts in the source, for source maps. */
export interface SveltePoint {
  line: number
  column: number
  offset: number
}

/** A `<script>` block. Hoisted out of the markup by the compiler. */
export interface SvelteScript extends Literal {
  type: 'svelteScript'
  attributes: SvelteAttributeLike[]
  valueStart: SveltePoint
}

/** A `<style>` block. Hoisted out of the markup by the compiler. */
export interface SvelteStyle extends Literal {
  type: 'svelteStyle'
  attributes: SvelteAttributeLike[]
  valueStart: SveltePoint
}

export interface SvelteComment extends Literal {
  type: 'svelteComment'
}

/**
 * Content handed to Svelte untouched.
 *
 * The only node whose braces are not escaped on the way out: an author who
 * opted a component out of markdown is writing Svelte inside it, and
 * neutralising their expressions would be the opposite of what they asked for.
 */
export interface SvelteRaw extends Literal {
  type: 'svelteRaw'
}

declare module 'mdast' {
  interface BlockContentMap {
    svelteRaw: SvelteRaw
    svelteBlock: SvelteBlock
    svelteComment: SvelteComment
    svelteFlowElement: SvelteFlowElement
    svelteFlowExpression: SvelteFlowExpression
    svelteFlowTag: SvelteFlowTag
    svelteScript: SvelteScript
    svelteStyle: SvelteStyle
  }

  interface PhrasingContentMap {
    svelteRaw: SvelteRaw
    svelteTextElement: SvelteTextElement
    svelteTextExpression: SvelteTextExpression
    svelteTextTag: SvelteTextTag
  }

  interface RootContentMap {
    svelteRaw: SvelteRaw
    svelteBlock: SvelteBlock
    svelteBranch: SvelteBranch
    svelteComment: SvelteComment
    svelteFlowElement: SvelteFlowElement
    svelteFlowExpression: SvelteFlowExpression
    svelteFlowTag: SvelteFlowTag
    svelteScript: SvelteScript
    svelteStyle: SvelteStyle
    svelteTextElement: SvelteTextElement
    svelteTextExpression: SvelteTextExpression
    svelteTextTag: SvelteTextTag
  }
}

/** A tag being read out of the event stream. */
export interface SvelteTagState {
  name: string
  attributes: SvelteAttributeLike[]
  close: boolean
  selfClosing: boolean
  start: SveltePoint
  end: SveltePoint
}

declare module 'mdast-util-from-markdown' {
  interface CompileData {
    svelteTag?: SvelteTagState
    svelteTagStack?: SvelteTagState[]
    svelteBlockMarker?: string
    svelteBlockName?: string
    svelteBlockStack?: Array<{name: string; start: SveltePoint}>
  }
}

declare module 'micromark-util-types' {
  interface Token {
    _svelteTag?: {
      name: string
      close: boolean
      selfClosing: boolean
      raw: boolean
      rawStart: MicromarkPoint | undefined
      rawEnd: MicromarkPoint | undefined
    }
  }
}
