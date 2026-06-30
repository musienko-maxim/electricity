# Step 3: Async Ingest + SSE Progress + Refresh Button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blocking bootstrap with fire-and-forget async ingest, stream progress to the client via SSE, and add a refresh button below the search chips.

**Architecture:** A new `ingest-state.ts` singleton holds `IngestState` + an `EventEmitter`. `bootstrap.ts` fires `runIngest()` without awaiting it so the server is immediately ready. SSE clients subscribe to the `EventEmitter`. The client shows a full-page overlay until the `done` event arrives, then fades to the search UI.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Node.js EventEmitter, `ReadableStream` SSE, Vitest, React `EventSource`, Tailwind CSS v4, Lucide icons.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/ingest.ts` | modify | add `label: string` to `IngestResult` |
| `src/lib/ingest-state.ts` | **create** | `IngestState` singleton + `EventEmitter` + `runIngest()` |
| `src/server/bootstrap.ts` | modify | export `discoverUrls`, fire `runIngest` without await |
| `src/app/api/search/route.ts` | modify | remove `ensureIngested`, add `idle` guard |
| `src/app/api/ingest/stream/route.ts` | **create** | SSE endpoint — forwards EventEmitter events |
| `src/app/api/ingest/refresh/route.ts` | **create** | POST trigger — 202 or 409 |
| `src/components/IngestOverlay.tsx` | **create** | full-page progress overlay (`EventSource` client) |
| `src/components/ClientShell.tsx` | **create** | client wrapper — holds overlay + search state |
| `src/app/page.tsx` | modify | use `ClientShell`, update footer copy |
| `src/components/SearchBox.tsx` | modify | add refresh link + `refreshedAt`/`onRefreshStart` props |
| `tests/ingest-state.test.ts` | **create** | unit tests: state transitions, concurrency guard, error path |
| `tests/ingest-stream.test.ts` | **create** | unit tests: init event, event forwarding, listener cleanup |
| `tests/ingest-refresh.test.ts` | **create** | unit tests: 202 idle, 409 running |

---

## Task 1: Add `label` to `IngestResult` in `ingest.ts`

`runIngest` (created in Task 3) emits a `pdf-done` event with the queue label (e.g. `"2 черга, І підчерга"`). `ingestPdf` must return it.

**Files:**
- Modify: `src/lib/ingest.ts`

- [ ] **Step 1: Add `label` field to `IngestResult`**

In `src/lib/ingest.ts`, change the interface from:
```ts
export interface IngestResult {
  url: string;
  pdfId: number;
  queueId: number;
  entries: number;
  items: number;
  skipped: boolean;
}
```
to:
```ts
export interface IngestResult {
  url: string;
  pdfId: number;
  queueId: number;
  entries: number;
  items: number;
  skipped: boolean;
  label: string;
}
```

- [ ] **Step 2: Populate `label` in the skipped-path return**

Change the `SELECT id FROM queues` query and return in the skipped branch:
```ts
// was: 'SELECT id FROM queues WHERE source_pdf_id = ?'
// becomes:
const q = db
  .prepare('SELECT id, label FROM queues WHERE source_pdf_id = ?')
  .get(existing.id) as { id: number; label: string } | undefined;
```

And add `label` to the return object in the skipped path:
```ts
return {
  url,
  pdfId: existing.id,
  queueId: q?.id ?? 0,
  entries: entryCount,
  items: itemCount,
  skipped: true,
  label: q?.label ?? '',
};
```

- [ ] **Step 3: Populate `label` in the non-skipped-path return**

`doc.label` is already in scope (it's on the `ParsedDocument` returned by `parsePdf`). Add it to the final return:
```ts
return {
  url,
  pdfId: out.pdfId,
  queueId: out.queueId,
  entries: out.entryCount,
  items: out.itemCount,
  skipped: false,
  label: doc.label,
};
```

- [ ] **Step 4: Verify existing tests still pass**

```bash
npm test -- --reporter=verbose 2>&1 | tail -20
```
Expected: all 34 existing tests green. No new failures.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ingest.ts
git commit -m "feat(ingest): return queue label in IngestResult"
```

---

## Task 2: Write failing tests for `ingest-state.ts`

