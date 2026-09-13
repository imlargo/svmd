/**
 * Token types for the tag factory.
 *
 * Upstream passes these as twenty-five positional parameters, once per context.
 * Collecting them into an object is the only structural change made to
 * `factoryTag`, and it is what makes room for the types Svelte needs that JSX
 * has none of.
 *
 * @import {Point, TokenType} from 'micromark-util-types'
 */

/**
 * @typedef TagTokenTypes
 * @property {TokenType} tag
 * @property {TokenType} tagMarker
 * @property {TokenType} tagClosingMarker
 * @property {TokenType} tagSelfClosingMarker
 * @property {TokenType} tagName
 * @property {TokenType} tagNamePrimary
 * @property {TokenType} tagNameMemberMarker
 * @property {TokenType} tagNameMember
 * @property {TokenType} tagNamePrefixMarker
 * @property {TokenType} tagNameLocal
 * @property {TokenType} tagExpressionAttribute
 * @property {TokenType} tagExpressionAttributeMarker
 * @property {TokenType} tagExpressionAttributeValue
 * @property {TokenType} tagAttribute
 * @property {TokenType} tagAttributeName
 * @property {TokenType} tagAttributeNamePrimary
 * @property {TokenType} tagAttributeNamePrefixMarker
 * @property {TokenType} tagAttributeNameLocal
 * @property {TokenType} tagAttributeInitializerMarker
 * @property {TokenType} tagAttributeValueLiteral
 * @property {TokenType} tagAttributeValueLiteralMarker
 * @property {TokenType} tagAttributeValueLiteralValue
 * @property {TokenType} tagAttributeValueExpression
 * @property {TokenType} tagAttributeValueExpressionMarker
 * @property {TokenType} tagAttributeValueExpressionValue
 * @property {TokenType | undefined} raw
 *   Body of an element that holds its content: a raw-text element, or any
 *   component.
 */

/**
 * @typedef TagInfo
 *   Filled in by `factoryTag` as it reads.
 * @property {string} name
 * @property {boolean} close
 * @property {boolean} selfClosing
 * @property {boolean} raw
 *   Whether this was a raw-text element, whose body the factory consumed too.
 * @property {Point | undefined} rawStart
 *   Where the raw body starts, if any.
 * @property {Point | undefined} rawEnd
 *   Where the raw body ends, if any.
 */

/** @type {TagTokenTypes} */
export const flowTagTokenTypes = {
  tag: 'svelteTagFlow',
  tagMarker: 'svelteTagFlowMarker',
  tagClosingMarker: 'svelteTagFlowClosingMarker',
  tagSelfClosingMarker: 'svelteTagFlowSelfClosingMarker',
  tagName: 'svelteTagFlowName',
  tagNamePrimary: 'svelteTagFlowNamePrimary',
  tagNameMemberMarker: 'svelteTagFlowNameMemberMarker',
  tagNameMember: 'svelteTagFlowNameMember',
  tagNamePrefixMarker: 'svelteTagFlowNamePrefixMarker',
  tagNameLocal: 'svelteTagFlowNameLocal',
  tagExpressionAttribute: 'svelteTagFlowExpressionAttribute',
  tagExpressionAttributeMarker: 'svelteTagFlowExpressionAttributeMarker',
  tagExpressionAttributeValue: 'svelteTagFlowExpressionAttributeValue',
  tagAttribute: 'svelteTagFlowAttribute',
  tagAttributeName: 'svelteTagFlowAttributeName',
  tagAttributeNamePrimary: 'svelteTagFlowAttributeNamePrimary',
  tagAttributeNamePrefixMarker: 'svelteTagFlowAttributeNamePrefixMarker',
  tagAttributeNameLocal: 'svelteTagFlowAttributeNameLocal',
  tagAttributeInitializerMarker: 'svelteTagFlowAttributeInitializerMarker',
  tagAttributeValueLiteral: 'svelteTagFlowAttributeValueLiteral',
  tagAttributeValueLiteralMarker: 'svelteTagFlowAttributeValueLiteralMarker',
  tagAttributeValueLiteralValue: 'svelteTagFlowAttributeValueLiteralValue',
  tagAttributeValueExpression: 'svelteTagFlowAttributeValueExpression',
  tagAttributeValueExpressionMarker: 'svelteTagFlowAttributeValueExpressionMarker',
  tagAttributeValueExpressionValue: 'svelteTagFlowAttributeValueExpressionValue',
  raw: 'svelteTagFlowRaw'
}

/** @type {TagTokenTypes} */
export const textTagTokenTypes = {
  tag: 'svelteTagText',
  tagMarker: 'svelteTagTextMarker',
  tagClosingMarker: 'svelteTagTextClosingMarker',
  tagSelfClosingMarker: 'svelteTagTextSelfClosingMarker',
  tagName: 'svelteTagTextName',
  tagNamePrimary: 'svelteTagTextNamePrimary',
  tagNameMemberMarker: 'svelteTagTextNameMemberMarker',
  tagNameMember: 'svelteTagTextNameMember',
  tagNamePrefixMarker: 'svelteTagTextNamePrefixMarker',
  tagNameLocal: 'svelteTagTextNameLocal',
  tagExpressionAttribute: 'svelteTagTextExpressionAttribute',
  tagExpressionAttributeMarker: 'svelteTagTextExpressionAttributeMarker',
  tagExpressionAttributeValue: 'svelteTagTextExpressionAttributeValue',
  tagAttribute: 'svelteTagTextAttribute',
  tagAttributeName: 'svelteTagTextAttributeName',
  tagAttributeNamePrimary: 'svelteTagTextAttributeNamePrimary',
  tagAttributeNamePrefixMarker: 'svelteTagTextAttributeNamePrefixMarker',
  tagAttributeNameLocal: 'svelteTagTextAttributeNameLocal',
  tagAttributeInitializerMarker: 'svelteTagTextAttributeInitializerMarker',
  tagAttributeValueLiteral: 'svelteTagTextAttributeValueLiteral',
  tagAttributeValueLiteralMarker: 'svelteTagTextAttributeValueLiteralMarker',
  tagAttributeValueLiteralValue: 'svelteTagTextAttributeValueLiteralValue',
  tagAttributeValueExpression: 'svelteTagTextAttributeValueExpression',
  tagAttributeValueExpressionMarker: 'svelteTagTextAttributeValueExpressionMarker',
  tagAttributeValueExpressionValue: 'svelteTagTextAttributeValueExpressionValue',
  raw: 'svelteTagTextRaw'
}
