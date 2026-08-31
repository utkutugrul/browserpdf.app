import { defineConfig, devices } from '@playwright/test';

// Smoke tests drive the real tool pages through `wrangler dev`, so they need
// network access: every tool loads its PDF library from jsDelivr at runtime.
// Set BASE_URL to smoke-test a deployed environment instead of a local dev
// server, e.g. BASE_URL=https://browserpdf.app npm test after a deploy.
const baseURL = process.env.BASE_URL || 'http://localhost:8788';
const isLocal = baseURL.includes('localhost');

export default defineConfig({
  testDir: './tests',
  // Remote runs go serial: every test re-fetches the pinned libraries from
  // jsDelivr in a fresh context, and running them in parallel from one IP gets
  // those fetches throttled, which surfaces as random tool timeouts. Each test
  // passes on its own against production; only the fan-out is the problem.
  timeout: isLocal ? 90_000 : 240_000,
  expect: { timeout: isLocal ? 15_000 : 30_000 },
  fullyParallel: true,
  workers: isLocal ? (process.env.CI ? 2 : 4) : 1,
  // Remote runs get retries: throttled library fetches make a random test or two
  // time out over the course of a full run, and they pass on a second attempt.
  retries: isLocal ? (process.env.CI ? 1 : 0) : 2,
  reporter: [['list']],
  globalSetup: './tests/make-fixtures.mjs',
  use: {
    baseURL,
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: isLocal
    ? {
        command: 'npx wrangler dev --port 8788 --local',
        url: 'http://localhost:8788/',
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
});
