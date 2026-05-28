import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dataDir = resolve(process.env.DATA_DIR ?? './data');
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, 'cherkasy.sqlite');

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  const schemaPath = resolve(process.cwd(), 'src/lib/schema.sql');
  const schema = readFileSync(schemaPath, 'utf8');
  db.exec(schema);

  _db = db;
  return db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
