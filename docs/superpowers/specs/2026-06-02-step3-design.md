# Step 3 Design: Async Ingest + SSE Progress + Refresh Button

**Date:** 2026-06-02  
**Branch:** step3  
**Scope:** Worker-free async ingestion, SSE progress feed, full-page loading overlay, refresh link

---

## Context

After Step 2, the app ingests 12 PDFs (~21 316 items) on first boot. The current `bootstrap.ts` blocks the first `/api/search` request for ~13 s on a cold DB. Step 3 makes the server immediately available, streams ingest progress to the client, and lets an admin re-trigger ingestion without restarting the process.

**Architecture choice:** In-process async with `EventEmitter` (not `worker_threads`). Ingest is I/O-bound (network fetch + SQLite writes); `setImmediate` yields between PDFs keep the event loop free for search requests during ingest. `worker_threads` + TypeScript + Next.js webpack requires a pre-compiled JS shim and separate DB connections — unnecessary complexity for this use case.

---

## Architecture Overview

```
bootstrap.ts         ← fires runIngest() async on startup (no await)
     │
     ▼
ingest-state.ts      ← singleton: IngestState object + EventEmitter
     │  events: pdf-done, done, error
     ├────────────────────────────────────────┐
     ▼                                        ▼
ingest.ts (unchanged)            /api/ingest/stream  (SSE GET)
  ingestPdf(url)                 /api/ingest/refresh (POST)
  called by runIngest()
                                          │
                                          ▼
                                   page.tsx (client)
                                   ├── IngestOverlay.tsx  (full-screen)
                                   └── SearchBox.tsx      (+ refresh link)
```

---

## Section 1: `src/lib/ingest-state.ts` (new file)

### Types

```ts
export type IngestStatus = 'idle' | 'running' | 'done' | 'error';

export interface IngestState {
  status: IngestStatus;
  current: number;        // PDFs completed this run
  total: number;          // total PDFs this run
  lastLabel: string;      // e.g. "2 черга, ІІ підчерга"
  completedAt: string | null;  // ISO timestamp of last successful run
  error: string | null;
}
```

### Singleton state

```ts
export const ingestState: IngestState = {
  status: 'idle', current: 0, total: 0,
  lastLabel: '', completedAt: null, error: null,
};

export const ingestEvents = new EventEmitter();
```

### `runIngest(urls: string[]): Promise<void>`

Exported async function. Behaviour:

1. **Guard:** if `status === 'running'` return immediately (no concurrent runs).
2. Reset state: `status = 'running'`, `current = 0`, `total = urls.length`, `error = null`.
3. For each URL:
   - Call `await ingestPdf(url)`.
   - `await new Promise(r => setImmediate(r))` — yield so queued search requests can be handled.
   - Increment `current`, emit `pdf-done` with `{ current, total, label, items }`.
   - On error: log, continue with remaining URLs (partial corpus preferred over nothing).
4. On completion: `status = 'done'`, `completedAt = new Date().toISOString()`, emit `done` with `{ totalItems, completedAt }`.
5. If **all** URLs failed: `status = 'error'`, emit `error` with `{ message }`. Does not re-throw (caller is fire-and-forget).

### Event shapes

```
'pdf-done'  → { current: number, total: number, label: string, items: number }
'done'      → { totalItems: number, completedAt: string }
'error'     → { message: string }
```

---

## Section 2: Changes to existing files

### `src/server/bootstrap.ts`

Remove the module-level `Promise` singleton. Replace with:

```ts
discoverUrls()
  .then(urls => runIngest(urls))
  .catch(err => console.error('[bootstrap] failed to start ingest:', err.message));
```

Server is immediately ready. First `/api/search` no longer blocks.

### `src/lib/ingest.ts`

No structural changes. `setImmediate` yield lives in `runIngest`, not inside `ingestPdf`, so `ingestPdf` remains a pure self-contained unit and its tests are unaffected.

### `src/app/api/search/route.ts`

Add one guard at the top of the handler:

```ts
if (ingestState.status === 'idle') {
  return NextResponse.json({ message: 'not_ready' }, { status: 503 });
}
```

Once ingest starts (even mid-run), search works on whatever is already in the DB — partial results are better than a spinner.

---

## Section 3: API Routes

### `GET /api/ingest/stream`

File: `src/app/api/ingest/stream/route.ts`

Returns a `ReadableStream` with `Content-Type: text/event-stream`.

On connect:
1. Send an `init` event with the current `ingestState` snapshot so the client doesn't wait for the next emission.
2. Subscribe to `ingestEvents`. Forward `pdf-done`, `done`, and `error` as SSE events.
3. Close the stream on `done` or `error`.
4. Remove the EventEmitter listener on stream cancel (prevents listener leaks on client disconnect).

SSE event format:

```
event: init
data: {"status":"running","current":3,"total":12,"lastLabel":"2 черга, І підчерга","completedAt":null}

event: pdf-done
data: {"current":4,"total":12,"label":"2 черга, ІІ підчерга","items":1842}

event: done
data: {"totalItems":21316,"completedAt":"2026-06-02T10:14:00.000Z"}

event: error
data: {"message":"All 12 PDF ingestions failed: ..."}
```

