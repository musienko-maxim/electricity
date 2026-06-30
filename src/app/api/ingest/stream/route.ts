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
