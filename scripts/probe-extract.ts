// Dev-only: dump first ~40 lines of extracted page text with x positions
// so we can eyeball x ranges for filia vs entry columns.
import { readFileSync } from 'node:fs';
import { extractPdfLines } from '../src/lib/pdf/extract';

async function main() {
  const path = process.argv[2] ?? '/tmp/cherkasy/queue1_1.pdf';
  const buf = readFileSync(path);
  const lines = await extractPdfLines(buf);
  console.log(`Total lines: ${lines.length}`);
  for (const ln of lines.slice(0, 80)) {
    const x = ln.minX.toFixed(1).padStart(6);
    console.log(`p${ln.pageNumber} y=${ln.y.toFixed(1).padStart(6)} x=${x}  ${ln.text.slice(0, 140)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
