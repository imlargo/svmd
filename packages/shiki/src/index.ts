import type { Highlighter } from '@svmd/core';

export interface ShikiOptions {
  /** Single theme name, e.g. `github-dark`. */
  theme?: string | undefined;
  /** Multiple themes for CSS-variable based light/dark switching. */
  themes?: Record<string, string> | undefined;
  /** Languages to preload. Defaults to the ones actually used. */
  langs?: string[] | undefined;
  /** Shiki transformers, passed through untouched. */
  transformers?: unknown[] | undefined;
  /** Language to fall back to when the info string names an unknown one. */
  fallbackLang?: string | undefined;
}

interface ShikiModule {
  createHighlighter(config: Record<string, unknown>): Promise<{
    codeToHtml(code: string, options: Record<string, unknown>): string;
    getLoadedLanguages(): string[];
    loadLanguage(lang: string): Promise<void>;
  }>;
}

/**
 * Syntax highlighting with Shiki.
 *
 * Opt-in rather than on by default: Shiki carries every TextMate grammar it
 * supports, and a project that already uses `rehype-pretty-code`, Prism or its
 * own CSS should not pay for it (§I12). Install `shiki` alongside `svmd` to use
 * this.
 *
 * ```js
 * svmd({ highlight: await shikiHighlighter({ theme: 'github-dark' }) })
 * ```
 */
export async function shikiHighlighter(options: ShikiOptions = {}): Promise<Highlighter> {
  // Indirection through a variable keeps this compiling when the optional peer
  // dependency is absent.
  const specifier = 'shiki';
  let shiki: ShikiModule;

  try {
    shiki = (await import(specifier)) as ShikiModule;
  } catch (cause) {
    throw new Error(
      '`shikiHighlighter()` needs the optional peer dependency `shiki`. Install it, ' +
        'or set `highlight: false` and style code blocks yourself.',
      { cause },
    );
  }

  const themes = options.themes ?? { light: options.theme ?? 'github-light' };
  const highlighter = await shiki.createHighlighter({
    themes: Object.values(themes),
    langs: options.langs ?? ['js', 'ts', 'svelte', 'html', 'css', 'json', 'bash', 'md'],
  });

  const single = options.themes === undefined;
  const fallback = options.fallbackLang ?? 'text';

  return async ({ value, lang }) => {
    const language = await resolveLanguage(highlighter, lang, fallback);

    return highlighter.codeToHtml(value, {
      lang: language,
      ...(single ? { theme: Object.values(themes)[0] } : { themes }),
      ...(options.transformers ? { transformers: options.transformers } : {}),
    });
  };
}

async function resolveLanguage(
  highlighter: Awaited<ReturnType<ShikiModule['createHighlighter']>>,
  lang: string | null,
  fallback: string,
): Promise<string> {
  if (!lang) return fallback;
  if (highlighter.getLoadedLanguages().includes(lang)) return lang;

  try {
    await highlighter.loadLanguage(lang);
    return lang;
  } catch {
    return fallback;
  }
}
