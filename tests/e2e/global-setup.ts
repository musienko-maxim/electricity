/**
 * Playwright global-setup: runs once before all tests, AFTER the webServer is
 * ready but before browsers open.
 *
 * Creates a pre-seeded SQLite database in tests/e2e/fixtures/data/ so that the
 * e2e server (started with DATA_DIR pointing to that directory and
 * CHERKASY_E2E_SEED_COMPLETED_AT set) can serve real search results without
 * fetching any remote PDFs.
 *
 * Data included:
 *   - 20 × street_with_numbers "вул. Тестова {n}"   → pagination tests (2 pages @ pageSize=15)
 *   -  3 × street_with_numbers "вул. Ювілейна {n}"  → basic address search
 *   -  1 × organization  "ТОВ Черкасиенерго"         → kind-filter tests
 *   -  1 × fop           "ФОП Іваненко І.І."
 *   -  1 × person        "Іваненко Іван Іванович"
 *
 * All items belong to queue "1 черга, І підчерга" under "Черкаська філія".
 */

import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PROJECT_ROOT = resolve(process.cwd());
const FIXTURE_DATA_DIR = join(PROJECT_ROOT, 'tests', 'e2e', 'fixtures', 'data');
const DB_PATH = join(FIXTURE_DATA_DIR, 'cherkasy.sqlite');

export default async function globalSetup(): Promise<void> {
  mkdirSync(FIXTURE_DATA_DIR, { recursive: true });

  // Remove stale DB from a previous run to start fresh
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  // Also remove WAL/SHM if left from an unclean shutdown
  for (const ext of ['-shm', '-wal']) {
    if (existsSync(DB_PATH + ext)) unlinkSync(DB_PATH + ext);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Apply the production schema (triggers included — they populate items_fts)
  const schema = readFileSync(
    join(PROJECT_ROOT, 'src', 'lib', 'schema.sql'),
    'utf8',
  );
  db.exec(schema);

  // ── Reference data ──────────────────────────────────────────────────────────

  db.prepare(`
    INSERT INTO pdf_sources (id, url, etag, last_modified, sha256, fetched_at, status)
    VALUES (1, 'http://e2e-fixture/1.pdf', NULL, NULL, 'e2esha1', '2026-01-01', 'ready')
  `).run();

  db.prepare(`
    INSERT INTO queues (id, queue_number, sub_queue, label, valid_from, valid_to, source_pdf_id)
    VALUES (10, 1, 1, '1 черга, І підчерга', '2026-01-01', '2026-06-30', 1)
  `).run();

  db.prepare(`
    INSERT INTO filias (id, name) VALUES (100, 'Черкаська філія')
  `).run();

  db.prepare(`
    INSERT INTO entries (id, queue_id, filia_id, raw_text, page_number)
    VALUES (1000, 10, 100, 'Тестові дані', 1)
  `).run();

  // ── Items ───────────────────────────────────────────────────────────────────

  // 20 street items – enough to span two pages (pageSize = 15)
  const insertStreet = db.prepare(`
    INSERT INTO items
      (id, entry_id, kind, display_name, normalized, settlement, street_name, street_number)
    VALUES
      (?, 1000, 'street_with_numbers', ?, ?, NULL, 'Тестова', ?)
  `);
  for (let i = 1; i <= 20; i++) {
    insertStreet.run(
      9000 + i,
      `вул. Тестова ${i}`,
      `вул. тестова ${i}`,
      String(i),
    );
  }

  // 3 Ювілейна items – used for basic address search + kind filter tests
  const insertYuv = db.prepare(`
    INSERT INTO items
      (id, entry_id, kind, display_name, normalized, settlement, street_name, street_number)
    VALUES
      (?, 1000, 'street_with_numbers', ?, ?, NULL, 'Ювілейна', ?)
  `);
  for (let i = 1; i <= 3; i++) {
    insertYuv.run(
      9100 + i,
      `вул. Ювілейна ${i}`,
      `вул. ювілейна ${i}`,
      String(i),
    );
  }

  // Organization, FOP, person – used by kind-filter tests
  db.prepare(`
    INSERT INTO items
      (id, entry_id, kind, display_name, normalized, settlement, street_name, street_number)
    VALUES
      (9200, 1000, 'organization', 'ТОВ Черкасиенерго',      'тов черкасиенерго',      NULL, NULL, NULL),
      (9201, 1000, 'fop',         'ФОП Іваненко І.І.',       'фоп іваненко і.і.',       NULL, NULL, NULL),
      (9202, 1000, 'person',      'Іваненко Іван Іванович',  'іваненко іван іванович',  NULL, NULL, NULL)
  `).run();

  db.close();

  console.log(`[e2e global-setup] fixture DB ready → ${DB_PATH}`);
}
