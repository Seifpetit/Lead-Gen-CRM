import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: {
    alias: {
      '@lead-gen-crm/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  test: { name: 'backend', include: ['**/*.test.ts'], exclude: ['dist/**', 'node_modules/**'] },
});
