import { runIngest, ingestState } from '../lib/ingest-state';
import { discoverPdfUrls } from '../lib/pdf/discover';

export async function discoverUrls(): Promise<string[]> {
  const indexUrl = process.env.CHERKASY_INDEX_URL;
  const sampleUrl = process.env.CHERKASY_SAMPLE_PDF_URL;
  const urls: string[] = [];
  if (indexUrl) {
    const discovered = await discoverPdfUrls(indexUrl);
    urls.push(...discovered);
    console.log(`[bootstrap] discovered ${discovered.length} PDF URLs from ${indexUrl}`);
  }
  if (sampleUrl && !urls.includes(sampleUrl)) {
    urls.push(sampleUrl);
  }
  if (urls.length === 0) {
    throw new Error(
      'Neither CHERKASY_INDEX_URL nor CHERKASY_SAMPLE_PDF_URL is configured',
    );
  }
  return urls;
}

// E2E fixture mode: set CHERKASY_E2E_SEED_COMPLETED_AT to an ISO timestamp to
// skip real PDF ingestion and mark the DB as ready. The SSE stream will emit
// init{status:'done'} immediately so the overlay closes, and /api/search will
// serve results from the pre-seeded DATA_DIR database.
const e2eSeedCompletedAt = process.env.CHERKASY_E2E_SEED_COMPLETED_AT;
if (e2eSeedCompletedAt) {
  ingestState.status = 'done';
  ingestState.completedAt = e2eSeedCompletedAt;
} else {
  // Fire-and-forget on module load. The server is immediately available;
  // the client overlay tracks progress via SSE.
  discoverUrls()
    .then((urls) => runIngest(urls))
    .catch((err: Error) =>
      console.error('[bootstrap] failed to start ingest:', err.message),
    );
}