TDD: write the tests against the not-yet-existing module so we know exactly what to implement.

**Files:**
- Create: `tests/ingest-state.test.ts`

- [ ] **Step 1: Create `tests/ingest-state.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// vi.resetModules() gives each test a fresh singleton (status: 'idle').
beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<{
  label: string; items: number; skipped: boolean;
}> = {}) {
  return {
    url: 'http://x/1.pdf', pdfId: 1, queueId: 1,
    entries: 5, items: 100, skipped: false, label: '1 черга, І підчерга',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

describe('runIngest — state transitions', () => {
  it('starts idle, becomes running, ends done', async () => {
    vi.doMock('@/lib/ingest', () => ({
      ingestPdf: vi.fn().mockResolvedValue(makeResult()),
    }));

    const { ingestState, runIngest } = await import('@/lib/ingest-state');
    expect(ingestState.status).toBe('idle');

    const promise = runIngest(['http://x/1.pdf']);
    expect(ingestState.status).toBe('running');

    await promise;
    expect(ingestState.status).toBe('done');
  });

  it('sets correct current/total counters after completion', async () => {
    vi.doMock('@/lib/ingest', () => ({
      ingestPdf: vi.fn()
        .mockResolvedValueOnce(makeResult({ label: '1 черга, І підчерга', items: 80 }))
        .mockResolvedValueOnce(makeResult({ label: '1 черга, ІІ підчерга', items: 120 })),
    }));

    const { ingestState, runIngest } = await import('@/lib/ingest-state');
    await runIngest(['http://x/1.pdf', 'http://x/2.pdf']);

    expect(ingestState.current).toBe(2);
    expect(ingestState.total).toBe(2);
    expect(ingestState.lastLabel).toBe('1 черга, ІІ підчерга');
    expect(ingestState.completedAt).toBeTruthy();
  });

  it('emits pdf-done for each PDF and done at the end', async () => {
    vi.doMock('@/lib/ingest', () => ({
      ingestPdf: vi.fn()
        .mockResolvedValueOnce(makeResult({ label: 'A', items: 10 }))
        .mockResolvedValueOnce(makeResult({ label: 'B', items: 20 })),
    }));

    const { ingestEvents, runIngest } = await import('@/lib/ingest-state');
    const pdfDoneEvents: unknown[] = [];
    const doneEvents: unknown[] = [];
    ingestEvents.on('pdf-done', (d) => pdfDoneEvents.push(d));
    ingestEvents.on('done', (d) => doneEvents.push(d));

    await runIngest(['http://x/1.pdf', 'http://x/2.pdf']);

    expect(pdfDoneEvents).toHaveLength(2);
    expect((pdfDoneEvents[0] as { label: string }).label).toBe('A');
    expect((pdfDoneEvents[1] as { label: string }).label).toBe('B');
    expect(doneEvents).toHaveLength(1);
    expect((doneEvents[0] as { totalItems: number }).totalItems).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Concurrent-call guard
// ---------------------------------------------------------------------------

describe('runIngest — concurrency guard', () => {
  it('ignores a second call while running', async () => {
    let resolveFirst!: () => void;
    const firstPdf = new Promise<ReturnType<typeof makeResult>>((res) => {
      resolveFirst = () => res(makeResult({ items: 10 }));
    });

    const mockIngestPdf = vi.fn().mockReturnValue(firstPdf);
    vi.doMock('@/lib/ingest', () => ({ ingestPdf: mockIngestPdf }));

    const { ingestState, runIngest } = await import('@/lib/ingest-state');

    // Start first run (won't complete until resolveFirst is called)
    const firstRun = runIngest(['http://x/1.pdf']);
    expect(ingestState.status).toBe('running');

    // Second call while first is running should return immediately
    await runIngest(['http://x/2.pdf']);
    expect(mockIngestPdf).toHaveBeenCalledTimes(1); // only the first URL was attempted

    resolveFirst();
    await firstRun;
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('runIngest — error path', () => {
  it('sets status=error and emits ingest-error when all PDFs fail', async () => {
    vi.doMock('@/lib/ingest', () => ({
      ingestPdf: vi.fn().mockRejectedValue(new Error('network timeout')),
    }));

    const { ingestState, ingestEvents, runIngest } = await import('@/lib/ingest-state');
    const errorEvents: unknown[] = [];
    ingestEvents.on('ingest-error', (d) => errorEvents.push(d));

    await runIngest(['http://x/1.pdf', 'http://x/2.pdf']);

    expect(ingestState.status).toBe('error');
    expect(ingestState.error).toMatch(/All 2 PDF ingestions failed/);
    expect(errorEvents).toHaveLength(1);
  });

  it('completes successfully when only some PDFs fail (partial corpus)', async () => {
    vi.doMock('@/lib/ingest', () => ({
      ingestPdf: vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce(makeResult({ items: 50 })),
    }));

    const { ingestState, runIngest } = await import('@/lib/ingest-state');
    await runIngest(['http://x/1.pdf', 'http://x/2.pdf']);

    expect(ingestState.status).toBe('done');
    expect(ingestState.completedAt).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail with "Cannot find module"**

```bash
npm test -- tests/ingest-state.test.ts 2>&1 | tail -10
```
Expected: FAIL — `Cannot find module '@/lib/ingest-state'`

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/ingest-state.test.ts
git commit -m "test(ingest-state): add failing tests for runIngest"
```

