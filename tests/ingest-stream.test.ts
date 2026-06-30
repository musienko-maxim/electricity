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
