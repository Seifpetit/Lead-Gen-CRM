import { defineConfig } from '@playwright/test';

// Browser smoke test against the real backend with the fake Apify (backend/test/e2eServer.ts)
// and the Vite dev server, which proxies /api to it. No real provider is ever called.
const BACKEND = 'http://127.0.0.1:3000';
const FRONTEND = 'http://localhost:5173';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 150_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // On GitHub the 'github' reporter turns a failure into a check annotation we can read.
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: { baseURL: FRONTEND, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    {
      command: 'npm run e2e:server -w backend',
      url: `${BACKEND}/api/auth/config`,
      reuseExistingServer: false,
      timeout: 120_000,
      cwd: '../..',
    },
    {
      command: 'npm run dev -w frontend -- --port 5173 --strictPort',
      url: FRONTEND,
      reuseExistingServer: false,
      timeout: 120_000,
      cwd: '../..',
    },
  ],
});
