import { NextResponse } from 'next/server';
import { ingestState, runIngest } from '@/lib/ingest-state';
import { discoverUrls } from '@/server/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST() {
  if (ingestState.status === 'running') {
    return NextResponse.json({ message: 'already_running' }, { status: 409 });
  }

  discoverUrls()
    .then((urls) => runIngest(urls))
    .catch((err: Error) =>
      console.error('[refresh] failed to start ingest:', err.message),
    );

  return NextResponse.json({ message: 'started' }, { status: 202 });
}
