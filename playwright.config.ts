import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

/**
 * Playwright e2e configuration.
 *
 * Fixture mode (default):
 *   - DATA_DIR points to tests/e2e/fixtures/data/ which is seeded by global-setup.ts
 *   - CHERKASY_E2E_SEED_COMPLETED_AT tells bootstrap.ts to skip real PDF ingestion and
 *     immediately mark the DB as ready, so the overlay closes and search works.
 *
 * No-PDF-URL mode (without env overrides):
 *   - Ingest fails at startup → overlay shows error state.
 *   - Tests that rely on search use page.route() to mock the API.
 *
 * To run against a locally running dev server (skip the automatic start):
 *   PLAYWRIGHT_REUSE_SERVER=1 npm run test:e2e
 */

const FIXTURE_DATA_DIR = path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'data');

// ISO timestamp used as the "last successful ingest" in fixture mode.
// Any valid ISO-8601 string works; this one is just a recognisable sentinel.
const E2E_SEED_COMPLETED_AT = '2026-01-01T10:00:00.000Z';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',

  // Reasonable wall-clock bounds for each test
  timeout: 30_000,
  expect: { timeout: 10_000 },

  // Run tests sequentially – they share one webServer process on port 3000
  fullyParallel: false,
  workers: 1,

  // Fail fast in CI if any test is left in `.only` state
  forbidOnly: !!process.env.CI,

  // One retry on CI to absorb transient timing blips
  retries: process.env.CI ? 1 : 0,

  reporter: [
    process.env.CI ? ['github'] : ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Short navigation timeout – the dev server is already up when tests run
    navigationTimeout: 15_000,
    actionTimeout: 10_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Seed the fixture SQLite DB before any test runs
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',

  webServer: {
    // Use dev server for speed.  In CI, prefer production build for correct
    // singleton behaviour:  npm run build && npm run start
    command: process.env.E2E_PROD
      ? 'npm run build && npm run start'
      : 'npm run dev',
    url: 'http://localhost:3000',
    // Allow up to 2 min for first compile / prod build
    timeout: 120_000,
    // Reuse an already-running server in local dev; always start fresh in CI
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // Point the app at the pre-seeded fixture database
      DATA_DIR: FIXTURE_DATA_DIR,
      // Skip real PDF ingestion and mark state as done immediately
      CHERKASY_E2E_SEED_COMPLETED_AT: E2E_SEED_COMPLETED_AT,
      PORT: '3000',
    },
  },
});
