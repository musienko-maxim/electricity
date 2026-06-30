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
// Eager status flip (refresh-race fix)
// ---------------------------------------------------------------------------

describe('runIngest — eager status flip with a urls thunk', () => {
  it('flips status to running synchronously, before the urls thunk resolves', async () => {
    vi.doMock('@/lib/ingest', () => ({
      ingestPdf: vi.fn().mockResolvedValue(makeResult()),
    }));

    const { ingestState, runIngest } = await import('@/lib/ingest-state');

    let resolveUrls!: (u: string[]) => void;
    const urlsThunk = () =>
      new Promise<string[]>((res) => {
        resolveUrls = res;
      });

    // Don't await — status must already be 'running' while discovery is pending,
    // so a stream/search observing state right after refresh sees 'running',
    // never the stale prior 'done'/'error'.
    const run = runIngest(urlsThunk);
    expect(ingestState.status).toBe('running');

    resolveUrls(['http://x/1.pdf']);
    await run;
    expect(ingestState.status).toBe('done');
  });

  it('surfaces a discovery failure as error state instead of getting stuck running', async () => {
    vi.doMock('@/lib/ingest', () => ({ ingestPdf: vi.fn() }));

    const { ingestState, ingestEvents, runIngest } = await import('@/lib/ingest-state');
    const errorEvents: unknown[] = [];
    ingestEvents.on('ingest-error', (d) => errorEvents.push(d));

    await runIngest(() => Promise.reject(new Error('no urls configured')));

    expect(ingestState.status).toBe('error');
    expect(ingestState.error).toMatch(/no urls configured/);
    expect(errorEvents).toHaveLength(1);
  });

  it('preserves the previous completedAt while re-running (serves stale data during refresh)', async () => {
    vi.doMock('@/lib/ingest', () => ({
      ingestPdf: vi.fn().mockResolvedValue(makeResult()),
    }));

    const { ingestState, runIngest } = await import('@/lib/ingest-state');
    await runIngest(['http://x/1.pdf']);
    const firstCompletedAt = ingestState.completedAt;
    expect(firstCompletedAt).toBeTruthy();

    // Begin a second run with a pending thunk; completedAt must remain set.
    let resolveUrls!: (u: string[]) => void;
    const run = runIngest(() => new Promise<string[]>((res) => { resolveUrls = res; }));
    expect(ingestState.status).toBe('running');
    expect(ingestState.completedAt).toBe(firstCompletedAt);

    resolveUrls(['http://x/1.pdf']);
    await run;
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
