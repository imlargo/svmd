import { Parser, type Options as AcornOptions } from 'acorn';
import { tsPlugin } from 'acorn-typescript';
import type { Node as EstreeNode, Program } from 'estree';

const TypeScriptParser = Parser.extend(tsPlugin() as never);

const PARSE_OPTIONS: AcornOptions = {
  ecmaVersion: 'latest',
  sourceType: 'module',
  locations: true,
  allowAwaitOutsideFunction: true,
  allowHashBang: true,
};

export interface ImportInfo {
  /** Byte range of the whole statement, for removal. */
  start: number;
  end: number;
  /** Stable key: two imports with the same key bind the same things. */
  key: string;
  /** Names this statement binds. */
  locals: string[];
}

/** Where a name was declared, in the script body's own coordinates. */
export interface DeclarationSite {
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
}

export interface ScriptAnalysis {
  /** `false` when the source could not be parsed; features degrade, nothing fails. */
  parsed: boolean;
  /**
   * Names declared at the top level, including imports and type declarations,
   * each with where it was declared — so a clash can be reported at the
   * declaration rather than at the top of the block holding it.
   */
  declared: Map<string, DeclarationSite>;
  imports: ImportInfo[];
}

/**
 * Read a `<script>` body without rewriting it.
 *
 * The analysis exists to answer two questions — what does this block declare,
 * and which imports does it repeat — so that merging can be done by splicing
 * the original text. Regenerating code from the AST would be simpler but would
 * throw away TypeScript, which F11 requires (§I7).
 *
 * Parsing is best effort: a block using syntax this parser does not know yet is
 * emitted verbatim rather than failing the build.
 */
export function analyzeScript(source: string): ScriptAnalysis {
  const analysis: ScriptAnalysis = { parsed: false, declared: new Map(), imports: [] };

  let program: Program;
  try {
    program = TypeScriptParser.parse(source, PARSE_OPTIONS) as unknown as Program;
  } catch {
    return analysis;
  }

  analysis.parsed = true;

  for (const node of program.body) {
    collect(node, analysis);
  }

  return analysis;
}

type Ranged = EstreeNode & { start?: number; end?: number };

function collect(node: Ranged, analysis: ScriptAnalysis): void {
  switch (node.type) {
    case 'ImportDeclaration': {
      const locals: string[] = [];
      const parts: string[] = [];
      for (const specifier of node.specifiers) {
        locals.push(specifier.local.name);
        if (specifier.type === 'ImportDefaultSpecifier') {
          parts.push('default>' + specifier.local.name);
        } else if (specifier.type === 'ImportNamespaceSpecifier') {
          parts.push('*>' + specifier.local.name);
        } else {
          const imported =
            specifier.imported.type === 'Identifier'
              ? specifier.imported.name
              : String(specifier.imported.value);
          parts.push(imported + '>' + specifier.local.name);
        }
      }
      for (const specifier of node.specifiers) {
        declare(analysis, specifier.local, specifier.local.name);
      }
      analysis.imports.push({
        start: node.start ?? 0,
        end: node.end ?? 0,
        key: String(node.source.value) + '|' + parts.sort().join(','),
        locals,
      });
      return;
    }

    case 'VariableDeclaration':
      for (const declarator of node.declarations) {
        patternNames(declarator.id, analysis);
      }
      return;

    case 'FunctionDeclaration':
    case 'ClassDeclaration':
      declare(analysis, node.id, node.id.name);
      return;

    case 'ExportNamedDeclaration':
      if (node.declaration) collect(node.declaration, analysis);
      return;

    case 'ExportDefaultDeclaration':
      return;

    default: {
      // TypeScript-only declarations acorn-typescript produces.
      const typed = node as { type: string; id?: { name?: string } };
      if (
        typed.type === 'TSInterfaceDeclaration' ||
        typed.type === 'TSTypeAliasDeclaration' ||
        typed.type === 'TSEnumDeclaration' ||
        typed.type === 'TSModuleDeclaration'
      ) {
        if (typed.id?.name) declare(analysis, node, typed.id.name);
      }
    }
  }
}

/**
 * Record a name, keeping the first place it was seen.
 *
 * acorn is configured with `locations`, so the site is exact; a node without
 * one can only come from a plugin that skipped it, and the block's own start is
 * a reasonable fallback.
 */
function declare(analysis: ScriptAnalysis, node: EstreeNode, name: string): void {
  if (analysis.declared.has(name)) return;

  const loc = node.loc?.start;
  analysis.declared.set(name, {
    line: loc ? loc.line : 1,
    column: loc ? loc.column + 1 : 1,
  });
}

function patternNames(pattern: EstreeNode, analysis: ScriptAnalysis): void {
  switch (pattern.type) {
    case 'Identifier':
      declare(analysis, pattern, pattern.name);
      return;
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        patternNames(
          property.type === 'RestElement' ? property.argument : property.value,
          analysis,
        );
      }
      return;
    case 'ArrayPattern':
      for (const element of pattern.elements) {
        if (element) patternNames(element, analysis);
      }
      return;
    case 'AssignmentPattern':
      patternNames(pattern.left, analysis);
      return;
    case 'RestElement':
      patternNames(pattern.argument, analysis);
      return;
    default:
      return;
  }
}