---

## Task 3: Implement `src/lib/ingest-state.ts`

**Files:**
- Create: `src/lib/ingest-state.ts`

- [ ] **Step 1: Create `src/lib/ingest-state.ts`**

```ts
import { EventEmitter } from 'node:events';
import { ingestPdf } from './ingest';

export type IngestStatus = 'idle' | 'running' | 'done' | 'error';

export interface IngestState {
  status: IngestStatus;
  current: number;
  total: number;
  lastLabel: string;
  completedAt: string | null;
  error: string | null;
}

export const ingestState: IngestState = {
  status: 'idle',
  current: 0,
  total: 0,
  lastLabel: '',
  completedAt: null,
  error: null,
};

export const ingestEvents = new EventEmitter();

export async function runIngest(urls: string[]): Promise<void> {
  if (ingestState.status === 'running') return;

  ingestState.status = 'running';
  ingestState.current = 0;
  ingestState.total = urls.length;
  ingestState.lastLabel = '';
  ingestState.error = null;

  let successCount = 0;
  let totalItems = 0;
  const failures: string[] = [];

  for (const url of urls) {
    try {
      const result = await ingestPdf(url);
      successCount++;
      totalItems += result.items;
      ingestState.lastLabel = result.label;
      ingestEvents.emit('pdf-done', {
        current: ++ingestState.current,
        total: ingestState.total,
        label: result.label,
        items: result.items,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(msg);
      ingestState.current++;
      console.error(`[ingest-state] FAILED ${url}: ${msg}`);
    }
    await new Promise<void>((r) => setImmediate(r));
  }

  if (successCount === 0) {
    const message = `All ${urls.length} PDF ingestions failed: ${failures[0] ?? 'unknown error'}`;
    ingestState.status = 'error';
    ingestState.error = message;
    ingestEvents.emit('ingest-error', { message });
    return;
  }

  const completedAt = new Date().toISOString();
  ingestState.status = 'done';
  ingestState.completedAt = completedAt;
  ingestEvents.emit('done', { totalItems, completedAt });
}
```

- [ ] **Step 2: Run the new tests — all should pass**

```bash
npm test -- tests/ingest-state.test.ts --reporter=verbose 2>&1 | tail -20
```
Expected: all 5 tests in `ingest-state.test.ts` pass.

- [ ] **Step 3: Run the full test suite to verify no regressions**

```bash
npm test 2>&1 | tail -10
```
Expected: all 34 pre-existing tests + 5 new = 39 passing, 0 failing.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ingest-state.ts
git commit -m "feat(ingest-state): add IngestState singleton + runIngest"
```

---

## Task 4: Update `bootstrap.ts` — fire-and-forget + export `discoverUrls`

`bootstrap.ts` must export `discoverUrls` so the refresh route can call it, and must fire `runIngest` without blocking.

**Files:**
- Modify: `src/server/bootstrap.ts`

- [ ] **Step 1: Replace the content of `src/server/bootstrap.ts`**

```ts
import { runIngest } from '../lib/ingest-state';
import { discoverPdfUrls } from '../lib/pdf/discover';

