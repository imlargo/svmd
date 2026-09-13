import type {
  SvelteAttributeLike,
  SvelteAttributeValuePart,
  SvelteScript,
  SvelteStyle,
} from '@svmd/mdast-util-svelte';
import MagicString from 'magic-string';
import { stringifyAttribute } from '../attributes.js';
import { SvmdError, type SvmdPoint } from '../../diagnostics/errors.js';
import { analyzeScript, type DeclarationSite } from './analyze.js';

export interface MergedBlock {
  /** Attributes to put on the generated tag, already stringified. */
  attributes: string;
  /** Body text. */
  value: string;
  /** Where the body starts in the markdown, for source maps. */
  origin: SvmdPoint;
}

export interface MergeResult {
  module: MergedBlock | null;
  instance: MergedBlock | null;
  style: MergedBlock | null;
  /** Every top-level name the user's scripts bind, in either scope. */
  declared: Set<string>;
}

export interface MergeContext {
  filename: string | undefined;
  source: string;
}

/** Read a plain text attribute value, e.g. `lang="ts"`. */
function textAttribute(attributes: SvelteAttributeLike[], name: string): string | null {
  for (const attribute of attributes) {
    if (attribute.type !== 'svelteAttribute' || attribute.name !== name) continue;
    if (attribute.value === null) return '';
    return attribute.value
      .map((part: SvelteAttributeValuePart) => (part.type === 'text' ? part.value : ''))
      .join('');
  }
  return null;
}

function hasAttribute(attributes: SvelteAttributeLike[], name: string): boolean {
  return attributes.some(
    (attribute) => attribute.type === 'svelteAttribute' && attribute.name === name,
  );
}

/** Svelte 5 spells it `<script module>`; `context="module"` is the old form. */
function isModuleScript(node: SvelteScript): boolean {
  return (
    hasAttribute(node.attributes, 'module') ||
    textAttribute(node.attributes, 'context') === 'module'
  );
}

/**
 * Combine the user's `<script>` and `<style>` blocks.
 *
 * Bodies are spliced, never regenerated, so TypeScript, decorators and anything
 * else the Svelte toolchain understands survives untouched. The only edits made
 * are deletions of imports that a later block repeats verbatim.
 */
export function mergeScripts(
  scripts: SvelteScript[],
  styles: SvelteStyle[],
  context: MergeContext,
): MergeResult {
  const moduleScripts = scripts.filter(isModuleScript);
  const instanceScripts = scripts.filter((node) => !isModuleScript(node));
  const declared = new Set<string>();

  // Svelte flattens both scopes into one module, so duplicate imports and
  // duplicate declarations have to be tracked across them, not per scope.
  const seen: SeenState = { imports: new Map(), names: new Map() };

  const module = combineScripts(moduleScripts, declared, seen, context);
  const instance = combineScripts(instanceScripts, declared, seen, context);
  const style = combineStyles(styles, context);

  return { module, instance, style, declared };
}

interface SeenState {
  imports: Map<string, SvmdPoint>;
  names: Map<string, SvmdPoint>;
}

/**
 * Turn a position inside a script body into one in the document.
 *
 * The body starts wherever the opening tag ended, so its first line is offset
 * by that column and every later line is not.
 */
function documentPoint(blockStart: SvmdPoint, site: DeclarationSite): SvmdPoint {
  return site.line === 1
    ? { line: blockStart.line, column: blockStart.column + site.column - 1 }
    : { line: blockStart.line + site.line - 1, column: site.column };
}

function combineScripts(
  nodes: SvelteScript[],
  declared: Set<string>,
  seen: SeenState,
  context: MergeContext,
): MergedBlock | null {
  if (nodes.length === 0) return null;

  const seenImports = seen.imports;
  const seenNames = seen.names;
  const bodies: string[] = [];

  for (const node of nodes) {
    const analysis = analyzeScript(node.value);
    const edited = new MagicString(node.value);
    const start = node.valueStart;

    for (const info of analysis.imports) {
      if (seenImports.has(info.key)) {
        edited.remove(info.start, info.end);
        // The names are already bound; do not report them as duplicates.
        for (const local of info.locals) analysis.declared.delete(local);
      } else {
        seenImports.set(info.key, start);
      }
    }

    for (const [name, site] of analysis.declared) {
      const at = documentPoint(start, site);
      const previous = seenNames.get(name);

      if (previous) {
        // Svelte flattens both scopes into one module, so this is a
        // duplicate declaration however far apart the blocks are.
        throw new SvmdError({
          code: 'E008',
          message: `\`${name}\` is declared twice: at line ${previous.line} and again here`,
          hint:
            'A component has one script, however many blocks it is written in. ' +
            'Rename one of them, or delete the one that is redundant.',
          filename: context.filename,
          source: context.source,
          start: at,
        });
      }

      seenNames.set(name, at);
      declared.add(name);
    }

    bodies.push(edited.toString());
  }

  // Every attribute the author wrote is kept, not just the ones this compiler
  // understands. Svelte warns about one it does not know; dropping it here
  // would just make it vanish.
  const attributes = collectAttributes(nodes, nodes.some(isModuleScript) ? ['module'] : []);

  const [first] = nodes;
  if (!first) return null;
  return {
    attributes,
    value: bodies.join('\n'),
    origin: first.valueStart,
  };
}

/**
 * The attributes of every merged block, deduplicated by name.
 *
 * @param forced
 *   Names to emit even when no block carried them, because the merge decided
 *   them: `module` on the module script, `global` on the stylesheet.
 */
function collectAttributes(nodes: (SvelteScript | SvelteStyle)[], forced: string[]): string {
  const seen = new Map<string, string>();

  for (const name of forced) seen.set(name, name);

  for (const node of nodes) {
    for (const attribute of node.attributes) {
      const name = attribute.type === 'svelteSpreadAttribute' ? '...' : attribute.name;
      // `context="module"` is the old spelling of `module`; emitting both
      // would be a duplicate attribute.
      if (name === 'context' && seen.has('module')) continue;
      seen.set(name, stringifyAttribute(attribute));
    }
  }

  return [...seen.values()].map((value) => ' ' + value).join('');
}

function combineStyles(nodes: SvelteStyle[], context: MergeContext): MergedBlock | null {
  const [head] = nodes;
  if (!head) return null;

  let lang: string | null = null;
  let global = false;

  for (const node of nodes) {
    const nodeLang = textAttribute(node.attributes, 'lang');
    if (nodeLang && lang && nodeLang !== lang) {
      throw new SvmdError({
        code: 'E009',
        message: 'Conflicting <style> languages: `' + lang + '` and `' + nodeLang + '`',
        hint: 'A component compiles to a single stylesheet, so all <style> blocks must agree.',
        filename: context.filename,
        source: context.source,
        start: node.valueStart,
      });
    }
    if (nodeLang) lang = nodeLang;
    if (hasAttribute(node.attributes, 'global')) global = true;
  }

  return {
    attributes: collectAttributes(nodes, global ? ['global'] : []),
    value: nodes.map((node) => node.value).join('\n'),
    origin: head.valueStart,
  };
}
