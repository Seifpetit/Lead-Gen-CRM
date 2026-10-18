import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@lead-gen-crm/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  // The API checks that a request's Origin matches its Host (CSRF), so the proxy must pass the
  // browser's Host through (changeOrigin: false) instead of rewriting it to the backend's.
  server: { proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } } },
});