export async function discoverUrls(): Promise<string[]> {
  const indexUrl = process.env.CHERKASY_INDEX_URL;
  const sampleUrl = process.env.CHERKASY_SAMPLE_PDF_URL;
  const urls: string[] = [];
  if (indexUrl) {
    const discovered = await discoverPdfUrls(indexUrl);
    urls.push(...discovered);
    console.log(`[bootstrap] discovered ${discovered.length} PDF URLs from ${indexUrl}`);
  }
  if (sampleUrl && !urls.includes(sampleUrl)) {
    urls.push(sampleUrl);
  }
  if (urls.length === 0) {
    throw new Error(
      'Neither CHERKASY_INDEX_URL nor CHERKASY_SAMPLE_PDF_URL is configured',
    );
  }
  return urls;
}

// Fire-and-forget on module load. The server is immediately available;
// the client overlay tracks progress via SSE.
discoverUrls()
  .then((urls) => runIngest(urls))
  .catch((err: Error) =>
    console.error('[bootstrap] failed to start ingest:', err.message),
  );
```

- [ ] **Step 2: Run the full test suite**

```bash
npm test 2>&1 | tail -10
```
Expected: 39 passing, 0 failing. (`discover.test.ts` still passes because `discoverPdfUrls` is unchanged.)

- [ ] **Step 3: Commit**

```bash
git add src/server/bootstrap.ts
git commit -m "feat(bootstrap): fire-and-forget ingest on startup, export discoverUrls"
```

---

## Task 5: Update `search/route.ts` — remove blocking bootstrap, add idle guard

**Files:**
- Modify: `src/app/api/search/route.ts`

- [ ] **Step 1: Replace the content of `src/app/api/search/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import '@/server/bootstrap'; // side-effect: trigger startup ingest
import { ingestState } from '@/lib/ingest-state';
import { searchItems } from '@/lib/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  q: z.string().min(1).max(120),
  kind: z.enum(['all', 'address', 'org', 'fop', 'person']).default('all'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get('q') ?? '',
    kind: url.searchParams.get('kind') ?? 'all',
    page: url.searchParams.get('page') ?? '1',
    pageSize: url.searchParams.get('pageSize') ?? '20',
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_query', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (ingestState.status === 'idle') {
    return NextResponse.json({ message: 'not_ready' }, { status: 503 });
  }

  const { q, kind, page, pageSize } = parsed.data;

  try {
    const response = searchItems(q, kind, page, pageSize);
    return NextResponse.json(response, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'search_failed';
    return NextResponse.json({ error: 'search_failed', message: msg }, { status: 500 });
  }
}
```

- [ ] **Step 2: Run the full test suite**

```bash
npm test 2>&1 | tail -10
```
Expected: 39 passing.

(`search.test.ts` seeds the DB directly and calls `searchItems` — it doesn't go through the route handler, so it's unaffected.)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/search/route.ts
git commit -m "feat(search): replace blocking ensureIngested with idle guard"
```

---

## Task 6: SSE stream endpoint — tests first, then implement

**Files:**
- Create: `tests/ingest-stream.test.ts`
- Create: `src/app/api/ingest/stream/route.ts`