### `POST /api/ingest/refresh`

File: `src/app/api/ingest/refresh/route.ts`

1. If `ingestState.status === 'running'` → `409 Conflict` `{ message: 'already_running' }`.
2. Otherwise: call `discoverUrls()` then fire `runIngest(urls)` without await → `202 Accepted` `{ message: 'started' }`.
3. No auth for now (single-user VPS). A secret-header check can be added in the Iter3 security pass.

---

## Section 4: UI Components

### `src/components/IngestOverlay.tsx` (new, `'use client'`)

Connects to `/api/ingest/stream` via `EventSource` on mount. Local state: `{ status, current, total, lastLabel }`.

Rendering:
- **Overlay:** `fixed inset-0 z-50 bg-white/95 backdrop-blur-sm` — covers the full screen.
- **Card** (centred):
  - **Running:** progress bar (`current / total` width), current `lastLabel` below, subtitle "Після завершення пошук стане доступним автоматично."
  - **Done:** brief "✓ Дані завантажено" then calls `onReady()` prop — parent unmounts the overlay.
  - **Error:** red error message + "Спробувати ще раз" button that POSTs to `/api/ingest/refresh` and reconnects the `EventSource`.
- If `init` event arrives with `status === 'done'`: call `onReady()` immediately (DB already populated, no loading needed).

Props: `{ onReady: (completedAt: string) => void }`

### `src/app/page.tsx`

```tsx
const [overlayVisible, setOverlayVisible] = useState(true);
const [completedAt, setCompletedAt] = useState<string | null>(null);

// ...

{overlayVisible && (
  <IngestOverlay onReady={(ts) => { setCompletedAt(ts); setOverlayVisible(false); }} />
)}
<SearchBox refreshedAt={completedAt} onRefreshStart={() => setOverlayVisible(true)} />
```

`onReady` receives the `completedAt` timestamp from the `done` SSE event.

### `src/components/SearchBox.tsx`

Two additions below the chip row:

```tsx
<div className="mt-2 flex justify-end text-xs text-slate-400 gap-2">
  {refreshedAt && <span>Оновлено: {formatDate(refreshedAt)}</span>}
  <button
    onClick={handleRefresh}
    disabled={refreshing}
    className="hover:text-slate-600 disabled:opacity-50"
  >
    {refreshing ? 'Оновлення…' : '↺ Оновити'}
  </button>
</div>
```

`handleRefresh`:
1. POST `/api/ingest/refresh`.
2. On `202`: call `onRefreshStart()` prop (parent re-mounts the overlay), set `refreshing = true`.
3. On `409`: call `onRefreshStart()` without re-triggering (overlay shows live progress of the already-running ingest).
4. `refreshing` resets to `false` via a `useEffect` that watches the `refreshedAt` prop — when the parent passes a new timestamp, the refresh cycle is complete.

New props added to `SearchBox`: `refreshedAt: string | null`, `onRefreshStart: () => void`.

---

## Section 5: Testing

### `tests/ingest-state.test.ts`

- State transitions: `idle → running → done`, correct `current`/`total`, `pdf-done` and `done` events fire in order — with mocked `ingestPdf`.
- Concurrent-call guard: second `runIngest` call while first is running returns immediately; ingest runs only once.
- Error mid-run: one PDF throws → `status = 'error'`, `error` event emitted, remaining PDFs still attempted.

### `tests/ingest-stream.test.ts`

- Unit-test the route handler directly (no HTTP): read from the `ReadableStream`, assert `init` event reflects current state, assert `pdf-done`/`done` events are forwarded.
- Client-disconnect cleanup: cancel the stream mid-run, assert `ingestEvents` listener count drops to zero.

### `tests/ingest-refresh.test.ts`

- POST while idle → `202`, `runIngest` called.
- POST while running → `409`.

Existing 34 tests unchanged — `ingestPdf` and its callers are not structurally modified.

---

## Files changed / created

| File | Change |
|------|--------|
| `src/lib/ingest-state.ts` | **new** — state singleton + EventEmitter + `runIngest` |
| `src/server/bootstrap.ts` | fire-and-forget `runIngest`, remove promise singleton |
| `src/lib/ingest.ts` | no changes |
| `src/app/api/search/route.ts` | add `idle` guard |
| `src/app/api/ingest/stream/route.ts` | **new** — SSE endpoint |
| `src/app/api/ingest/refresh/route.ts` | **new** — POST trigger |
| `src/components/IngestOverlay.tsx` | **new** — full-page progress overlay |
| `src/app/page.tsx` | add overlay state + pass props to SearchBox |
| `src/components/SearchBox.tsx` | add refresh link + new props |
| `tests/ingest-state.test.ts` | **new** |
| `tests/ingest-stream.test.ts` | **new** |
| `tests/ingest-refresh.test.ts` | **new** |
