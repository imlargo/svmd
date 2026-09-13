// Token types this extension contributes, declared the way upstream does.
import type {Extension, Point, TokenType} from 'micromark-util-types'
import type {Options} from './lib/options.js'

/**
 * Create an extension for `micromark` to enable Svelte syntax.
 *
 * Declared here rather than re-exported from the JavaScript: this package's
 * type surface is hand-written, the way upstream writes its own, so that it
 * says what the package promises rather than whatever JSDoc happens to infer.
 */
export declare function svelteSyntax(options?: Options | null | undefined): Extension

// Declared here for the same reason as `svelteSyntax` above: re-exporting from
// `./lib/tag-token-types.js` finds no declaration beside it — they are emitted
// into `types/` — and silently resolves to `any`.
export declare const flowTagTokenTypes: TagTokenTypes
export declare const textTagTokenTypes: TagTokenTypes

/** The token types one tag factory emits, named by role rather than by context. */
export type TagTokenTypes = {
  tag: TokenType
  tagMarker: TokenType
  tagClosingMarker: TokenType
  tagSelfClosingMarker: TokenType
  tagName: TokenType
  tagNamePrimary: TokenType
  tagNameMemberMarker: TokenType
  tagNameMember: TokenType
  tagNamePrefixMarker: TokenType
  tagNameLocal: TokenType
  tagExpressionAttribute: TokenType
  tagExpressionAttributeMarker: TokenType
  tagExpressionAttributeValue: TokenType
  tagAttribute: TokenType
  tagAttributeName: TokenType
  tagAttributeNamePrimary: TokenType
  tagAttributeNamePrefixMarker: TokenType
  tagAttributeNameLocal: TokenType
  tagAttributeInitializerMarker: TokenType
  tagAttributeValueLiteral: TokenType
  tagAttributeValueLiteralMarker: TokenType
  tagAttributeValueLiteralValue: TokenType
  tagAttributeValueExpression: TokenType
  tagAttributeValueExpressionMarker: TokenType
  tagAttributeValueExpressionValue: TokenType
  /** Body of an element that holds its content: a raw-text element, or any component. */
  raw: TokenType | undefined
}

/** Filled in by `factoryTag` as it reads. */
export type TagInfo = {
  name: string
  close: boolean
  selfClosing: boolean
  /** Whether this was a raw-text element, whose body the factory consumed too. */
  raw: boolean
  /** Where the raw body starts, if any. */
  rawStart: Point | undefined
  /** Where the raw body ends, if any. */
  rawEnd: Point | undefined
}