- [ ] **Step 1: Create `tests/ingest-stream.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

beforeEach(() => {
  vi.resetModules();
});

function makeStateMock(status: string, current = 3, total = 12) {
  const ingestEvents = new EventEmitter();
  const ingestState = { status, current, total, lastLabel: 'тест', completedAt: null, error: null };
  return { ingestState, ingestEvents, runIngest: vi.fn() };
}

async function readChunk(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const { value } = await reader.read();
  reader.cancel();
  return new TextDecoder().decode(value);
}

describe('GET /api/ingest/stream', () => {
  it('sends an init event with the current state snapshot on connect', async () => {
    vi.doMock('@/lib/ingest-state', () => makeStateMock('running'));

    const { GET } = await import('@/app/api/ingest/stream/route');
    const res = await GET();

    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await readChunk(res.body!);
    expect(text).toContain('event: init');
    expect(text).toContain('"status":"running"');
    expect(text).toContain('"current":3');
    expect(text).toContain('"total":12');
  });

  it('closes immediately when init status is done', async () => {
    vi.doMock('@/lib/ingest-state', () => makeStateMock('done'));

    const { GET } = await import('@/app/api/ingest/stream/route');
    const res = await GET();
    const reader = res.body!.getReader();

    // Read init chunk
    await reader.read();
    // Next read should signal stream is closed
    const { done } = await reader.read();
    expect(done).toBe(true);
  });

  it('forwards pdf-done events from ingestEvents', async () => {
    const mock = makeStateMock('running');
    vi.doMock('@/lib/ingest-state', () => mock);

    const { GET } = await import('@/app/api/ingest/stream/route');
    const res = await GET();
    const reader = res.body!.getReader();

    // Consume init
    await reader.read();

    // Emit a pdf-done event on the mock EventEmitter
    setImmediate(() =>
      mock.ingestEvents.emit('pdf-done', { current: 4, total: 12, label: 'X', items: 99 }),
    );

    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('event: pdf-done');
    expect(text).toContain('"current":4');

    reader.cancel();
  });

  it('removes event listeners when stream is cancelled (no leak)', async () => {
    const mock = makeStateMock('running');
    vi.doMock('@/lib/ingest-state', () => mock);

    const { GET } = await import('@/app/api/ingest/stream/route');
    const res = await GET();
    const reader = res.body!.getReader();

    // Consume init
    await reader.read();
    expect(mock.ingestEvents.listenerCount('pdf-done')).toBe(1);

    await reader.cancel();
    // Give microtask queue a tick to run the cancel callback
    await new Promise((r) => setTimeout(r, 0));

    expect(mock.ingestEvents.listenerCount('pdf-done')).toBe(0);
    expect(mock.ingestEvents.listenerCount('done')).toBe(0);
    expect(mock.ingestEvents.listenerCount('ingest-error')).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- tests/ingest-stream.test.ts 2>&1 | tail -10
```
Expected: FAIL — `Cannot find module '@/app/api/ingest/stream/route'`

- [ ] **Step 3: Create `src/app/api/ingest/stream/route.ts`**

```ts
import { ingestState, ingestEvents } from '@/lib/ingest-state';
import '@/server/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fmt(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function GET() {
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      function safeEnqueue(chunk: Uint8Array) {
        if (!closed) {
          try {
            controller.enqueue(chunk);
          } catch {
            closed = true;
          }
        }
      }

      function safeClose() {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {}
        }
      }

      // Send current state immediately so clients don't wait for the next event.
      safeEnqueue(
        fmt('init', {
          status: ingestState.status,
          current: ingestState.current,
          total: ingestState.total,
          lastLabel: ingestState.lastLabel,
          completedAt: ingestState.completedAt,
        }),
      );

      if (ingestState.status === 'done' || ingestState.status === 'error') {
        safeClose();
        return;
      }

      function onPdfDone(data: unknown) {
        safeEnqueue(fmt('pdf-done', data));
      }
      function onDone(data: unknown) {
        safeEnqueue(fmt('done', data));
        safeClose();
        doCleanup();
      }
      function onError(data: unknown) {
        safeEnqueue(fmt('ingest-error', data));
        safeClose();
        doCleanup();
      }

      function doCleanup() {
        ingestEvents.off('pdf-done', onPdfDone);
        ingestEvents.off('done', onDone);
        ingestEvents.off('ingest-error', onError);
      }

      cleanup = doCleanup;

      ingestEvents.on('pdf-done', onPdfDone);
      ingestEvents.on('done', onDone);
      ingestEvents.on('ingest-error', onError);
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}
```

- [ ] **Step 4: Run stream tests**

```bash
npm test -- tests/ingest-stream.test.ts --reporter=verbose 2>&1 | tail -20
```
Expected: all 4 tests pass.

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -10
```
Expected: 43 passing (39 previous + 4 new).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/ingest/stream/route.ts tests/ingest-stream.test.ts
git commit -m "feat(api): add SSE /api/ingest/stream endpoint"
```

---

## Task 7: Refresh endpoint — tests first, then implement

**Files:**
- Create: `tests/ingest-refresh.test.ts`
- Create: `src/app/api/ingest/refresh/route.ts`

