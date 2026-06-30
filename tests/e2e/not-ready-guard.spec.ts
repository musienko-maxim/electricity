/**
 * E2E spec: not-ready guard – 503 handling and graceful degradation.
 *
 * Covers user story US-10.
 *
 * The 503 `not_ready` response is exercised via page.route() mocks so that
 * the tests do not depend on a real uninitialised server.  The webServer in
 * playwright.config.ts always runs in fixture mode (completedAt set), so
 * these tests intercept /api/search and inject 503/400 responses themselves.
 *
 * SearchBox error-display path:
 *   fetch() → !res.ok → body.message thrown → setError(message) → renders
 *   <div>Помилка: {error}</div>
 */

import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function waitForReady(page: Page): Promise<void> {
  await page.waitForSelector('text=Підготовка бази даних', {
    state: 'hidden',
    timeout: 15_000,
  });
}

// ---------------------------------------------------------------------------
// 503 not_ready guard (US-10)
// ---------------------------------------------------------------------------

test.describe('Search API error handling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForReady(page);
  });

  test('503 not_ready surfaced as readable error, page does not crash (US-10)', async ({
    page,
  }) => {
    // Override the real search endpoint for this test only
    await page.route('/api/search**', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'not_ready' }),
      });
    });

    await page.getByRole('textbox', { name: 'Пошук' }).fill('Ювілейна');

    // SearchBox shows "Помилка: not_ready" from the thrown Error message
    await expect(
      page.getByText(/Помилка:.*not_ready/),
    ).toBeVisible({ timeout: 8_000 });

    // The page header must still be visible — no crash
    await expect(
      page.getByRole('heading', { level: 1 }),
    ).toBeVisible();
  });

  test('400 bad request surfaced as error, page does not crash', async ({ page }) => {
    await page.route('/api/search**', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'invalid_query',
          details: { fieldErrors: { q: ['String must contain at least 1 character(s)'] } },
        }),
      });
    });

    await page.getByRole('textbox', { name: 'Пошук' }).fill('тест');

    // Any "Помилка:" prefix indicates the error was handled
    await expect(page.getByText(/Помилка:/)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('500 internal error surfaced gracefully', async ({ page }) => {
    await page.route('/api/search**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'search_failed', message: 'database locked' }),
      });
    });

    await page.getByRole('textbox', { name: 'Пошук' }).fill('тест500');

    await expect(page.getByText(/Помилка:/)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  // ─── Short-query guard lives at the component level (no HTTP) ─────────────

  test('query shorter than 2 chars never calls /api/search', async ({ page }) => {
    let called = false;
    await page.route('/api/search**', async (route) => {
      called = true;
      await route.continue();
    });

    await page.getByRole('textbox', { name: 'Пошук' }).fill('т');

    // Debounce fires after 250 ms; we wait 600 ms to be safe
    await page.waitForTimeout(600);
    expect(called).toBe(false);

    // No dropdown opened
    await expect(page.getByText(/Нічого не знайдено/)).not.toBeVisible();
    await expect(page.getByText(/Помилка:/)).not.toBeVisible();
  });
});