export type {Options}

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    esWhitespace: "esWhitespace";
    svelteBlockFlow: "svelteBlockFlow";
    svelteBlockFlowChunk: "svelteBlockFlowChunk";
    svelteBlockFlowMarker: "svelteBlockFlowMarker";
    svelteBlockFlowName: "svelteBlockFlowName";
    svelteBlockText: "svelteBlockText";
    svelteBlockTextChunk: "svelteBlockTextChunk";
    svelteBlockTextMarker: "svelteBlockTextMarker";
    svelteBlockTextName: "svelteBlockTextName";
    svelteCommentFlow: "svelteCommentFlow";
    svelteCommentFlowChunk: "svelteCommentFlowChunk";
    svelteCommentText: "svelteCommentText";
    svelteCommentTextChunk: "svelteCommentTextChunk";
    svelteExpressionFlow: "svelteExpressionFlow";
    svelteExpressionFlowChunk: "svelteExpressionFlowChunk";
    svelteExpressionFlowMarker: "svelteExpressionFlowMarker";
    svelteExpressionText: "svelteExpressionText";
    svelteExpressionTextChunk: "svelteExpressionTextChunk";
    svelteExpressionTextMarker: "svelteExpressionTextMarker";
    svelteTagFlow: "svelteTagFlow";
    svelteTagFlowAttribute: "svelteTagFlowAttribute";
    svelteTagFlowAttributeInitializerMarker: "svelteTagFlowAttributeInitializerMarker";
    svelteTagFlowAttributeName: "svelteTagFlowAttributeName";
    svelteTagFlowAttributeNameLocal: "svelteTagFlowAttributeNameLocal";
    svelteTagFlowAttributeNamePrefixMarker: "svelteTagFlowAttributeNamePrefixMarker";
    svelteTagFlowAttributeNamePrimary: "svelteTagFlowAttributeNamePrimary";
    svelteTagFlowAttributeValueExpression: "svelteTagFlowAttributeValueExpression";
    svelteTagFlowAttributeValueExpressionMarker: "svelteTagFlowAttributeValueExpressionMarker";
    svelteTagFlowAttributeValueExpressionValue: "svelteTagFlowAttributeValueExpressionValue";
    svelteTagFlowAttributeValueLiteral: "svelteTagFlowAttributeValueLiteral";
    svelteTagFlowAttributeValueLiteralMarker: "svelteTagFlowAttributeValueLiteralMarker";
    svelteTagFlowAttributeValueLiteralValue: "svelteTagFlowAttributeValueLiteralValue";
    svelteTagFlowClosingMarker: "svelteTagFlowClosingMarker";
    svelteTagFlowExpressionAttribute: "svelteTagFlowExpressionAttribute";
    svelteTagFlowExpressionAttributeMarker: "svelteTagFlowExpressionAttributeMarker";
    svelteTagFlowExpressionAttributeValue: "svelteTagFlowExpressionAttributeValue";
    svelteTagFlowMarker: "svelteTagFlowMarker";
    svelteTagFlowName: "svelteTagFlowName";
    svelteTagFlowNameLocal: "svelteTagFlowNameLocal";
    svelteTagFlowNameMember: "svelteTagFlowNameMember";
    svelteTagFlowNameMemberMarker: "svelteTagFlowNameMemberMarker";
    svelteTagFlowNamePrefixMarker: "svelteTagFlowNamePrefixMarker";
    svelteTagFlowNamePrimary: "svelteTagFlowNamePrimary";
    svelteTagFlowRaw: "svelteTagFlowRaw";
    svelteTagFlowSelfClosingMarker: "svelteTagFlowSelfClosingMarker";
    svelteTagText: "svelteTagText";
    svelteTagTextAttribute: "svelteTagTextAttribute";
    svelteTagTextAttributeInitializerMarker: "svelteTagTextAttributeInitializerMarker";
    svelteTagTextAttributeName: "svelteTagTextAttributeName";
    svelteTagTextAttributeNameLocal: "svelteTagTextAttributeNameLocal";
    svelteTagTextAttributeNamePrefixMarker: "svelteTagTextAttributeNamePrefixMarker";
    svelteTagTextAttributeNamePrimary: "svelteTagTextAttributeNamePrimary";
    svelteTagTextAttributeValueExpression: "svelteTagTextAttributeValueExpression";
    svelteTagTextAttributeValueExpressionMarker: "svelteTagTextAttributeValueExpressionMarker";
    svelteTagTextAttributeValueExpressionValue: "svelteTagTextAttributeValueExpressionValue";
    svelteTagTextAttributeValueLiteral: "svelteTagTextAttributeValueLiteral";
    svelteTagTextAttributeValueLiteralMarker: "svelteTagTextAttributeValueLiteralMarker";
    svelteTagTextAttributeValueLiteralValue: "svelteTagTextAttributeValueLiteralValue";
    svelteTagTextClosingMarker: "svelteTagTextClosingMarker";
    svelteTagTextExpressionAttribute: "svelteTagTextExpressionAttribute";
    svelteTagTextExpressionAttributeMarker: "svelteTagTextExpressionAttributeMarker";
    svelteTagTextExpressionAttributeValue: "svelteTagTextExpressionAttributeValue";
    svelteTagTextMarker: "svelteTagTextMarker";
    svelteTagTextName: "svelteTagTextName";
    svelteTagTextNameLocal: "svelteTagTextNameLocal";
    svelteTagTextNameMember: "svelteTagTextNameMember";
    svelteTagTextNameMemberMarker: "svelteTagTextNameMemberMarker";
    svelteTagTextNamePrefixMarker: "svelteTagTextNamePrefixMarker";
    svelteTagTextNamePrimary: "svelteTagTextNamePrimary";
    svelteTagTextRaw: "svelteTagTextRaw";
    svelteTagTextSelfClosingMarker: "svelteTagTextSelfClosingMarker";
  }
}
