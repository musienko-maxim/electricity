import { ingestPdf } from '../lib/ingest';
import { discoverPdfUrls } from '../lib/pdf/discover';

let bootstrapPromise: Promise<void> | null = null;

// Lazy: discover all PDFs from the index page and ingest them on first request.
// Subsequent calls await the same promise so concurrent requests don't trigger
// 12 parallel ingestions. If CHERKASY_INDEX_URL is unset but CHERKASY_SAMPLE_PDF_URL
// is, fall back to single-PDF mode (used by the iter1 dev setup and the tests).
async function discoverUrls(): Promise<string[]> {
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

export function ensureIngested(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    const urls = await discoverUrls();
    const failures: Array<{ url: string; error: Error }> = [];
    let ingested = 0;
    let skipped = 0;
    for (const url of urls) {
      try {
        const r = await ingestPdf(url);
        if (r.skipped) {
          skipped++;
        } else {
          ingested++;
          console.log(
            `[bootstrap] ingested ${url}: queue=${r.queueId} entries=${r.entries} items=${r.items}`,
          );
        }
      } catch (err) {
        const e = err as Error;
        failures.push({ url, error: e });
        console.error(`[bootstrap] FAILED ${url}: ${e.message}`);
      }
    }
    console.log(
      `[bootstrap] done: ingested=${ingested} skipped=${skipped} failed=${failures.length} total=${urls.length}`,
    );
    // Only blow up if EVERY URL failed — a partial corpus is more useful than
    // none. Failures are logged above so they remain visible.
    if (failures.length === urls.length) {
      throw new Error(
        `All ${urls.length} PDF ingestions failed; first error: ${failures[0].error.message}`,
      );
    }
  })().catch((err) => {
    // Reset on total failure so the next request retries.
    bootstrapPromise = null;
    throw err;
  });

  return bootstrapPromise;
}
