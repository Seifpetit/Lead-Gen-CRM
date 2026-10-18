import { defineProject, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

export default mergeConfig(
  viteConfig,
  defineProject({
    test: {
      name: 'frontend',
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['src/test/setup.ts'],
      // Only the app stylesheet is read, so tests can check the design tokens and the focus ring.
      css: { include: [/src\/styles\.css/] },
    },
  }),
);
