import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Database drivers may only be imported from backend/data/ (the data-access layer).
const DB_DRIVERS = ['pg', 'pg-*', 'postgres', '@types/pg'];

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: DB_DRIVERS,
              message:
                'Only backend/data/ may import the database driver. Use the data-access layer.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['backend/data/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['frontend/**'],
    languageOptions: { globals: { ...globals.browser } },
  },
);