- [ ] **Step 1: Create `tests/ingest-refresh.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('POST /api/ingest/refresh', () => {
  it('returns 202 and fires runIngest when status is idle', async () => {
    const runIngest = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/ingest-state', () => ({
      ingestState: { status: 'idle' },
      runIngest,
    }));
    vi.doMock('@/server/bootstrap', () => ({
      discoverUrls: vi.fn().mockResolvedValue(['http://x/1.pdf', 'http://x/2.pdf']),
    }));

    const { POST } = await import('@/app/api/ingest/refresh/route');
    const res = await POST();

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.message).toBe('started');

    // Give the fire-and-forget promise a tick to start
    await new Promise((r) => setTimeout(r, 10));
    expect(runIngest).toHaveBeenCalledWith(['http://x/1.pdf', 'http://x/2.pdf']);
  });

  it('returns 202 and fires runIngest when status is done (re-ingest allowed)', async () => {
    const runIngest = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@/lib/ingest-state', () => ({
      ingestState: { status: 'done' },
      runIngest,
    }));
    vi.doMock('@/server/bootstrap', () => ({
      discoverUrls: vi.fn().mockResolvedValue(['http://x/1.pdf']),
    }));

    const { POST } = await import('@/app/api/ingest/refresh/route');
    const res = await POST();

    expect(res.status).toBe(202);
  });

  it('returns 409 when already running', async () => {
    vi.doMock('@/lib/ingest-state', () => ({
      ingestState: { status: 'running' },
      runIngest: vi.fn(),
    }));
    vi.doMock('@/server/bootstrap', () => ({
      discoverUrls: vi.fn(),
    }));

    const { POST } = await import('@/app/api/ingest/refresh/route');
    const res = await POST();

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.message).toBe('already_running');
  });
});
```

- [ ] **Step 2: Confirm tests fail**

```bash
npm test -- tests/ingest-refresh.test.ts 2>&1 | tail -10
```
Expected: FAIL — `Cannot find module '@/app/api/ingest/refresh/route'`

- [ ] **Step 3: Create `src/app/api/ingest/refresh/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { ingestState, runIngest } from '@/lib/ingest-state';
import { discoverUrls } from '@/server/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST() {
  if (ingestState.status === 'running') {
    return NextResponse.json({ message: 'already_running' }, { status: 409 });
  }

  discoverUrls()
    .then((urls) => runIngest(urls))
    .catch((err: Error) =>
      console.error('[refresh] failed to start ingest:', err.message),
    );

  return NextResponse.json({ message: 'started' }, { status: 202 });
}
```

- [ ] **Step 4: Run refresh tests**

```bash
npm test -- tests/ingest-refresh.test.ts --reporter=verbose 2>&1 | tail -15
```
Expected: all 3 tests pass.

- [ ] **Step 5: Run full suite**

```bash
npm test 2>&1 | tail -10
```
Expected: 46 passing.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/ingest/refresh/route.ts tests/ingest-refresh.test.ts
git commit -m "feat(api): add POST /api/ingest/refresh endpoint"
```

---

## Task 8: Create `IngestOverlay.tsx` and `ClientShell.tsx`

`page.tsx` is a Server Component — it can't hold React state. `ClientShell.tsx` is the client boundary that owns overlay visibility and passes the completed timestamp down to `SearchBox`.

**Files:**
- Create: `src/components/IngestOverlay.tsx`
- Create: `src/components/ClientShell.tsx`

- [ ] **Step 1: Create `src/components/IngestOverlay.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface IngestOverlayProps {
  onReady: (completedAt: string) => void;
}

interface InitPayload {
  status: string;
  current: number;
  total: number;
  lastLabel: string;
  completedAt: string | null;
}

interface PdfDonePayload {
  current: number;
  total: number;
  label: string;
  items: number;
}

interface DonePayload {
  totalItems: number;
  completedAt: string;
}

type OverlayStatus = 'connecting' | 'running' | 'done' | 'error';

