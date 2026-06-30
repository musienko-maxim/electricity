# E2E User Stories – Cherkasy Queue Lookup

Given/When/Then specifications for the primary user flows.
Covered by specs in `tests/e2e/*.spec.ts`.

---

## US-1  Cold-start overlay (ingest in progress)

**Given** a visitor opens the page while the server is still ingesting PDFs  
**When** the page loads  
**Then** a full-screen overlay appears with a spinner and the heading
"Підготовка бази даних…"

**And** a sub-line reads "Після завершення пошук стане доступним автоматично."

---

## US-2  Overlay resolves when ingest completes

**Given** the ingest finishes successfully (SSE `done` event received)  
**When** the overlay closes  
**Then** the search box becomes accessible  
**And** the overlay content is no longer in the DOM

*File:* `ingest-overlay.spec.ts`

---

## US-3  Overlay error state

**Given** the ingest fails (SSE `ingest-error` event or `init{status:error}`)  
**When** the overlay renders the error state  
**Then** an error message is visible  
**And** a "Спробувати ще раз" button is visible

---

## US-4  Retry from overlay error state

**Given** the overlay is showing an error  
**When** the user clicks "Спробувати ще раз"  
**Then** a POST request is sent to `/api/ingest/refresh`  
**And** the overlay transitions back to the running state (reconnects SSE)

*File:* `ingest-overlay.spec.ts`

---

## US-5  Short query — no search triggered

**Given** the search box is visible and the DB is ready  
**When** the user types fewer than 2 characters  
**Then** no dropdown appears  
**And** no request is made to `/api/search`

*File:* `search.spec.ts`

---

## US-6  Search by address

**Given** the DB contains address entries  
**When** the user types at least 2 characters matching an address  
**Then** a dropdown appears below the input  
**And** each result row shows a queue label and filia name  
**And** the result kind badge reads "адреса"

*File:* `search.spec.ts`

---

## US-7  Kind filter

**Given** search results are visible  
**When** the user clicks the "Організація" chip  
**Then** the chip gains `aria-pressed="true"`  
**And** only results of kind "організація" are displayed  
**When** the user clicks "Усі"  
**Then** all kinds are shown again

*File:* `search.spec.ts`

---

## US-8  No results

**Given** the DB is ready  
**When** the user types a query that matches no entries  
**Then** the dropdown shows "Нічого не знайдено для «…»."  
**And** no result rows are rendered

*File:* `search.spec.ts`

---

## US-9  Pagination

**Given** the search returns more than 15 results  
**When** the results dropdown opens  
**Then** a pagination footer shows "Сторінка 1 з N · знайдено M"  
**And** the "← Назад" button is disabled  
**And** the "Далі →" button is enabled

**When** the user clicks "Далі →"  
**Then** page 2 is shown  
**And** the results are different from page 1  
**And** "← Назад" becomes enabled

*File:* `search.spec.ts`

---

## US-10  Not-ready guard (503 while idle)

**Given** ingest has not completed (DB not ready)  
**When** the user searches for something (3+ chars)  
**Then** the search dropdown shows an error message containing the error key  
**And** the page does not crash or show a blank screen

*Note:* The 503 `not_ready` response body (`{message:"not_ready"}`) is surfaced
by the `SearchBox` as "Помилка: not_ready". This is tested via `page.route()`
mock because real 503s require the server to be in an uninitialised state.

*File:* `not-ready-guard.spec.ts`

---

## US-11  Refresh button

**Given** the DB is ready and the overlay is hidden  
**When** the user clicks "↺ Оновити"  
**Then** a POST request is sent to `/api/ingest/refresh`  
**And** the overlay reappears (ClientShell sets overlayVisible=true)  
**And** the button label changes to "Оновлення…" while in progress

*File:* `search.spec.ts`
