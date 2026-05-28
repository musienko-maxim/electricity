import { getDb } from './db';
import { buildFtsPrefixQuery } from './normalize';
import type { ItemKind, SearchKindFilter, SearchResponse, SearchResultRow } from './types';

const KIND_FILTER_MAP: Record<SearchKindFilter, ItemKind[] | null> = {
  all: null,
  address: ['street', 'street_with_numbers', 'settlement'],
  org: ['organization'],
  fop: ['fop'],
  person: ['person'],
};

export function searchItems(
  q: string,
  kindFilter: SearchKindFilter,
  page: number,
  pageSize: number,
): SearchResponse {
  const db = getDb();
  const ftsQuery = buildFtsPrefixQuery(q);
  if (!ftsQuery) {
    return { total: 0, page, pageSize, results: [] };
  }

  const kinds = KIND_FILTER_MAP[kindFilter];
  const kindClause = kinds && kinds.length > 0
    ? `AND i.kind IN (${kinds.map(() => '?').join(',')})`
    : '';

  const params: Array<string | number> = [ftsQuery];
  if (kinds) params.push(...kinds);

  // Compute filia matches FIRST so they can participate in total / pageSize.
  // Filia matches are a discovery aid: when a user types a district name (e.g.
  // "Городищ"), we surface the filia row so they can drill into its queue.
  // Only on page 1, only for unfiltered or address views.
  type FiliaMatch = {
    id: number;
    kind: ItemKind;
    displayName: string;
    filia: string;
    queueNumber: number;
    subQueue: number;
    queueLabel: string;
    validFrom: string | null;
    validTo: string | null;
  };
  const filiaMatches: FiliaMatch[] = [];
  if (page === 1 && (kindFilter === 'all' || kindFilter === 'address')) {
    const filiaTerm = q.trim().toLocaleLowerCase('uk-UA');
    if (filiaTerm.length >= 2) {
      // SQLite's built-in lower() is ASCII only — Cyrillic strings stay
      // mixed-case, breaking LIKE-based filters. Fetch all (~hundreds) and
      // filter in JS where toLocaleLowerCase('uk-UA') is Unicode-aware.
      const allFilias = db
        .prepare(
          `SELECT
             f.id              AS filiaId,
             f.name            AS name,
             MIN(q.id)         AS queueId,
             q.queue_number    AS queueNumber,
             q.sub_queue       AS subQueue,
             q.label           AS queueLabel,
             q.valid_from      AS validFrom,
             q.valid_to        AS validTo
           FROM filias f
           JOIN entries e      ON e.filia_id = f.id
           JOIN queues q       ON q.id = e.queue_id
           GROUP BY f.id`,
        )
        .all() as Array<{
        filiaId: number;
        name: string;
        queueId: number;
        queueNumber: number;
        subQueue: number;
        queueLabel: string;
        validFrom: string | null;
        validTo: string | null;
      }>;
      // GROUP BY f.id collapses a filia spanning multiple queues into one
      // row — eliminates the duplicate-React-key bug. MIN(q.id) picks a
      // deterministic representative queue. Cap at 5, respect pageSize.
      const cap = Math.min(5, pageSize);
      for (const f of allFilias) {
        if (filiaMatches.length >= cap) break;
        if (!f.name.toLocaleLowerCase('uk-UA').includes(filiaTerm)) continue;
        filiaMatches.push({
          id: -f.filiaId,
          kind: 'settlement' as ItemKind,
          displayName: f.name,
          filia: f.name,
          queueNumber: f.queueNumber,
          subQueue: f.subQueue,
          queueLabel: f.queueLabel,
          validFrom: f.validFrom,
          validTo: f.validTo,
        });
      }
    }
  }

  // total
  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM items i
       JOIN items_fts f ON f.rowid = i.id
       WHERE items_fts MATCH ?
       ${kindClause}`,
    )
    .get(...params) as { n: number };
  // Total includes both item matches and the filia discovery rows so the
  // frontend's pagination math + "знайдено N" count are honest.
  const total = totalRow.n + filiaMatches.length;

  // Filia matches always live on page 1 ahead of item matches. Subtract their
  // count from the item-query limit so the page never exceeds pageSize.
  const itemLimit = Math.max(0, pageSize - filiaMatches.length);
  const offset = (page - 1) * pageSize;
  // ORDER BY adds `, i.id` as a stable tiebreaker — without it SQLite is free
  // to reorder ties and the same row can appear on two pages (or be skipped).
  const rows = itemLimit === 0
    ? []
    : (db
        .prepare(
          `SELECT
             i.id              AS id,
             i.kind            AS kind,
             i.display_name    AS displayName,
             f_filia.name      AS filia,
             q.queue_number    AS queueNumber,
             q.sub_queue       AS subQueue,
             q.label           AS queueLabel,
             q.valid_from      AS validFrom,
             q.valid_to        AS validTo
           FROM items i
           JOIN items_fts f      ON f.rowid = i.id
           JOIN entries e        ON e.id = i.entry_id
           JOIN filias f_filia   ON f_filia.id = e.filia_id
           JOIN queues q         ON q.id = e.queue_id
           WHERE items_fts MATCH ?
           ${kindClause}
           ORDER BY length(i.display_name), i.display_name, i.id
           LIMIT ? OFFSET ?`,
        )
        .all(...params, itemLimit, offset) as Array<{
        id: number;
        kind: ItemKind;
        displayName: string;
        filia: string;
        queueNumber: number;
        subQueue: number;
        queueLabel: string;
        validFrom: string | null;
        validTo: string | null;
      }>);

  const merged = [...filiaMatches, ...rows];
  const results: SearchResultRow[] = merged.map((r) => ({
    id: r.id,
    kind: r.kind,
    displayName: r.displayName,
    filia: r.filia,
    queue: {
      number: r.queueNumber,
      subQueue: r.subQueue,
      label: r.queueLabel,
      validFrom: r.validFrom,
      validTo: r.validTo,
    },
  }));

  return { total, page, pageSize, results };
}
