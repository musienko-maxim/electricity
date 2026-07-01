import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('POST /api/ingest/refresh', () => {
  it('returns 202 and calls startIngest when status is idle', async () => {
    const startIngest = vi.fn().mockReturnValue(undefined);
    vi.doMock('@/lib/ingest-state', () => ({
      ingestState: { status: 'idle' },
      runIngest: vi.fn(),
    }));
    vi.doMock('@/server/bootstrap', () => ({ startIngest, discoverUrls: vi.fn() }));

    const { POST } = await import('@/app/api/ingest/refresh/route');
    const res = await POST();

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.message).toBe('started');
    expect(startIngest).toHaveBeenCalledOnce();
  });

  it('returns 202 and calls startIngest when status is done (re-ingest allowed)', async () => {
    const startIngest = vi.fn().mockReturnValue(undefined);
    vi.doMock('@/lib/ingest-state', () => ({
      ingestState: { status: 'done' },
      runIngest: vi.fn(),
    }));
    vi.doMock('@/server/bootstrap', () => ({
      startIngest,
      discoverUrls: vi.fn(),
    }));

    const { POST } = await import('@/app/api/ingest/refresh/route');
    const res = await POST();

    expect(res.status).toBe(202);
    expect(startIngest).toHaveBeenCalledOnce();
  });

  it('returns 429 when a refresh is requested within the cooldown of the last ingest start', async () => {
    const startIngest = vi.fn();
    vi.doMock('@/lib/ingest-state', () => ({
      // A run started moments ago (not currently running).
      ingestState: { status: 'done', lastStartedAt: Date.now() - 1_000 },
      runIngest: vi.fn(),
    }));
    vi.doMock('@/server/bootstrap', () => ({ startIngest, discoverUrls: vi.fn() }));

    const { POST } = await import('@/app/api/ingest/refresh/route');
    const res = await POST();

    expect(res.status).toBe(429);
    expect((await res.json()).message).toBe('rate_limited');
    expect(startIngest).not.toHaveBeenCalled();
  });

  it('allows a refresh once the cooldown has elapsed', async () => {
    const startIngest = vi.fn();
    vi.doMock('@/lib/ingest-state', () => ({
      ingestState: { status: 'done', lastStartedAt: Date.now() - 10 * 60_000 },
      runIngest: vi.fn(),
    }));
    vi.doMock('@/server/bootstrap', () => ({ startIngest, discoverUrls: vi.fn() }));

    const { POST } = await import('@/app/api/ingest/refresh/route');
    const res = await POST();

    expect(res.status).toBe(202);
    expect(startIngest).toHaveBeenCalledOnce();
  });

  it('returns 409 when already running and does NOT call startIngest', async () => {
    const startIngest = vi.fn();
    vi.doMock('@/lib/ingest-state', () => ({
      ingestState: { status: 'running' },
      runIngest: vi.fn(),
    }));
    vi.doMock('@/server/bootstrap', () => ({
      startIngest,
      discoverUrls: vi.fn(),
    }));

    const { POST } = await import('@/app/api/ingest/refresh/route');
    const res = await POST();

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.message).toBe('already_running');
    expect(startIngest).not.toHaveBeenCalled();
  });
});
