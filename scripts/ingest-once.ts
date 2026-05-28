// CLI helper: run the ingest pipeline once against the configured PDF.
// Run with: node --env-file=.env --import tsx scripts/ingest-once.ts
//       or: CHERKASY_SAMPLE_PDF_URL=... npx tsx scripts/ingest-once.ts
import { ingestPdf } from '../src/lib/ingest';

async function main() {
  const url = process.env.CHERKASY_SAMPLE_PDF_URL ?? process.argv[2];
  if (!url) {
    console.error('Usage: tsx scripts/ingest-once.ts <pdf-url>   (or set CHERKASY_SAMPLE_PDF_URL)');
    process.exit(2);
  }
  const start = Date.now();
  const r = await ingestPdf(url);
  console.log(JSON.stringify(r, null, 2));
  console.log(`Took ${Date.now() - start}ms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
