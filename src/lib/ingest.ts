import { getDb } from './db';
import { fetchPdf } from './pdf/fetch';
import { extractPdfLines } from './pdf/extract';
import { parsePdf } from './pdf/parse';
import type { ParsedDocument } from './types';

export interface IngestResult {
  url: string;
  pdfId: number;
  queueId: number;
  entries: number;
  items: number;
  skipped: boolean;
}

export async function ingestPdf(url: string): Promise<IngestResult> {
  const db = getDb();

  // Look up existing record for this URL FIRST, so we can pass the prior
  // etag/last-modified into fetchPdf for a conditional GET. Without this,
  // fetchPdf would just serve whatever's on disk and miss upstream rotations.
  const existing = db
    .prepare(
      'SELECT id, sha256, status, etag, last_modified FROM pdf_sources WHERE url = ?',
    )
    .get(url) as
    | {
        id: number;
        sha256: string;
        status: string;
        etag: string | null;
        last_modified: string | null;
      }
    | undefined;

  const fetched = await fetchPdf(url, {
    priorEtag: existing?.etag ?? null,
    priorLastModified: existing?.last_modified ?? null,
  });

  if (existing && existing.sha256 === fetched.sha256 && existing.status === 'ready') {
    // Cached and unchanged — nothing to do.
    const q = db
      .prepare('SELECT id FROM queues WHERE source_pdf_id = ?')
      .get(existing.id) as { id: number } | undefined;
    const entryCount = q
      ? (db
          .prepare('SELECT COUNT(*) AS n FROM entries WHERE queue_id = ?')
          .get(q.id) as { n: number }).n
      : 0;
    const itemCount = q
      ? (db
          .prepare(
            'SELECT COUNT(*) AS n FROM items i JOIN entries e ON e.id = i.entry_id WHERE e.queue_id = ?',
          )
          .get(q.id) as { n: number }).n
      : 0;
    return {
      url,
      pdfId: existing.id,
      queueId: q?.id ?? 0,
      entries: entryCount,
      items: itemCount,
      skipped: true,
    };
  }

  // Extract + parse.
  console.log(`[ingest] parsing ${url} (${fetched.cached ? 'cached' : 'fetched'})`);
  const lines = await extractPdfLines(fetched.buffer);
  const doc: ParsedDocument = parsePdf(lines);
  console.log(
    `[ingest] queue=${doc.label} entries=${doc.entries.length} items=${doc.entries.reduce((n, e) => n + e.items.length, 0)}`,
  );

  // Upsert in a single transaction.
  const nowIso = new Date().toISOString();

  const tx = db.transaction(() => {
    // Upsert pdf_sources.
    let pdfId: number;
    if (existing) {
      db.prepare(
        `UPDATE pdf_sources
         SET sha256 = ?, etag = ?, last_modified = ?, fetched_at = ?, status = 'parsing'
         WHERE id = ?`,
      ).run(fetched.sha256, fetched.etag, fetched.lastModified, nowIso, existing.id);
      pdfId = existing.id;
      // Wipe queue + entries + items for this source so we re-insert cleanly.
      db.prepare('DELETE FROM queues WHERE source_pdf_id = ?').run(pdfId);
    } else {
      const ins = db
        .prepare(
          `INSERT INTO pdf_sources (url, etag, last_modified, sha256, fetched_at, status)
           VALUES (?, ?, ?, ?, ?, 'parsing')`,
        )
        .run(url, fetched.etag, fetched.lastModified, fetched.sha256, nowIso);
      pdfId = Number(ins.lastInsertRowid);
    }

    // ON CONFLICT key now includes source_pdf_id so we can never hijack a
    // queue row that belongs to a different pdf_sources entry. Re-ingesting
    // the SAME url just updates label/dates on the same queue row.
    const queueIns = db
      .prepare(
        `INSERT INTO queues (queue_number, sub_queue, label, valid_from, valid_to, source_pdf_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(queue_number, sub_queue, source_pdf_id) DO UPDATE SET
           label = excluded.label,
           valid_from = excluded.valid_from,
           valid_to = excluded.valid_to
         RETURNING id`,
      )
      .get(
        doc.queueNumber,
        doc.subQueue,
        doc.label,
        doc.validFrom ?? null,
        doc.validTo ?? null,
        pdfId,
      ) as { id: number };
    const queueId = queueIns.id;
    // Defensive: clear children if this was an UPDATE (ON CONFLICT path).
    db.prepare('DELETE FROM entries WHERE queue_id = ?').run(queueId);

    // Prepare statements once for speed.
    const upsertFilia = db.prepare(
      'INSERT INTO filias (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name = excluded.name RETURNING id',
    );
    const insertEntry = db.prepare(
      'INSERT INTO entries (queue_id, filia_id, raw_text, page_number) VALUES (?, ?, ?, ?)',
    );
    const insertItem = db.prepare(
      `INSERT INTO items
         (entry_id, kind, display_name, normalized, settlement, street_name, street_number)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    let entryCount = 0;
    let itemCount = 0;

    for (const entry of doc.entries) {
      const filiaRow = upsertFilia.get(entry.filia) as { id: number };
      const entryRes = insertEntry.run(queueId, filiaRow.id, entry.rawText, entry.pageNumber);
      const entryId = Number(entryRes.lastInsertRowid);
      entryCount++;
      for (const item of entry.items) {
        insertItem.run(
          entryId,
          item.kind,
          item.displayName,
          item.normalized,
          item.settlement ?? null,
          item.streetName ?? null,
          item.streetNumber ?? null,
        );
        itemCount++;
      }
    }

    db.prepare(`UPDATE pdf_sources SET status = 'ready' WHERE id = ?`).run(pdfId);

    return { pdfId, queueId, entryCount, itemCount };
  });

  const out = tx();
  return {
    url,
    pdfId: out.pdfId,
    queueId: out.queueId,
    entries: out.entryCount,
    items: out.itemCount,
    skipped: false,
  };
}
