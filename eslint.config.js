import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
    // Ignore patterns (must be first)
    {
        ignores: [
            'dist/**',
            'ui/**',
            'ui-dist/**',
            'node_modules/**',
            'fixtures/**',
            'examples/**',
            'coverage/**',
            'e2e-demo/**',
            '*.config.js',
            '*.config.ts',
            'mockcraft.config.*',
        ],
    },

    // Base JS recommended rules
    eslint.configs.recommended,

    // TypeScript strict + stylistic rules
    ...tseslint.configs.strict,
    ...tseslint.configs.stylistic,

    // Prettier — disables formatting rules that conflict
    prettier,

    // Project settings for src/ and tests/
    {
        files: ['src/**/*.ts', 'tests/**/*.ts'],
        rules: {
            // Allow @ts-expect-error with descriptions (we use these intentionally)
            '@typescript-eslint/ban-ts-comment': ['error', {
                'ts-expect-error': 'allow-with-description',
            }],
            // Allow unused vars prefixed with _ (common pattern)
            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_|err|saveErr',
            }],
            // We use empty catches intentionally for best-effort operations
            'no-empty': 'off',
            '@typescript-eslint/no-empty-function': 'off',
            // Allow non-null assertions sparingly (we validate upstream)
            '@typescript-eslint/no-non-null-assertion': 'warn',
            // Allow dynamic delete (used for config.ai.apiKey)
            '@typescript-eslint/no-dynamic-delete': 'off',
        },
    },
);
