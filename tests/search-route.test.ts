import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

function req(q = 'Шевченка') {
  return new Request(`http://localhost/api/search?q=${encodeURIComponent(q)}`);
}

describe('GET /api/search — readiness gate', () => {
  it('returns 503 not_ready when no ingest has ever completed (error state, empty db)', async () => {
    vi.doMock('@/server/bootstrap', () => ({})); // suppress startup side-effect
    vi.doMock('@/lib/ingest-state', () => ({
      ingestState: { status: 'error', completedAt: null },
    }));
    const searchItems = vi.fn();
    vi.doMock('@/lib/search', () => ({ searchItems }));

    const { GET } = await import('@/app/api/search/route');
    const res = await GET(req());

    expect(res.status).toBe(503);
    expect((await res.json()).message).toBe('not_ready');
    // Must NOT silently return empty 200 from an empty/never-loaded DB.
    expect(searchItems).not.toHaveBeenCalled();
  });

  it('returns 503 not_ready during cold-start ingest (running, nothing completed yet)', async () => {
    vi.doMock('@/server/bootstrap', () => ({}));
    vi.doMock('@/lib/ingest-state', () => ({
      ingestState: { status: 'running', completedAt: null },
    }));
    const searchItems = vi.fn();
    vi.doMock('@/lib/search', () => ({ searchItems }));

    const { GET } = await import('@/app/api/search/route');
    const res = await GET(req());

    expect(res.status).toBe(503);
    expect(searchItems).not.toHaveBeenCalled();
  });

  it('serves results during a re-ingest when a previous ingest completed (stale data ok)', async () => {
    vi.doMock('@/server/bootstrap', () => ({}));
    vi.doMock('@/lib/ingest-state', () => ({
      ingestState: { status: 'running', completedAt: '2026-06-01T00:00:00.000Z' },
    }));
    const searchItems = vi
      .fn()
      .mockReturnValue({ results: [], total: 0, page: 1, pageSize: 20 });
    vi.doMock('@/lib/search', () => ({ searchItems }));

    const { GET } = await import('@/app/api/search/route');
    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(searchItems).toHaveBeenCalledOnce();
  });
});
