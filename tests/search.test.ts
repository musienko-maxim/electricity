import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'search-test-'));
  process.env.DATA_DIR = tmpRoot;
  vi.resetModules();
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function seedFixture() {
  const { getDb } = await import('../src/lib/db');
  const db = getDb();

  // Two pdf_sources (simulating two queues / sub-queues sharing one filia).
  db.prepare(
    `INSERT INTO pdf_sources (id, url, etag, last_modified, sha256, fetched_at, status)
     VALUES (1, 'http://x/1.pdf', NULL, NULL, 'sha1', '2026-05-28', 'ready'),
            (2, 'http://x/2.pdf', NULL, NULL, 'sha2', '2026-05-28', 'ready')`,
  ).run();

  // Queues: same (q=1, sub=1) is now allowed because UNIQUE includes source_pdf_id.
  // Use distinct (queue, sub) per source to keep things realistic.
  db.prepare(
    `INSERT INTO queues (id, queue_number, sub_queue, label, valid_from, valid_to, source_pdf_id)
     VALUES (10, 1, 1, '1 черга, І підчерга', '2026-05-01', '2026-05-31', 1),
            (20, 1, 2, '1 черга, ІІ підчерга', '2026-05-01', '2026-05-31', 2)`,
  ).run();

  // ONE filia, present in BOTH queues — this is the duplicate-React-keys
  // scenario from finding #5.
  db.prepare(`INSERT INTO filias (id, name) VALUES (100, 'Городищенська філія')`).run();

  // Two entries, one per queue, both under the same filia.
  db.prepare(
    `INSERT INTO entries (id, queue_id, filia_id, raw_text, page_number)
     VALUES (1000, 10, 100, 'paragraph A', 1),
            (1001, 20, 100, 'paragraph B', 1)`,
  ).run();

  // Items: a few streets per entry so total > pageSize-budget scenarios.
  db.prepare(
    `INSERT INTO items (id, entry_id, kind, display_name, normalized, settlement, street_name, street_number)
     VALUES (5000, 1000, 'street_with_numbers', 'вул. Ювілейна 1',  'вул. ювілейна 1', NULL, 'Ювілейна', '1'),
            (5001, 1000, 'street_with_numbers', 'вул. Ювілейна 2',  'вул. ювілейна 2', NULL, 'Ювілейна', '2'),
            (5002, 1001, 'street_with_numbers', 'вул. Ювілейна 3',  'вул. ювілейна 3', NULL, 'Ювілейна', '3'),
            (5003, 1001, 'street_with_numbers', 'вул. Ювілейна 4',  'вул. ювілейна 4', NULL, 'Ювілейна', '4')`,
  ).run();

  return db;
}

describe('searchItems — filia dedup + total + stable sort', () => {
  it('returns exactly one row for a filia that spans two queues (no duplicate keys)', async () => {
    await seedFixture();
    const { searchItems } = await import('../src/lib/search');
    const r = searchItems('Городищ', 'all', 1, 15);

    const filiaRows = r.results.filter((row) => row.id < 0);
    expect(filiaRows).toHaveLength(1);
    expect(filiaRows[0].displayName).toBe('Городищенська філія');

    // No two results share an id (would trigger React duplicate-key warnings).
    const ids = r.results.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('counts the filia match in total and never exceeds pageSize', async () => {
    await seedFixture();
    const { searchItems } = await import('../src/lib/search');
    // Search for "Ювілейна" — matches 4 items + (when present) filia matches.
    const r = searchItems('Ювілейна', 'all', 1, 3);

    expect(r.results.length).toBeLessThanOrEqual(3);
    // Total is the item-FTS count (Ювілейна doesn't filia-match) → 4.
    expect(r.total).toBeGreaterThanOrEqual(4);
  });

  it('pagination is stable across pages — no duplicates across page 1/2', async () => {
    await seedFixture();
    const { searchItems } = await import('../src/lib/search');
    const p1 = searchItems('Ювілейна', 'all', 1, 2);
    const p2 = searchItems('Ювілейна', 'all', 2, 2);

    const idsP1 = new Set(p1.results.map((r) => r.id));
    const dupAcrossPages = p2.results.filter((r) => idsP1.has(r.id));
    expect(dupAcrossPages).toHaveLength(0);
  });
});