export function IngestOverlay({ onReady }: IngestOverlayProps) {
  const [status, setStatus] = useState<OverlayStatus>('connecting');
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [lastLabel, setLastLabel] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [retrying, setRetrying] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  function connect() {
    esRef.current?.close();
    const es = new EventSource('/api/ingest/stream');
    esRef.current = es;

    es.addEventListener('init', (e: MessageEvent) => {
      const data: InitPayload = JSON.parse(e.data);
      setCurrent(data.current);
      setTotal(data.total);
      setLastLabel(data.lastLabel);
      if (data.status === 'done') {
        es.close();
        onReady(data.completedAt!);
        return;
      }
      if (data.status === 'error') {
        setStatus('error');
        es.close();
        return;
      }
      setStatus('running');
    });

    es.addEventListener('pdf-done', (e: MessageEvent) => {
      const data: PdfDonePayload = JSON.parse(e.data);
      setCurrent(data.current);
      setTotal(data.total);
      setLastLabel(data.label);
    });

    es.addEventListener('done', (e: MessageEvent) => {
      const data: DonePayload = JSON.parse(e.data);
      setStatus('done');
      es.close();
      setTimeout(() => onReady(data.completedAt), 800);
    });

    es.addEventListener('ingest-error', (e: MessageEvent) => {
      const data: { message: string } = JSON.parse(e.data);
      setStatus('error');
      setErrorMsg(data.message);
      es.close();
    });
  }

  useEffect(() => {
    connect();
    return () => esRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRetry() {
    setRetrying(true);
    try {
      const res = await fetch('/api/ingest/refresh', { method: 'POST' });
      if (res.ok || res.status === 409) {
        setStatus('running');
        setErrorMsg('');
        connect();
      }
    } finally {
      setRetrying(false);
    }
  }

  const pct = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/95 backdrop-blur-sm">
      <div className="w-full max-w-sm mx-4 p-8 bg-white rounded-2xl shadow-xl border border-slate-100 text-center">
        {status === 'done' ? (
          <p className="text-green-700 font-medium">✓ Дані завантажено</p>
        ) : status === 'error' ? (
          <>
            <p className="text-rose-700 text-sm mb-4">
              {errorMsg || 'Помилка завантаження даних'}
            </p>
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="px-4 py-2 bg-sky-600 text-white text-sm rounded-lg hover:bg-sky-700 disabled:opacity-50"
            >
              {retrying ? 'Зачекайте…' : 'Спробувати ще раз'}
            </button>
          </>
        ) : (
          <>
            <Loader2 className="w-8 h-8 text-sky-500 animate-spin mx-auto mb-4" />
            <h2 className="text-base font-medium text-slate-800 mb-1">
              Підготовка бази даних…
            </h2>
            {total > 0 && (
              <>
                <div className="w-full bg-slate-100 rounded-full h-2 my-4 overflow-hidden">
                  <div
                    className="bg-sky-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-sm text-slate-600">
                  {current} / {total} PDF
                </p>
                {lastLabel && (
                  <p className="text-xs text-slate-400 mt-1 truncate">{lastLabel}</p>
                )}
              </>
            )}
            <p className="text-xs text-slate-400 mt-4">
              Після завершення пошук стане доступним автоматично.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/ClientShell.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { SearchBox } from './SearchBox';
import { IngestOverlay } from './IngestOverlay';

export function ClientShell() {
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [completedAt, setCompletedAt] = useState<string | null>(null);

  function handleReady(ts: string) {
    setCompletedAt(ts);
    setOverlayVisible(false);
  }

  return (
    <>
      {overlayVisible && <IngestOverlay onReady={handleReady} />}
      <SearchBox
        refreshedAt={completedAt}
        onRefreshStart={() => setOverlayVisible(true)}
      />
    </>
  );
}
```

- [ ] **Step 3: Run the full test suite (no UI tests, just verify nothing broke)**

```bash
npm test 2>&1 | tail -10
```
Expected: 46 passing.

- [ ] **Step 4: Commit**

```bash
git add src/components/IngestOverlay.tsx src/components/ClientShell.tsx
git commit -m "feat(ui): add IngestOverlay and ClientShell components"
```

---

## Task 9: Update `page.tsx` and `SearchBox.tsx`

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/SearchBox.tsx`

- [ ] **Step 1: Replace `src/app/page.tsx`**

```tsx
import { ClientShell } from '@/components/ClientShell';

export default function Page() {
  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-3xl">
        <header className="mb-8 text-center">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
            Пошук черги відключень електроенергії
          </h1>
          <p className="mt-2 text-sm sm:text-base text-slate-600">
            Дані з графіків АТ «Черкасиобленерго». Введіть свою адресу, назву
            організації, ФОП або призвище — ми покажемо, до якої черги та
            підчерги ви належите.
          </p>
        </header>
        <div className="flex justify-center">
          <ClientShell />
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Add `refreshedAt` / `onRefreshStart` props to `SearchBox.tsx`**

Add the interface above the `SearchBox` function and update its signature. Also add `refreshing` state, a `useEffect` to reset it, `handleRefresh`, and the refresh link row.

At the top of `src/components/SearchBox.tsx`, after the existing imports, add:

```tsx
interface SearchBoxProps {
  refreshedAt: string | null;
  onRefreshStart: () => void;
}
```

Change the function signature from:
```tsx
export function SearchBox() {
```
to:
```tsx
export function SearchBox({ refreshedAt, onRefreshStart }: SearchBoxProps) {
```

Inside the function body, add the new state and handler after the existing `useState` / `useEffect` declarations (before the `totalPages` line):

```tsx
const [refreshing, setRefreshing] = useState(false);

// Reset refreshing when parent passes a new completedAt timestamp.
useEffect(() => {
  if (refreshedAt) setRefreshing(false);
}, [refreshedAt]);

async function handleRefresh() {
  setRefreshing(true);
  try {
    const res = await fetch('/api/ingest/refresh', { method: 'POST' });
    if (res.ok || res.status === 409) {
      onRefreshStart();
    } else {
      setRefreshing(false);
    }
  } catch {
    setRefreshing(false);
  }
}
```

After the closing `</div>` of the chips row (around line 115, after the `CHIPS.map(...)` section), add the refresh link row:

```tsx
      <div className="mt-2 flex justify-end items-center gap-2 text-xs text-slate-400">
        {refreshedAt && <span>Оновлено: {formatDate(refreshedAt)}</span>}
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="hover:text-slate-600 disabled:opacity-50 transition-colors"
          aria-label="Оновити дані"
        >
          {refreshing ? 'Оновлення…' : '↺ Оновити'}
        </button>
      </div>
```

- [ ] **Step 3: Run the full test suite**

```bash
npm test 2>&1 | tail -10
```
Expected: 46 passing.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/components/SearchBox.tsx
git commit -m "feat(ui): wire IngestOverlay into page, add refresh link to SearchBox"
```

---

## Task 10: End-to-end smoke test

- [ ] **Step 1: Wipe the SQLite DB to force a cold-start**

```bash
rm -f data/cherkasy.sqlite data/cherkasy.sqlite-shm data/cherkasy.sqlite-wal
```

- [ ] **Step 2: Start the dev server**

```bash
npm run dev
```
Watch the terminal output. Within a few seconds you should see:
```
[bootstrap] discovered 12 PDF URLs from ...
[ingest-state] ...
```
The server itself starts immediately (no blocking).

- [ ] **Step 3: Open `http://localhost:3000` in a browser**

Expected:
- Full-page overlay appears immediately: "Підготовка бази даних…"
- Progress bar advances as each PDF is ingested (X / 12 PDF)
- Current queue label updates below the bar
- After ~13–20 s: "✓ Дані завантажено" flashes, then overlay fades out and search box is usable

- [ ] **Step 4: Verify search works**

Type `Ювілейна` in the search box. Expect paginated results.

- [ ] **Step 5: Verify the refresh link**

Click "↺ Оновити" below the chips. Expected:
- Overlay reappears
- Ingest runs again (all PDFs skip due to sha256 match — completes in ~1–2 s)
- Overlay closes, "Оновлено: DD.MM.YYYY" timestamp updates

- [ ] **Step 6: Verify 409 on double-refresh**

While an ingest is running (slow network), click "↺ Оновити" twice quickly. The second click should be a no-op (overlay stays on the already-running ingest).

- [ ] **Step 7: Run the final full test suite**

```bash
npm test 2>&1 | tail -10
```
Expected: 46 passing, 0 failing.

- [ ] **Step 8: Push `step3` branch**

```bash
git push -u origin step3
```
