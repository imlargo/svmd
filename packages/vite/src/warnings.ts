import { resolve } from 'node:path';
import { codeFrame, originalPosition, type EncodedSourceMap, type SvmdPoint } from '@svmd/core';
import type { Warning } from 'svelte/compiler';
import type { ResolvedConfig } from 'vite';

type Location = NonNullable<Warning['start']>;
type OnWarn = (warning: Warning, defaultHandler: (warning: Warning) => void) => void;

/** The part of vite-plugin-svelte's config plugin this reads. Not public API, so every step is optional. */
interface SvelteConfigPlugin {
  api?: { options?: { onwarn?: OnWarn | undefined } };
}

/**
 * Point Svelte's warnings for compiled markdown at the `.md`, not at the
 * generated component, before the user's `onwarn` or the default logger sees them.
 *
 * vite-plugin-svelte has no hook for this, so it wraps the `onwarn` on the
 * options it resolved. When those are not where version 7 keeps them, warnings
 * are left as they are.
 *
 * @param maps Source maps of the compiled files, keyed by the markdown's absolute path.
 */
export function remapSvelteWarnings(
  config: ResolvedConfig,
  suffix: string,
  maps: ReadonlyMap<string, EncodedSourceMap>,
): void {
  const plugin = config.plugins.find((entry) => entry.name === 'vite-plugin-svelte:config') as
    SvelteConfigPlugin | undefined;
  const options = plugin?.api?.options;
  if (!options) return;

  const onwarn = options.onwarn;
  options.onwarn = (warning, defaultHandler) => {
    const remapped = remap(warning, config.root, suffix, maps);
    if (onwarn) onwarn(remapped, defaultHandler);
    else defaultHandler(remapped);
  };
}

function remap(
  warning: Warning,
  root: string,
  suffix: string,
  maps: ReadonlyMap<string, EncodedSourceMap>,
): Warning {
  if (!warning.filename?.endsWith(suffix)) return warning;

  const filename = warning.filename.slice(0, -suffix.length);
  // vite-plugin-svelte reports it relative to the working directory, which need not be the root.
  const map = maps.get(resolve(filename)) ?? maps.get(resolve(root, filename));
  const source = map?.sourcesContent?.[0];
  const start =
    map && warning.start
      ? originalPosition(map, warning.start.line, warning.start.column)
      : undefined;
  if (!map || !source || !start) return { ...warning, filename };

  const end = warning.end ? originalPosition(map, warning.end.line, warning.end.column) : undefined;

  return {
    ...warning,
    filename,
    start: location(source, start),
    ...(end ? { end: location(source, end) } : {}),
    frame: codeFrame(source, start, end),
  };
}

/** Svelte's shape: 1-based line, 0-based column, plus the offset. */
function location(source: string, point: SvmdPoint): Location {
  const lines = source.split('\n');
  let character = point.column - 1;
  for (let index = 0; index < point.line - 1; index++) character += (lines[index] ?? '').length + 1;

  return { line: point.line, column: point.column - 1, character };
}
