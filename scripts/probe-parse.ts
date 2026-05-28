// Dev-only: run the full extract→parse→classify pipeline on a local PDF
// and print summary stats + a few sample items for hand-validation.
import { readFileSync } from 'node:fs';
import { extractPdfLines } from '../src/lib/pdf/extract';
import { parsePdf } from '../src/lib/pdf/parse';

async function main() {
  const path = process.argv[2] ?? '/tmp/cherkasy/queue1_1.pdf';
  const buf = readFileSync(path);
  const lines = await extractPdfLines(buf);
  const doc = parsePdf(lines);

  console.log(`Queue:    ${doc.label}`);
  console.log(`Valid:    ${doc.validFrom} → ${doc.validTo}`);
  console.log(`Entries:  ${doc.entries.length}`);
  const totalItems = doc.entries.reduce((n, e) => n + e.items.length, 0);
  console.log(`Items:    ${totalItems}`);

  const byKind: Record<string, number> = {};
  const byFilia: Record<string, number> = {};
  for (const e of doc.entries) {
    byFilia[e.filia] = (byFilia[e.filia] ?? 0) + e.items.length;
    for (const it of e.items) byKind[it.kind] = (byKind[it.kind] ?? 0) + 1;
  }
  console.log('\nBy kind:'); console.table(byKind);
  console.log('By filia:'); console.table(byFilia);

  console.log('\nSample items (looking for ФОП Сало):');
  for (const e of doc.entries) {
    for (const it of e.items) {
      if (it.displayName.includes('Сало')) {
        console.log(`  [${it.kind}] ${it.displayName}   (filia=${e.filia})`);
      }
    }
  }

  console.log('\nSample items (street numbers on Ювілейна, first 10):');
  let n = 0;
  for (const e of doc.entries) {
    for (const it of e.items) {
      if (it.displayName.includes('Ювілейна') && n < 10) {
        console.log(`  [${it.kind}] ${it.displayName}`);
        n++;
      }
    }
  }

  console.log('\nSample items (Гельмя):');
  let m = 0;
  for (const e of doc.entries) {
    for (const it of e.items) {
      if (it.displayName.toLowerCase().includes('гельмя') && m < 8) {
        console.log(`  [${it.kind}] ${it.displayName}`);
        m++;
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
