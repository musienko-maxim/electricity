import { NextResponse } from 'next/server';
import { ingestState } from '@/lib/ingest-state';
import { startIngest } from '@/server/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST() {
  if (ingestState.status === 'running') {
    return NextResponse.json({ message: 'already_running' }, { status: 409 });
  }

  // startIngest passes discoverUrls as a thunk so runIngest flips status to
  // 'running' synchronously — before this response returns and the client
  // opens the SSE stream — preventing the stream's init from reading a stale
  // prior 'done'/'error' and closing immediately without showing progress.
  startIngest();

  return NextResponse.json({ message: 'started' }, { status: 202 });
}
