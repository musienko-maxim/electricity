/**
 * E2E spec: IngestOverlay and cold-start flow.
 *
 * Covers user stories US-1 through US-4.
 *
 * Two modes are exercised:
 *  1. Fixture mode (default webServer env):
 *     CHERKASY_E2E_SEED_COMPLETED_AT is set → SSE immediately emits
 *     init{status:'done'} → overlay disappears and search box is accessible.
 *
 *  2. Error-state mode (SSE mocked via page.route()):
 *     Tests observe the overlay in its error state without needing a real
 *     failed ingest. The mock fulfils the SSE request before the browser
 *     EventSource receives any real data.
 */

import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helper: install an SSE mock that puts the overlay into error state
// ---------------------------------------------------------------------------

/**
 * Intercepts /api/ingest/stream and returns a one-shot SSE response that puts
 * the IngestOverlay into its error state.
 *
 * @param message Optional error message sent as an `ingest-error` event body.
 *                When omitted, only the `init{status:'error'}` event is sent,
 *                which triggers the generic "Помилка завантаження даних" text.
 */
async function mockSseError(page: Page, message?: string): Promise<void> {
  // Build the SSE body.  Each event block ends with \n\n per the SSE spec.
  let body: string;
  if (message) {
    // Send init as 'running' first so the overlay doesn't short-circuit on
    // status='error' in the init handler, then send the ingest-error event
    // which sets the specific errorMsg.
    body =
      'event: init\n' +
      'data: {"status":"running","current":0,"total":1,"lastLabel":"","completedAt":null}\n\n' +
      'event: ingest-error\n' +
      `data: ${JSON.stringify({ message })}\n\n`;
  } else {
    // Generic error via init event with status:'error'
    body =
      'event: init\n' +
      'data: {"status":"error","current":0,"total":0,"lastLabel":"","completedAt":null}\n\n';
  }

  await page.route('/api/ingest/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
      body,
    });
  });
}

// ---------------------------------------------------------------------------
// Fixture mode: overlay resolves and search box appears (US-2)
// ---------------------------------------------------------------------------

test.describe('IngestOverlay – fixture mode', () => {
  /**
   * US-1 / US-2: the overlay shows on initial render then quickly disappears
   * because the SSE returns init{status:'done'} immediately (fixture env).
   * We wait for the overlay content to be gone and the search input to be
   * interactable (click would fail while the fixed overlay covers the page).
   */
  test('search box becomes interactive once SSE reports done', async ({ page }) => {
    await page.goto('/');

    // The overlay is always mounted initially (ClientShell starts with
    // overlayVisible=true). In fixture mode it vanishes in milliseconds once
    // the SSE init event arrives.
    // Waiting for the overlay heading to leave the DOM is the most precise
    // signal.
    await page.waitForSelector('text=Підготовка бази даних', {
      state: 'hidden',
      timeout: 15_000,
    });

    // After overlay is gone, the input must accept focus and text
    const input = page.getByRole('textbox', { name: 'Пошук' });
    await expect(input).toBeVisible();
    await input.click(); // fails if overlay still covers the viewport
  });

  test('page has correct Ukrainian heading', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 1 }),
    ).toContainText('Пошук черги відключень');
  });

  test('kind filter chips are rendered', async ({ page }) => {
    await page.goto('/');
    // Chips exist in DOM even while overlay is showing
    await expect(page.getByRole('button', { name: 'Усі' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Адреса' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Організація' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ФОП' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Особа' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Error state (SSE mocked) – US-3, US-4
// ---------------------------------------------------------------------------

test.describe('IngestOverlay – error state (SSE mocked)', () => {
  test('shows generic error message and retry button (US-3)', async ({ page }) => {
    await mockSseError(page);
    await page.goto('/');

    // Generic error: no errorMsg from the init event, so falls back to default text
    await expect(
      page.getByText('Помилка завантаження даних'),
    ).toBeVisible({ timeout: 8_000 });

    await expect(
      page.getByRole('button', { name: 'Спробувати ще раз' }),
    ).toBeVisible();
  });

  test('shows specific error message from ingest-error SSE event', async ({ page }) => {
    const errorMsg = 'PDF сервер недоступний';
    await mockSseError(page, errorMsg);
    await page.goto('/');

    await expect(page.getByText(errorMsg)).toBeVisible({ timeout: 8_000 });
    await expect(
      page.getByRole('button', { name: 'Спробувати ще раз' }),
    ).toBeVisible();
  });

  test('retry button sends POST /api/ingest/refresh (US-4)', async ({ page }) => {
    // Put overlay into error state
    await mockSseError(page);

    // Stub the refresh endpoint so the POST resolves without real ingest
    await page.route('/api/ingest/refresh', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 202,
          contentType: 'application/json',
          body: '{"message":"started"}',
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/');
    await expect(
      page.getByRole('button', { name: 'Спробувати ще раз' }),
    ).toBeVisible({ timeout: 8_000 });

    // Capture the refresh request before clicking (waitForRequest resolves once
    // the request is dispatched — no arbitrary sleep needed)
    const refreshPromise = page.waitForRequest(
      (req) =>
        req.url().includes('/api/ingest/refresh') && req.method() === 'POST',
      { timeout: 8_000 },
    );

    await page.getByRole('button', { name: 'Спробувати ще раз' }).click();
    const refreshRequest = await refreshPromise;

    expect(refreshRequest.method()).toBe('POST');
  });
});
