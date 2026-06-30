import { NextResponse } from 'next/server';
import { ingestState, runIngest } from '@/lib/ingest-state';
import { discoverUrls } from '@/server/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST() {
  if (ingestState.status === 'running') {
    return NextResponse.json({ message: 'already_running' }, { status: 409 });
  }

  // Pass the discovery thunk (not `await discoverUrls()`) so runIngest flips
  // status to 'running' synchronously, before this response returns and the
  // client opens the SSE stream — otherwise the stream's init reads the stale
  // prior 'done'/'error' and the overlay closes without showing progress.
  // Promise.resolve(...) guards against a non-promise return (e.g. in tests).
  Promise.resolve(runIngest(discoverUrls)).catch((err: Error) =>
    console.error('[refresh] failed to start ingest:', err.message),
  );

  return NextResponse.json({ message: 'started' }, { status: 202 });
}
