-- Cherkasy queue-lookup schema.
-- Designed for extension: future `hourly_schedules` table joins on queues.id
-- without touching ingestion or search code.

CREATE TABLE IF NOT EXISTS pdf_sources (
  id            INTEGER PRIMARY KEY,
  url           TEXT UNIQUE NOT NULL,
  etag          TEXT,
  last_modified TEXT,
  sha256        TEXT NOT NULL,
  fetched_at    TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending','parsing','ready','failed'))
);

CREATE TABLE IF NOT EXISTS queues (
  id            INTEGER PRIMARY KEY,
  queue_number  INTEGER NOT NULL,
  sub_queue     INTEGER NOT NULL,
  label         TEXT NOT NULL,
  valid_from    TEXT,
  valid_to      TEXT,
  source_pdf_id INTEGER REFERENCES pdf_sources(id) ON DELETE CASCADE,
  -- Uniqueness is scoped per source PDF: each pdf_sources row owns its own
  -- queue. Without the source_pdf_id in the key, two different URLs that
  -- parse to the same (queue_number, sub_queue) would silently steal the
  -- queue row from each other on ON CONFLICT and orphan/corrupt entries.
  UNIQUE (queue_number, sub_queue, source_pdf_id)
);

CREATE TABLE IF NOT EXISTS filias (
  id   INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id          INTEGER PRIMARY KEY,
  queue_id    INTEGER NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
  filia_id    INTEGER NOT NULL REFERENCES filias(id),
  raw_text    TEXT NOT NULL,
  page_number INTEGER
);

CREATE TABLE IF NOT EXISTS items (
  id            INTEGER PRIMARY KEY,
  entry_id      INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('street','street_with_numbers','settlement','organization','fop','person')),
  display_name  TEXT NOT NULL,
  normalized    TEXT NOT NULL,
  settlement    TEXT,
  street_name   TEXT,
  street_number TEXT
);

CREATE INDEX IF NOT EXISTS idx_items_kind ON items(kind);
CREATE INDEX IF NOT EXISTS idx_items_entry ON items(entry_id);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  normalized,
  display_name,
  content='items',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, normalized, display_name)
  VALUES (new.id, new.normalized, new.display_name);
END;

CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, normalized, display_name)
  VALUES ('delete', old.id, old.normalized, old.display_name);
END;

CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, normalized, display_name)
  VALUES ('delete', old.id, old.normalized, old.display_name);
  INSERT INTO items_fts(rowid, normalized, display_name)
  VALUES (new.id, new.normalized, new.display_name);
END;
