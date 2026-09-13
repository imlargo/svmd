import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      // Emitted from the forks' JSDoc.
      '**/types/**',

      // The forks keep upstream's code and upstream's style. FORK.md records the
      // commit each file came from, and linting them would mean either editing
      // forked code or carrying a wall of disable comments — both of which make
      // the next diff against upstream unreadable. Their own suites cover them.
      'packages/micromark-extension-svelte/**',
      'packages/micromark-factory-svelte-expression/**',
      'packages/mdast-util-svelte/**',

      // Snapshots are compiler output compared byte for byte.
      'test/snapshots/**',

      // The example app is a consumer, not part of the library.
      'examples/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['**/*.ts'],
    rules: {
      // A leading underscore is the convention for a binding that exists only to
      // be discarded — destructuring to omit a key, an argument kept for arity.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // `noUncheckedIndexedAccess` is on, so every indexed read is `T | undefined`.
      // Template literals in error messages interpolate line and column numbers,
      // and stringifying a number is not the footgun this rule guards against.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // A test that indexes into a result it just produced is asserting the shape.
    // If the index is empty the `!` throws and the test fails loudly, which is
    // the intended outcome — writing a guard instead would only make it fail
    // less clearly. Same for the empty functions used as plugin stubs.
    files: ['test/**'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
  {
    // scripts/ and .husky/ are plain Node, run outside the tsconfig'd project.
    files: ['scripts/**', '.husky/**', 'test/support/**'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
      },
    },
  },
  prettier,
);
