import { normalizeText } from '../normalize';
import type { ItemKind, ParsedItem } from '../types';

// Recognized organization / individual prefixes. Order matters: longer/more
// specific prefixes (e.g. ФОП) must be matched before shorter ones (ФО).
const ENTITY_PREFIXES = [
  'ФОП', 'ФО',
  'ТОВ', 'ПП', 'ПрАТ', 'ПАТ', 'АТ', 'СТОВ', 'СФГ', 'ФГ', 'КНП', 'КП',
  'ОСББ', 'ДП', 'ВКП', 'ВКБП', 'МП', 'ТДВ', 'ВСП', 'КС', 'ЧОКП', 'ГУ',
  'НП', 'РКП', 'РайСТ', 'ОСС', 'ЖБК', 'ПСП', 'АПК', 'АФ',
];

const ENTITY_KIND: Record<string, ItemKind> = {
  ФОП: 'fop',
  ФО: 'person',
};

const STREET_PREFIXES = ['вул.', 'пров.', 'просп.', 'пр-т', 'пр.', 'пл.', 'бул.', 'прв.', 'ул.', 'прс.', 'б-р.'];
const SETTLEMENT_PREFIXES = ['с.', 'смт.', 'м.', 'х.'];

// Org-leading lexical heads — words that strongly indicate an organization name
// when no recognized entity prefix (ТОВ/ПП/АТ/…) is present. Used as a fallback.
const ORG_LEADING_WORDS = [
  'Парафія', 'Філія', 'Виконавчий', 'Управління', 'Відділ', 'Релігійна',
  'Церква', 'Концерн', 'Дитсадок', 'Гуртожиток', 'Колгоспний', 'Автостанція',
  'Міська', 'Міський', 'Міське', 'Районна', 'Районний', 'Районне', 'Сектор',
  'Депо', 'Парк', 'Лікарня', 'Школа', 'Університет', 'Колегіум', 'Музей',
  'Бібліотека', 'Господарство', "Об'єкти", 'Об’єкти', "об'єкти", 'об’єкти',
  'Приватний', 'Приватна', 'Приватне', 'Комунальний', 'Комунальна', 'Комунальне',
  'Центр', 'Українська', 'Український', 'Українське', 'Бюро', 'Інспекція',
  'Центральна', 'Центральний', 'Центральне', 'Аптека', 'Магазин', 'Завод',
  'Фабрика', 'Комбінат', 'Товариство', 'Драбiвська', 'Драбівська', 'Черкаська',
  'Черкаський', 'Виконком', 'Виконкому', 'Філіал', 'Філіал-', 'Дирекція',
];

// JS `\b` only recognizes ASCII word chars, so we build explicit Cyrillic-aware
// boundaries with character classes.
const NW = `[^А-Яа-яІЇЄҐіїєґA-Za-z0-9]`;       // non-letter/digit (also matches start via lookbehind alt)
const WORD_END = `(?=${NW}|$)`;
const WORD_START_LB = `(?<=^|${NW})`;

