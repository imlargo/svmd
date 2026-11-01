import { posix } from 'node:path';
import type { ResolvedConfig } from 'vite';

/** The part of SvelteKit's setup plugin this reads: the config it validated. */
interface KitSetupPlugin {
  api?: {
    options?: {
      extensions?: string[];
      files?: { src?: string | null; routes?: string | null };
    };
  };
}

/**
 * Globs for the route files SvelteKit will look for among the extensions svmd
 * compiles, so `.md` in `sveltekit({ extensions })` is the only setting a
 * `+page.md` needs. Empty outside SvelteKit.
 *
 * @param compiled Extensions the include globs name, lowercase with the dot.
 */
export function kitRouteGlobs(
  config: ResolvedConfig,
  compiled: ReadonlySet<string> | null,
): string[] {
  const plugin = config.plugins.find((entry) => entry.name === 'vite-plugin-sveltekit-setup') as
    KitSetupPlugin | undefined;
  const options = plugin?.api?.options;
  if (!options?.extensions || !compiled) return [];

  const routes = options.files?.routes ?? posix.join(options.files?.src ?? 'src', 'routes');

  return options.extensions
    .filter((extension) => compiled.has(extension.toLowerCase()))
    .map((extension) => `${routes}/**/+*${extension}`);
}
