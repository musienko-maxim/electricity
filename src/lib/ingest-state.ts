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
  ingestState.completedAt = null;

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
