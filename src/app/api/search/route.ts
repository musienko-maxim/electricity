import { NextResponse } from 'next/server';
import { z } from 'zod';
import '@/server/bootstrap'; // side-effect: trigger startup ingest
import { ingestState } from '@/lib/ingest-state';
import { searchItems } from '@/lib/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  q: z.string().min(1).max(120),
  kind: z.enum(['all', 'address', 'org', 'fop', 'person']).default('all'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get('q') ?? '',
    kind: url.searchParams.get('kind') ?? 'all',
    page: url.searchParams.get('page') ?? '1',
    pageSize: url.searchParams.get('pageSize') ?? '20',
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_query', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (ingestState.status === 'idle') {
    return NextResponse.json({ message: 'not_ready' }, { status: 503 });
  }

  const { q, kind, page, pageSize } = parsed.data;

  try {
    const response = searchItems(q, kind, page, pageSize);
    return NextResponse.json(response, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'search_failed';
    return NextResponse.json({ error: 'search_failed', message: msg }, { status: 500 });
  }
}
