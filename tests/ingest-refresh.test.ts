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
