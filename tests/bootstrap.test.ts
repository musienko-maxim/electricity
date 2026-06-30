import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('startIngest', () => {
  it('invokes runIngest with the discoverUrls thunk', async () => {
    const runIngest = vi.fn().mockReturnValue(undefined);
    vi.doMock('@/lib/ingest-state', () => ({
      ingestState: { status: 'idle', current: 0, total: 0, lastLabel: '', completedAt: null, error: null },
      ingestEvents: new (require('node:events').EventEmitter)(),
      runIngest,
    }));
    // Prevent real network calls inside discoverUrls
    vi.doMock('@/lib/pdf/discover', () => ({
      discoverPdfUrls: vi.fn().mockResolvedValue([]),
    }));

    const { startIngest, discoverUrls } = await import('@/server/bootstrap');

    // Clear calls from the module-level fire-and-forget so we can assert
    // that our explicit startIngest() invocation passes discoverUrls.
    runIngest.mockClear();
    await startIngest();

    expect(runIngest).toHaveBeenCalledOnce();
    expect(runIngest).toHaveBeenCalledWith(discoverUrls);
  });
});
