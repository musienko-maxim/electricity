// Shared normalization used at ingest AND at query time so prefix matching aligns.

const QUOTE_MAP: Record<string, string> = {
  '«': '"', '»': '"', '“': '"', '”': '"', '„': '"', '‟': '"',
  '‘': "'", '’': "'", '‚': "'", '‛': "'", 'ʼ': "'", '´': "'", '`': "'",
};

// Cyrillic-aware boundaries (JS `\b` only knows ASCII word chars).
const LB = `(?<=^|[^А-Яа-яІЇЄҐіїєґA-Za-z0-9])`;
const RB = `(?=[^А-Яа-яІЇЄҐіїєґA-Za-z0-9]|$)`;

const PREFIX_SYNONYMS: Array<[RegExp, string]> = [
  [new RegExp(`${LB}вулиц[яеіюи]\\.?${RB}`, 'giu'), 'вул.'],
  [new RegExp(`${LB}провулок\\.?${RB}`, 'giu'), 'пров.'],
  [new RegExp(`${LB}провулку\\.?${RB}`, 'giu'), 'пров.'],
  [new RegExp(`${LB}прв\\.?${RB}`, 'giu'), 'пров.'],
  [new RegExp(`${LB}проспект[аі]?\\.?${RB}`, 'giu'), 'просп.'],
  [new RegExp(`${LB}пр-?т\\.?${RB}`, 'giu'), 'просп.'],
  [new RegExp(`${LB}прс\\.?${RB}`, 'giu'), 'просп.'],
  [new RegExp(`${LB}площ[аі]\\.?${RB}`, 'giu'), 'пл.'],
  [new RegExp(`${LB}бульвар[аі]?\\.?${RB}`, 'giu'), 'бул.'],
  [new RegExp(`${LB}б-р\\.?${RB}`, 'giu'), 'бул.'],
  [new RegExp(`${LB}сел[ао]\\.?${RB}`, 'giu'), 'с.'],
  [new RegExp(`${LB}місто\\.?${RB}`, 'giu'), 'м.'],
  [new RegExp(`${LB}селище\\.?${RB}`, 'giu'), 'смт.'],
  [new RegExp(`${LB}хутір\\.?${RB}`, 'giu'), 'х.'],
];

export function normalizeText(input: string): string {
  if (!input) return '';
  let s = input.normalize('NFC');

  // Curly quotes / apostrophes → straight.
  s = s.replace(/[«»“”„‟‘’‚‛ʼ´`]/g, (ch) => QUOTE_MAP[ch] ?? ch);

  // Cyrillic Roman numerals → Latin lowercase (keep IV/V intact via order).
  s = s.replace(/І{1,4}/gu, (m) => 'i'.repeat(m.length));
  s = s.replace(/V/gu, 'v');

  // Lowercase.
  s = s.toLowerCase();

  // Expand long prefixes to short canonical forms.
  for (const [re, replacement] of PREFIX_SYNONYMS) {
    s = s.replace(re, replacement);
  }

  // Collapse whitespace, trim punctuation noise.
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

export function normalizeFiliaName(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, ' ').trim();
}

// Build an FTS5 prefix MATCH expression from a user query.
// Splits on whitespace, commas, semicolons, AND dots — FTS5 unicode61 treats
// `.` as a separator, so a token like "рай.держ" containing a literal period
// matches nothing. Splitting on `.` here makes "рай.держ" search as "рай" +
// "держ*" which actually hits the index.
export function buildFtsPrefixQuery(q: string): string {
  const tokens = normalizeText(q)
    .split(/[\s,;.]+/)
    .filter((t) => t.length > 0)
    .map((t) => t.replace(/"/g, '""'));
  if (tokens.length === 0) return '';
  const last = tokens.pop()!;
  const prefixTokens = tokens.map((t) => `"${t}"`);
  prefixTokens.push(`"${last}"*`);
  return prefixTokens.join(' ');
}
