import { classifyEntry } from './classify';
import type { Line } from './extract';
import type { ParsedDocument, ParsedEntry } from '../types';

// Layout constants derived from the actual Cherkasy PDFs (see scripts/probe-extract.ts).
const FILIA_X_MAX = 60;          // filia headers sit at the absolute left margin
const ENTRY_X_MIN = 100;         // right-column entries start well past center
const PARAGRAPH_Y_GAP = 15;      // y-gap above this terminates the current entry
const HEADER_Y_TOP = 470;        // anything above is page chrome (changes per page)

const UA_MONTHS: Record<string, string> = {
  січня: '01', лютого: '02', березня: '03', квітня: '04', травня: '05',
  червня: '06', липня: '07', серпня: '08', вересня: '09', жовтня: '10',
  листопада: '11', грудня: '12',
};

const FILIA_RE = /(філія|електромережі|ЕМ)\s*$/iu;
const SKIP_RES = [
  /^Сторінка\s+\d/iu,
  /^Перелік\s+основних/iu,
  /^Графік\s+погодинного/iu,
  /^["“„]?ЧЕРКАСИОБЛЕНЕРГО/iu,
];
const QUEUE_HEADER_RE = /(\d)\s*черга[.,]\s*(І{1,3})\s*підчерга/u;
const DATE_RANGE_RE = /з\s+(\d{1,2})\s+([а-яіїєґ]+)\s+по\s+(\d{1,2})\s+([а-яіїєґ]+)\s+(\d{4})/iu;

function cyrRomanToInt(s: string): number {
  // "І" = 1, "ІІ" = 2, "ІІІ" = 3. (Latin I tolerated too.)
  const t = s.replace(/I/g, 'І');
  return t.length;
}

function uaDateToIso(day: string, monthName: string, year: string): string | null {
  const mm = UA_MONTHS[monthName.toLowerCase()];
  if (!mm) return null;
  return `${year}-${mm}-${day.padStart(2, '0')}`;
}

interface PendingEntry {
  filia: string;
  texts: string[];
  pageNumber: number;
  lastY: number;
}

function flushEntry(p: PendingEntry | null, out: ParsedEntry[]) {
  if (!p) return;
  const raw = p.texts.join(' ').replace(/\s+/g, ' ').trim();
  if (!raw) return;
  const items = classifyEntry(raw);
  out.push({
    filia: p.filia,
    rawText: raw,
    pageNumber: p.pageNumber,
    items,
  });
}

export function parsePdf(lines: Line[]): ParsedDocument {
  let queueNumber = 0;
  let subQueue = 0;
  let label = '';
  let validFrom: string | undefined;
  let validTo: string | undefined;

  let currentFilia = '';
  let pending: PendingEntry | null = null;
  const entries: ParsedEntry[] = [];

  for (const ln of lines) {
    const t = ln.text;
    if (!t) continue;

    // Queue header (appears once near top of first page) — check before skipping.
    if (!queueNumber) {
      const m = t.match(QUEUE_HEADER_RE);
      if (m) {
        queueNumber = parseInt(m[1], 10);
        subQueue = cyrRomanToInt(m[2]);
        label = `${queueNumber} черга, ${m[2]} підчерга`;
      }
    }
    // Date range (lives inside the legal blurb that we'd otherwise skip).
    if (!validFrom) {
      const dm = t.match(DATE_RANGE_RE);
      if (dm) {
        validFrom = uaDateToIso(dm[1], dm[2], dm[5]) ?? undefined;
        validTo = uaDateToIso(dm[3], dm[4], dm[5]) ?? undefined;
      }
    }

    if (SKIP_RES.some((r) => r.test(t))) continue;
    if (ln.y > HEADER_Y_TOP && !QUEUE_HEADER_RE.test(t)) {
      // page top chrome (repeated headers) — skip.
      continue;
    }

    const isFilia = ln.minX <= FILIA_X_MAX && FILIA_RE.test(t) && t.length < 60;
    if (isFilia) {
      flushEntry(pending, entries);
      pending = null;
      currentFilia = t.replace(/\s+/g, ' ').trim();
      continue;
    }

    // Skip the queue-header line itself from being treated as an entry.
    if (QUEUE_HEADER_RE.test(t) && t.length < 40) continue;

    // Right-column entry content?
    if (ln.minX >= ENTRY_X_MIN && currentFilia) {
      if (!pending) {
        pending = {
          filia: currentFilia,
          texts: [t],
          pageNumber: ln.pageNumber,
          lastY: ln.y,
        };
      } else {
        const gap = Math.abs(pending.lastY - ln.y);
        if (gap > PARAGRAPH_Y_GAP || ln.pageNumber !== pending.pageNumber) {
          flushEntry(pending, entries);
          pending = {
            filia: currentFilia,
            texts: [t],
            pageNumber: ln.pageNumber,
            lastY: ln.y,
          };
        } else {
          pending.texts.push(t);
          pending.lastY = ln.y;
        }
      }
    }
  }
  flushEntry(pending, entries);

  if (!label) {
    throw new Error('Could not detect queue/sub-queue header in PDF');
  }

  return {
    queueNumber,
    subQueue,
    label,
    validFrom,
    validTo,
    entries,
  };
}
