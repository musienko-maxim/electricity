/**
 * E2E spec: SearchBox – full happy-path flow with the pre-seeded fixture DB.
 *
 * Covers user stories US-5 through US-9 and US-11.
 *
 * Prerequisites (handled by global-setup.ts + playwright.config.ts):
 *   - DATA_DIR points to tests/e2e/fixtures/data/ (seeded by global-setup)
 *   - CHERKASY_E2E_SEED_COMPLETED_AT is set → SSE returns done immediately
 *     → overlay closes → search is live against the real fixture SQLite DB
 *
 * Fixture data quick reference:
 *   - "вул. Тестова {1–20}"  → 20 results → 2 pages at pageSize=15
 *   - "вул. Ювілейна {1–3}"  → 3 address results
 *   - "ТОВ Черкасиенерго"    → 1 organization result
 *   - "ФОП Іваненко І.І."    → 1 fop result
 *   - "Іваненко Іван Іванович" → 1 person result
 *   All items belong to queue "1 черга, І підчерга" / "Черкаська філія"
 */

import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for the SSE init to resolve and overlay to disappear. */
async function waitForReady(page: Page): Promise<void> {
  // In fixture mode the overlay heading disappears in milliseconds.
  // Using state:'hidden' handles both "element gone" and "never existed".
  await page.waitForSelector('text=Підготовка бази даних', {
    state: 'hidden',
    timeout: 15_000,
  });
}

function searchInput(page: Page) {
  return page.getByRole('textbox', { name: 'Пошук' });
}

// ---------------------------------------------------------------------------
// Short-query guard (US-5)
// ---------------------------------------------------------------------------

