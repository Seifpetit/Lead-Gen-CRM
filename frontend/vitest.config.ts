import { defineProject, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

export default mergeConfig(
  viteConfig,
  defineProject({ test: { name: 'frontend', include: ['src/**/*.test.{ts,tsx}'] } }),
);
