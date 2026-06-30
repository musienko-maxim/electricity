import { runIngest } from '../lib/ingest-state';
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

/** Starts a fire-and-forget ingest run, passing the discovery thunk so that
 *  runIngest flips status to 'running' synchronously before any await. */
export function startIngest(): Promise<void> {
  return Promise.resolve(runIngest(discoverUrls)).catch((err: Error) =>
    console.error('[ingest] failed to start:', err.message),
  );
}

// Fire-and-forget on module load. The server is immediately available;
// the client overlay tracks progress via SSE.
startIngest();