test.describe('SearchBox – short query guard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForReady(page);
  });

  test('typing 1 character does not open the dropdown (US-5)', async ({ page }) => {
    let searchCalled = false;
    await page.route('/api/search**', async (route) => {
      searchCalled = true;
      await route.continue();
    });

    await searchInput(page).fill('в');

    // Debounce is 250 ms; give a little extra breathing room
    await page.waitForTimeout(600);
    expect(searchCalled).toBe(false);

    // No dropdown (the container only renders when q.trim().length >= 2)
    await expect(
      page.getByText('Нічого не знайдено'),
    ).not.toBeVisible();
  });

  test('empty input does not open the dropdown', async ({ page }) => {
    await searchInput(page).fill('');
    await page.waitForTimeout(400);
    await expect(page.getByRole('list')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Address search (US-6)
// ---------------------------------------------------------------------------

test.describe('SearchBox – address search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForReady(page);
  });

  test('typing "Ювілейна" returns address results (US-6)', async ({ page }) => {
    await searchInput(page).fill('Ювілейна');

    // Wait for the results list to appear
    const list = page.getByRole('list');
    await expect(list).toBeVisible({ timeout: 8_000 });

    // At least one result visible
    const items = page.getByRole('listitem');
    await expect(items.first()).toBeVisible();

    // Queue label must appear in the result
    await expect(page.getByText('1 черга, І підчерга').first()).toBeVisible();
    // Filia name
    await expect(page.getByText('Черкаська філія').first()).toBeVisible();
  });

  test('result badge shows "адреса" kind (US-6)', async ({ page }) => {
    await searchInput(page).fill('Ювілейна');
    await expect(page.getByRole('list')).toBeVisible({ timeout: 8_000 });
    // All fixture Ювілейна items are street_with_numbers → badge "адреса"
    await expect(page.getByText('адреса').first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Kind filter chips (US-7)
// ---------------------------------------------------------------------------

test.describe('SearchBox – kind filter chips', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForReady(page);
  });

  test('"Організація" chip filters to org results only (US-7)', async ({ page }) => {
    // First: search with kind=all to see all matches for "Черкас" (org present)
    await searchInput(page).fill('Черкас');
    await expect(page.getByRole('list')).toBeVisible({ timeout: 8_000 });

    // Click the Організація chip
    const orgChip = page.getByRole('button', { name: 'Організація' });
    await orgChip.click();
    await expect(orgChip).toHaveAttribute('aria-pressed', 'true');

    const resultsList = page.getByRole('list').first();
    // Only "організація" badge should appear in results
    await expect(resultsList.getByText('організація').first()).toBeVisible({ timeout: 6_000 });
    // No "адреса" BADGE in the results list when kind=org.
    // Scope to the <ul> so that the "Адреса" chip button (outside the list)
    // does not produce a false match (getByText is case-insensitive by default).
    await expect(resultsList.getByText('адреса')).not.toBeVisible();
  });

  test('"Усі" chip resets filter and shows all kinds (US-7)', async ({ page }) => {
    await searchInput(page).fill('Іваненко');
    await expect(page.getByRole('list')).toBeVisible({ timeout: 8_000 });

    // Narrow to ФОП
    await page.getByRole('button', { name: 'ФОП' }).click();
    await expect(page.getByText('ФОП').first()).toBeVisible({ timeout: 5_000 });

    // Reset
    const allChip = page.getByRole('button', { name: 'Усі' });
    await allChip.click();
    await expect(allChip).toHaveAttribute('aria-pressed', 'true');

    // After "Усі" we should see multiple kinds for "Іваненко" (fop + person)
    await expect(page.getByRole('listitem').nth(1)).toBeVisible({ timeout: 5_000 });
  });

  test('active chip has correct aria-pressed state', async ({ page }) => {
    // "Усі" starts active
    await expect(
      page.getByRole('button', { name: 'Усі' }),
    ).toHaveAttribute('aria-pressed', 'true');

    // Other chips are not active
    await expect(
      page.getByRole('button', { name: 'Адреса' }),
    ).toHaveAttribute('aria-pressed', 'false');

    // Click Адреса
    await page.getByRole('button', { name: 'Адреса' }).click();
    await expect(
      page.getByRole('button', { name: 'Адреса' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.getByRole('button', { name: 'Усі' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });
});

// ---------------------------------------------------------------------------
// No results (US-8)
// ---------------------------------------------------------------------------

test.describe('SearchBox – no results', () => {
  test('shows "Нічого не знайдено" for unmatched query (US-8)', async ({ page }) => {
    await page.goto('/');
    await waitForReady(page);

    await searchInput(page).fill('хймертрон');

    await expect(
      page.getByText(/Нічого не знайдено/),
    ).toBeVisible({ timeout: 8_000 });
  });
});

// ---------------------------------------------------------------------------
// Pagination (US-9)
// ---------------------------------------------------------------------------

test.describe('SearchBox – pagination', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForReady(page);
  });

  test('"Тестова" returns 20 results split across 2 pages (US-9)', async ({ page }) => {
    await searchInput(page).fill('Тестова');
    await expect(page.getByRole('list')).toBeVisible({ timeout: 8_000 });

    // Footer shows "Сторінка 1 з 2 · знайдено 20"
    await expect(page.getByText(/Сторінка.*1.*з.*2/)).toBeVisible({ timeout: 6_000 });
    await expect(page.getByText(/знайдено.*20/)).toBeVisible();
  });

  test('"← Назад" is disabled on page 1 and enabled on page 2 (US-9)', async ({ page }) => {
    await searchInput(page).fill('Тестова');
    await expect(page.getByRole('list')).toBeVisible({ timeout: 8_000 });

    const prevBtn = page.getByRole('button', { name: '← Назад' });
    const nextBtn = page.getByRole('button', { name: 'Далі →' });

    await expect(prevBtn).toBeDisabled();
    await expect(nextBtn).toBeEnabled();

    // Navigate to page 2
    await nextBtn.click();
    await expect(page.getByText(/Сторінка.*2.*з.*2/)).toBeVisible({ timeout: 6_000 });
    await expect(prevBtn).toBeEnabled();
    await expect(nextBtn).toBeDisabled();
  });

  test('page 1 and page 2 show different results (no duplicates) (US-9)', async ({ page }) => {
    await searchInput(page).fill('Тестова');
    await expect(page.getByRole('list')).toBeVisible({ timeout: 8_000 });

    // Collect page-1 result labels (first item's display text)
    const firstPageItems = await page.getByRole('listitem').allTextContents();

    // Go to page 2
    await page.getByRole('button', { name: 'Далі →' }).click();
    await expect(page.getByText(/Сторінка.*2.*з.*2/)).toBeVisible({ timeout: 6_000 });

    const secondPageItems = await page.getByRole('listitem').allTextContents();

    // No item text should appear on both pages
    const overlap = firstPageItems.filter((t) => secondPageItems.includes(t));
    expect(overlap).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Refresh button (US-11)
// ---------------------------------------------------------------------------

test.describe('SearchBox – refresh button', () => {
  test('clicking "↺ Оновити" sends POST /api/ingest/refresh (US-11)', async ({ page }) => {
    await page.goto('/');
    await waitForReady(page);

    // Stub refresh to avoid real re-ingest during test
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

    const refreshRequest = page.waitForRequest(
      (req) =>
        req.url().includes('/api/ingest/refresh') && req.method() === 'POST',
      { timeout: 8_000 },
    );

    await page.getByRole('button', { name: 'Оновити дані' }).click();
    const req = await refreshRequest;
    expect(req.method()).toBe('POST');
  });

  test('clicking "↺ Оновити" causes the overlay to reappear (US-11)', async ({ page }) => {
    await page.goto('/');
    await waitForReady(page);

    // After the initial overlay resolves, install a delayed SSE mock so that
    // the second EventSource (opened by the re-mounted IngestOverlay) stays in
    // 'running' state long enough for the assertion to observe the heading.
    // Without this the fixture SSE returns 'done' and the overlay vanishes before
    // our check runs.
    await page.route('/api/ingest/stream', async (route) => {
      await new Promise<void>((r) => setTimeout(r, 800));
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        body:
          'event: init\ndata: {"status":"running","current":0,"total":1,"lastLabel":"","completedAt":null}\n\n',
      });
    });

    await page.route('/api/ingest/refresh', async (route) => {
      await route.fulfill({ status: 202, body: '{"message":"started"}' });
    });

    await page.getByRole('button', { name: 'Оновити дані' }).click();

    // onRefreshStart() sets overlayVisible=true in ClientShell →
    // IngestOverlay re-mounts → renders "Підготовка бази даних…" heading
    await expect(
      page.getByRole('heading', { level: 2, name: 'Підготовка бази даних…' }),
    ).toBeVisible({ timeout: 5_000 });
  });
});
