import { NextResponse } from 'next/server';
import { ingestState } from '@/lib/ingest-state';
import { startIngest } from '@/server/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Minimum gap between the start of one ingest and an allowed manual refresh.
// The 409 guard already blocks concurrent runs; this additionally throttles
// rapid repeat triggers so an unauthenticated caller can't spin up a storm of
// outbound PDF fetches + parsing.
const REFRESH_COOLDOWN_MS = 60_000;

export function POST() {
  if (ingestState.status === 'running') {
    return NextResponse.json({ message: 'already_running' }, { status: 409 });
  }

  if (
    ingestState.lastStartedAt !== null &&
    Date.now() - ingestState.lastStartedAt < REFRESH_COOLDOWN_MS
  ) {
    return NextResponse.json({ message: 'rate_limited' }, { status: 429 });
  }

  // startIngest passes discoverUrls as a thunk so runIngest flips status to
  // 'running' synchronously — before this response returns and the client
  // opens the SSE stream — preventing the stream's init from reading a stale
  // prior 'done'/'error' and closing immediately without showing progress.
  startIngest();

  return NextResponse.json({ message: 'started' }, { status: 202 });
}