const STREET_PREFIX_RE = new RegExp(
  `${WORD_START_LB}(вул\\.|пров\\.|просп\\.|пр-?т|пл\\.|бул\\.|прв\\.|ул\\.|прс\\.|б-р\\.)`,
  'iu',
);
const ENTITY_PREFIX_RE = new RegExp(
  `${WORD_START_LB}(${ENTITY_PREFIXES.join('|')})${WORD_END}`,
  'gu',
);
const ORG_LEADING_RE = new RegExp(
  `^(${ORG_LEADING_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'iu',
);

function preprocess(raw: string): string {
  let s = raw.normalize('NFC');
  // Ensure space after sentence-end punctuation/commas that the PDF stripped.
  s = s.replace(/([,;:.])(?=[А-ЯA-ZІЇЄҐ])/gu, '$1 ');
  // Normalize "вул.Foo" → "вул. Foo" etc. (Cyrillic-aware lookbehind.) Includes
  // multi-char prefixes like "б-р" and "пр-т".
  s = s.replace(
    /(?<=^|[^А-Яа-яІЇЄҐіїєґA-Za-z0-9])(вул|пров|просп|пр-?т|пл|бул|прв|ул|прс|б-р)\.([А-ЯІЇЄҐа-яіїєґ])/gu,
    '$1. $2',
  );
  s = s.replace(
    /(?<=^|[^А-Яа-яІЇЄҐіїєґA-Za-z0-9])(с|смт|м|х)\.([А-ЯІЇЄҐ])/gu,
    '$1. $2',
  );
  // Strip enumeration intro words ("вулиці:", "Провулки:", "Бульвари:",
  // "Проспекти:", "Площі:") so the actual street prefix becomes the chunk head.
  // We delete the word + optional colon so what follows parses normally.
  s = s.replace(
    /(?<=^|[^А-Яа-яІЇЄҐіїєґA-Za-z0-9])(вулиц[іеяю]|вулиц[ьа]|провулки|провулків|бульвари|проспекти|площі)\s*:?\s*/giu,
    '',
  );
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// Quote-aware comma splitter. Keeps `ТОВ "Лани, Драбіщини"` intact.
// The Cherkasy PDFs sometimes have unbalanced quotes (e.g. `СТОВ "Шрамкiвський
// молочно-тваринницький комплекс,`) — if quote count is odd, we re-run the
// split ignoring quotes so the chunk doesn't swallow the rest of the entry.
function splitCommas(input: string): string[] {
  const quoteCount = (input.match(/"/g) ?? []).length;
  const respectQuotes = quoteCount % 2 === 0;

  const out: string[] = [];
  let buf = '';
  let inQuote = false;
  let depthParen = 0;
  for (const ch of input) {
    if (respectQuotes && ch === '"') inQuote = !inQuote;
    if (ch === '(') depthParen++;
    if (ch === ')') depthParen = Math.max(0, depthParen - 1);
    if ((ch === ',' || ch === ';') && !inQuote && depthParen === 0) {
      const t = buf.trim();
      if (t) out.push(t);
      buf = '';
    } else {
      buf += ch;
    }
  }
  const t = buf.trim();
  if (t) out.push(t);
  return out;
}

function makeItem(
  kind: ItemKind,
  displayName: string,
  extras: Partial<ParsedItem> = {},
): ParsedItem {
  const trimmed = displayName.replace(/\s+/g, ' ').trim();
  return {
    kind,
    displayName: trimmed,
    normalized: normalizeText(trimmed),
    ...extras,
  };
}

// Lookahead used by extractEntities to detect an embedded street prefix that
// should terminate an org range (so "ГДУ X. вул. Дахнівська 1" yields an org
// AND a street, not one bloated org item with no number continuation context).
const STREET_PREFIX_LOOKAHEAD = /^(вул\.|пров\.|просп\.|пр-?т|пл\.|бул\.|прв\.|ул\.|прс\.|б-р\.)/iu;

// Find org/fop/person mentions globally in the text. We anchor on entity
// prefixes (ФОП, ТОВ, …) and capture text up to the next entity prefix,
// embedded street prefix, or first unquoted comma/semicolon.
function extractEntities(text: string): { items: ParsedItem[]; ranges: Array<[number, number]> } {
  const items: ParsedItem[] = [];
  const ranges: Array<[number, number]> = [];

  const matches: { idx: number; prefix: string }[] = [];
  let m: RegExpExecArray | null;
  ENTITY_PREFIX_RE.lastIndex = 0;
  while ((m = ENTITY_PREFIX_RE.exec(text)) !== null) {
    matches.push({ idx: m.index, prefix: m[1] });
  }

  for (let i = 0; i < matches.length; i++) {
    const { idx, prefix } = matches[i];
    const start = idx;
    let end = i + 1 < matches.length ? matches[i + 1].idx : text.length;
    const chunk = text.slice(start, end);
    // Symmetric with splitCommas: if the chunk has an unbalanced "
    // (Cherkasy PDFs occasionally drop the closing quote), ignore quotes so the
    // entity range terminates at the first comma instead of swallowing the rest
    // of the entry into one bloated bundled-orgs item.
    const respectQuotes = ((chunk.match(/"/g) ?? []).length) % 2 === 0;
    let stopAt = chunk.length;
    let inQuote = false;
    for (let j = 0; j < chunk.length; j++) {
      const c = chunk[j];
      if (respectQuotes && c === '"') inQuote = !inQuote;
      if (!inQuote && (c === ',' || c === ';')) {
        stopAt = j;
        break;
      }
      // Stop just before an embedded street prefix at a word boundary so the
      // street + its trailing numbers can be parsed downstream.
      if (
        !inQuote &&
        j > 0 &&
        /[\s.]/.test(chunk[j - 1]) &&
        STREET_PREFIX_LOOKAHEAD.test(chunk.slice(j))
      ) {
        stopAt = j;
        break;
      }
    }
    let raw = chunk.slice(0, stopAt).trim();
    // Trim trailing punctuation noise.
    raw = raw.replace(/[\s,.;:]+$/u, '').trim();
    if (!raw) continue;

    const kind: ItemKind = ENTITY_KIND[prefix] ?? 'organization';
    items.push(makeItem(kind, raw));
    ranges.push([start, start + raw.length]);
  }

  return { items, ranges };
}

// Mask out ranges in the original text so address-walking doesn't re-process
// them. We replace each range with spaces of the same length to preserve indices.
function maskRanges(text: string, ranges: Array<[number, number]>): string {
  const chars = text.split('');
  for (const [s, e] of ranges) {
    for (let i = s; i < e && i < chars.length; i++) chars[i] = ' ';
  }
  return chars.join('');
}

// Parse street numbers like `1, 2,2а, 4,4а,4б, 6/а, 13а, 17, 21`.
function splitNumbers(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((s) => s.replace(/№/g, '').trim())
    .filter((s) => /^[0-9][0-9а-яА-Я\/\-]*$/u.test(s));
}

// Parse a street chunk with an active settlement scope.
// Handles:
//   "вул. Покровська"
//   "вул. Ювілейна 1, 2,2а, 4"
//   "пров. 1-й Котляревського"
//   "Затишна"  (bare continuation — settlement-scoped, prev prefix=вул.)
function parseStreetChunk(
  chunk: string,
  settlement: string,
  prevPrefix: string | null,
): { items: ParsedItem[]; lastPrefix: string | null; lastName: string | null } {
  const items: ParsedItem[] = [];
  let prefix: string | null = prevPrefix;

  // Does the chunk start with an explicit prefix?
  const prefixMatch = chunk.match(
    /^\s*(вул\.|пров\.|просп\.|пр-?т|пл\.|бул\.|прв\.|ул\.|прс\.|б-р\.)\s*/iu,
  );
  let rest = chunk;
  if (prefixMatch) {
    const raw = prefixMatch[1].toLowerCase();
    prefix =
      raw === 'пр-т' || raw === 'прс.' ? 'просп.' :
      raw === 'ул.' ? 'вул.' :
      raw === 'прв.' ? 'пров.' :
      raw === 'б-р.' ? 'бул.' :
      raw;
    rest = chunk.slice(prefixMatch[0].length);
  }
  rest = rest.trim();

  if (!rest) return { items, lastPrefix: prefix, lastName: null };
  // Need a prefix to classify as a street.
  if (!prefix) return { items, lastPrefix: prefix, lastName: null };

  // Pure-number / pure-noise chunks shouldn't become streets on their own.
  if (/^[\s0-9а-яА-Я,\/\-№]+$/u.test(rest) && !/[А-ЯІЇЄҐа-яіїєґ]{2,}/u.test(rest)) {
    return { items, lastPrefix: prefix, lastName: null };
  }

  // Separate name and trailing numbers.
  const nm = rest.match(/^(.+?)\s*(?:№?\s*([0-9][\s0-9а-яА-Я,\/\-]*))?\s*$/u);
  if (!nm) return { items, lastPrefix: prefix, lastName: null };

  let streetName = nm[1].trim().replace(/[,.\s]+$/u, '');
  if (!streetName || streetName.length < 2) return { items, lastPrefix: prefix, lastName: null };
  // Strip leading "вулиці[: ]" or "вулиця " junk left over from sentence
  // fragments like "вулиці: ул.Ювілейна".
  streetName = streetName.replace(/^вулиц[ея][\s:]*/iu, '').trim();
  if (!streetName || streetName.length < 2) return { items, lastPrefix: prefix, lastName: null };

  const numbersRaw = (nm[2] ?? '').trim();
  const numbers = numbersRaw ? splitNumbers(numbersRaw) : [];
  const displayPrefix = prefix;
  const displayStreet = `${displayPrefix} ${streetName}`;

  if (numbers.length === 0) {
    const display = settlement ? `${settlement}, ${displayStreet}` : displayStreet;
    items.push(
      makeItem('street', display, {
        settlement: settlement || undefined,
        streetName,
      }),
    );
  } else {
    for (const n of numbers) {
      const display = settlement
        ? `${settlement}, ${displayStreet} ${n}`
        : `${displayStreet} ${n}`;
      items.push(
        makeItem('street_with_numbers', display, {
          settlement: settlement || undefined,
          streetName,
          streetNumber: n,
        }),
      );
    }
  }

  return { items, lastPrefix: prefix, lastName: streetName };
}

export function classifyEntry(rawText: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  const text = preprocess(rawText);
  if (!text) return items;

  // 1) Pull out all entity (org/fop/person) mentions first.
  const ent = extractEntities(text);
  items.push(...ent.items);

  // 2) Mask them and walk the remainder for settlements + streets.
  const masked = maskRanges(text, ent.ranges);

  let settlement = '';
  let lastStreetPrefix: string | null = null;
  let lastStreetName: string | null = null;

  const chunks = splitCommas(masked);
  for (const rawChunk of chunks) {
    // Strip leading "." left over after a masked entity range (e.g. masked
    // "ГДУ ... області" leaves ". вул. Дахнівська 1" as the next chunk).
    const chunk = rawChunk.replace(/\s+/g, ' ').replace(/^[.\s]+/, '').trim();
    if (!chunk) continue;

    // Pure number chunk — attach to the last street if we have one.
    const pureNum = chunk.match(/^№?\s*([0-9][0-9а-яА-Я\/\-]*)$/u);
    if (pureNum && lastStreetName && lastStreetPrefix) {
      const n = pureNum[1];
      const displayStreet = `${lastStreetPrefix} ${lastStreetName}`;
      const display = settlement ? `${settlement}, ${displayStreet} ${n}` : `${displayStreet} ${n}`;
      items.push(
        makeItem('street_with_numbers', display, {
          settlement: settlement || undefined,
          streetName: lastStreetName,
          streetNumber: n,
        }),
      );
      continue;
    }

    // Settlement: prefix + run of capitalized name words (allows hyphens,
    // apostrophes, inner dots like Б.Орловецька).
    const settHead = chunk.match(
      /^(с\.|смт\.|м\.|х\.)\s*([А-ЯІЇЄҐ][А-Яа-яІЇЄҐіїєґ'\-\.]*(?:\s+[А-ЯІЇЄҐ][А-Яа-яІЇЄҐіїєґ'\-\.]*){0,3})/u,
    );
    if (settHead) {
      const sPrefix = settHead[1].toLowerCase();
      const sName = settHead[2].trim().replace(/[,.\s]+$/u, '');
      settlement = `${sPrefix} ${sName}`;
      // Record settlement as its own searchable item.
      items.push(makeItem('settlement', settlement, { settlement }));
      lastStreetPrefix = null;
      // Continue parsing the rest of the chunk after the settlement head.
      const remainder = chunk.slice(settHead[0].length).trim();
      if (remainder) {
        const cleanRem = remainder.replace(/^[:.\s]+/, '');
        if (cleanRem) {
          const r = parseStreetChunk(cleanRem, settlement, lastStreetPrefix);
          items.push(...r.items);
          if (r.items.length > 0) {
            lastStreetPrefix = r.lastPrefix;
            if (r.lastName) lastStreetName = r.lastName;
          }
        }
      }
      continue;
    }

    // Org-leading word fallback (Парафія, Лікарня, Виконавчий, etc.) — must
    // run BEFORE parseStreetChunk so that an active street prefix from the
    // previous chunk doesn't misclassify the org name as a street continuation.
    if (ORG_LEADING_RE.test(chunk)) {
      items.push(makeItem('organization', chunk));
      // Reset street continuation context — an org breaks the chain.
      lastStreetPrefix = null;
      lastStreetName = null;
      continue;
    }

    // Pure street chunk (with or without explicit prefix — continuation OK).
    const r = parseStreetChunk(chunk, settlement, lastStreetPrefix);
    if (r.items.length > 0) {
      items.push(...r.items);
      lastStreetPrefix = r.lastPrefix;
      if (r.lastName) lastStreetName = r.lastName;
      continue;
    }

    // Final fallback: a chunk that's not a number, not a settlement, not a
    // recognized street, and starts with a capital letter + has ≥3 tokens
    // → most likely an organization name we don't have a prefix for
    // ("Драбiвська рай.держ.лiкарня ветеринарної медицини").
    if (
      /^[А-ЯІЇЄҐ]/u.test(chunk) &&
      chunk.split(/\s+/).length >= 3 &&
      /[А-Яа-яІЇЄҐіїєґ]/u.test(chunk)
    ) {
      // If the chunk also contains an embedded street prefix (e.g. "ГДУ X.
      // вул. Дахнівська 1"), split it: org part + street part. The street
      // part also seeds lastStreetName so subsequent number-only chunks
      // ("2/15", "2/17") attach to it.
      const embed = chunk.match(
        /(?<=^|[^А-Яа-яІЇЄҐіїєґA-Za-z0-9])(вул\.|пров\.|просп\.|пр-?т|пл\.|бул\.|прв\.|ул\.|прс\.|б-р\.)/iu,
      );
      if (embed && embed.index !== undefined && embed.index > 0) {
        const orgPart = chunk.slice(0, embed.index).replace(/[\s.,;:]+$/u, '');
        const streetPart = chunk.slice(embed.index);
        if (orgPart) items.push(makeItem('organization', orgPart));
        const r = parseStreetChunk(streetPart, settlement, lastStreetPrefix);
        if (r.items.length > 0) {
          items.push(...r.items);
          lastStreetPrefix = r.lastPrefix;
          if (r.lastName) lastStreetName = r.lastName;
        }
      } else {
        items.push(makeItem('organization', chunk));
        lastStreetPrefix = null;
        lastStreetName = null;
      }
    }
  }

  // De-dupe by (kind, normalized).
  const seen = new Set<string>();
  const out: ParsedItem[] = [];
  for (const it of items) {
    const key = `${it.kind}::${it.normalized}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}
