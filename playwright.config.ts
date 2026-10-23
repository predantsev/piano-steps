import { defineConfig, devices } from '@playwright/test';

/**
 * E2E: the real app (Vite dev server, so the dev automation API `window.pianoSteps` exists) against
 * a real API with a throwaway in-memory database (PGLITE_DIR=memory://, seeded with the 3 demo lessons).
 *
 * Ports 9390/9391 by default — outside the 93x0/93x1 pairs the worktrees use for `npm run dev`.
 * Override with E2E_WEB_PORT / E2E_API_PORT. Run: `npm run e2e` (first time: `npm run e2e:install`).
 * Docs: docs/testing-api.md.
 */

const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 9390);
const API_PORT = Number(process.env.E2E_API_PORT ?? 9391);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    locale: 'en-US', // the app picks uk/en from navigator.language; tests read English labels
    trace: 'retain-on-failure',
  },
  projects: [
    {
      // The owner's device: iPad, landscape, touch, Safari's engine.
      name: 'ipad-webkit',
      use: { ...devices['iPad Pro 11 landscape'], viewport: { width: 1180, height: 820 } },
    },
    {
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        // WebMCPTesting exposes document.modelContext (measured on Playwright's Chromium 156).
        launchOptions: { args: ['--enable-features=WebMCPTesting'] },
      },
    },
  ],
  webServer: [
    {
      command: 'npx tsx apps/server/src/main.ts',
      env: { PORT: String(API_PORT), HOST: '127.0.0.1', PGLITE_DIR: 'memory://', API_TOKEN: '' },
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'npm run dev -w @piano-steps/web',
      env: { WEB_PORT: String(WEB_PORT), API_PORT: String(API_PORT), HOST: '127.0.0.1' },
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
