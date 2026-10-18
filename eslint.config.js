import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Database drivers may only be imported from backend/data/ (the data-access layer).
const DB_DRIVERS = ['pg', 'pg-*', 'postgres', '@types/pg'];

const driverPattern = {
  group: DB_DRIVERS,
  message: 'Only backend/data/ may import the database driver. Use the data-access layer.',
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [driverPattern],
        },
      ],
    },
  },
  {
    // Adapters and stages never touch the database, not even through the data layer.
    files: ['backend/providers/**', 'backend/stages/**', 'backend/lib/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            driverPattern,
            {
              group: ['**/data', '**/data/*'],
              message:
                'Providers and stages are pure: return values and let the runner persist them.',
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
