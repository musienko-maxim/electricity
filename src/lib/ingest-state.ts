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
  // Epoch ms when the last ingest run began; drives the refresh rate-limit.
  lastStartedAt: number | null;
}

export const ingestState: IngestState = {
  status: 'idle',
  current: 0,
  total: 0,
  lastLabel: '',
  completedAt: null,
  error: null,
  lastStartedAt: null,
};

export const ingestEvents = new EventEmitter();

/** URLs to ingest, or a thunk that discovers them. */
export type IngestUrls = string[] | (() => Promise<string[]>);

export async function runIngest(input: IngestUrls): Promise<void> {
  if (ingestState.status === 'running') return;

  // Flip to 'running' synchronously — before awaiting discovery — so a stream
  // or search that observes state right after a refresh request sees 'running',
  // never the stale prior 'done'/'error'. completedAt is intentionally NOT
  // reset: it marks the last *successful* ingest, so a re-run (or a re-run that
  // fails) keeps serving the previously loaded data.
  ingestState.status = 'running';
  ingestState.current = 0;
  ingestState.total = 0;
  ingestState.lastLabel = '';
  ingestState.error = null;
  ingestState.lastStartedAt = Date.now();

  let urls: string[];
  try {
    urls = typeof input === 'function' ? await input() : input;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ingestState.status = 'error';
    ingestState.error = message;
    ingestEvents.emit('ingest-error', { message });
    console.error(`[ingest-state] discovery failed: ${message}`);
    return;
  }

  ingestState.total = urls.length;

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
      ++ingestState.current;
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
