import { ingestPdf } from '../lib/ingest';

let bootstrapPromise: Promise<void> | null = null;

// Lazy: ingest the configured sample PDF on first call. Subsequent calls await
// the same promise so concurrent requests don't ingest twice.
export function ensureIngested(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    const url = process.env.CHERKASY_SAMPLE_PDF_URL;
    if (!url) {
      throw new Error('CHERKASY_SAMPLE_PDF_URL is not set');
    }
    const result = await ingestPdf(url);
    console.log(
      `[bootstrap] ingest ${result.skipped ? 'skipped' : 'done'}: queue=${result.queueId} entries=${result.entries} items=${result.items}`,
    );
  })().catch((err) => {
    // Reset on failure so the next request retries.
    bootstrapPromise = null;
    throw err;
  });

  return bootstrapPromise;
}
