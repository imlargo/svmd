import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const script = fileURLToPath(new URL('./support/run-with-assertions.mjs', import.meta.url));

describe('token invariants', () => {
  it("passes micromark's development assertions on every fixture", async () => {
    // `--conditions=development` picks micromark's asserting build, which only
    // works if set before the first import — hence a child process.
    const { stdout } = await run(process.execPath, ['--conditions=development', script], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
    }).catch((error: unknown) => {
      const { stdout, stderr } = error as { stdout?: string; stderr?: string };
      throw new Error(stderr ?? stdout ?? 'assertion run failed');
    });

    expect(stdout.trim()).toBe('ok');
  }, 60_000);
});
