---
name: pdf-ingest-pipeline
description: Use when working on or debugging PDF ingestion — the discover→fetch→extract→classify→parse→ingest pipeline, probe scripts, and caching.
---

# PDF Ingest Pipeline

Flow (`src/lib/pdf/` → `src/lib/`):

1. `discover.ts` — find PDF URLs from `CHERKASY_INDEX_URL`.
2. `fetch.ts` — download, sha256, cache to `data/pdf-cache/`. A re-ingest is **skipped** when the
   sha256 matches an existing `pdfs` row.
3. `extract.ts` — pdfjs text extraction. Table structure: col 1 = filia / ЕМ (district network),
   col 2 = streets / orgs / persons.
4. `classify.ts` — tag items: `street` / `street_with_numbers` / `settlement` / `organization` /
   `fop` / `person`.
5. `parse.ts` — assemble `ParsedDocument` (queueNumber, subQueue, label, entries).
6. `ingest.ts` → SQLite (`db.ts`, `schema.sql`); returns `IngestResult` (incl. `label`).
7. `ingest-state.ts` — `runIngest(urls)` drives the loop, updates the singleton, and emits
   `pdf-done` / `done` / `ingest-error`.

Debug tools (`scripts/`): `probe-extract.ts`, `probe-parse.ts`, `probe-dahn.ts`,
`ingest-once.ts` (`npm run ingest`).

Domain notes:
- Streets without numbers repeat across files (rural areas, whole-street outages) → surface the
  **filia/district** rather than a specific address.
- Normalization (`вул.` vs `вулиця`, etc.) lives in `normalize.ts`.
- Cold-start re-ingest: wipe `data/cherkasy.sqlite*` (see skill `running-the-app`).
