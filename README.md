# Cherkasy Queue Lookup

Find out which electricity shed-queue (**черга + підчерга**) an address, organization,
FOP, or person belongs to in the Cherkasy region.

The app scrapes the official Cherkasyoblenergo outage-schedule PDFs from
[`/static/perelik-gpv`](https://www.cherkasyoblenergo.com/static/perelik-gpv), parses
their tables, and caches everything in SQLite so users get an instant full-text search
over ~760 schedule entries. The UI is in **Ukrainian**.

> **Why it exists:** Cherkasyoblenergo publishes 12 separate PDFs (one per queue/sub-queue)
> and rotates their URLs on every republication. Reading them by hand to find your street
> is painful. This app ingests all 12 automatically and makes them searchable.

---

## Tech stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript** (strict)
- **better-sqlite3** — synchronous SQLite with FTS full-text search
- **pdfjs-dist** — PDF table-text extraction
- **Zod** — request validation at every route boundary
- **Radix UI** + **lucide-react** — UI primitives
- **Vitest** (unit/feature) + **Playwright** (e2e)

Requires **Node.js 20+**.

---

## Quick start

```bash
npm install
cp .env.example .env      # then review the values (see Configuration below)
npm run dev               # http://localhost:3000
```

The dev server is ready immediately; the first ingest runs asynchronously in the
background. An overlay shows live ingest progress over SSE, then search becomes available.

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server at http://localhost:3000 (ingest runs async on boot) |
| `npm run build` / `npm run start` | Production build / serve |
| `npm test` | Vitest, run once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Playwright e2e (Chromium) |
| `npm run ingest -- <pdf-url>` | One-off single-PDF ingest (`scripts/ingest-once.ts`) |
| `npm run lint` | Next.js lint |

**Wipe the SQLite cache** (force a cold-start re-ingest):

```bash
rm -f data/cherkasy.sqlite data/cherkasy.sqlite-shm data/cherkasy.sqlite-wal
```

---

## Configuration

Environment variables (see `.env.example`):

| Variable | Required | Default | Description |
|---|---|---|---|
| `CHERKASY_INDEX_URL` | Recommended | — | Index page listing all 12 outage-schedule PDFs. Scraped on each startup so the app self-heals when upstream rotates URLs. Set to `https://www.cherkasyoblenergo.com/static/perelik-gpv`. |
| `CHERKASY_SAMPLE_PDF_URL` | Optional | — | Direct URL to a single PDF (fallback/dev mode). Used only if `CHERKASY_INDEX_URL` is unset, or appended if not already in the discovered set. |
| `DATA_DIR` | Optional | `./data` | Where SQLite + cached PDFs are stored. |
| `CHERKASY_ALLOWED_HOSTS` | Optional | `gita.cherkasyoblenergo.com,www.cherkasyoblenergo.com` | SSRF allowlist (CSV). `fetchPdf` only downloads PDFs from these hosts and refuses redirects that leave them. |

If neither `CHERKASY_INDEX_URL` nor `CHERKASY_SAMPLE_PDF_URL` is set, the app boots and
serves the UI, but search returns `503 not_ready` until at least one ingest succeeds.

---

## How it works

### PDF ingest pipeline (`src/lib/pdf/`)

```
discover.ts  → find the 12 PDF URLs by scraping CHERKASY_INDEX_URL
   ↓
fetch.ts     → download + sha256, disk-cache in data/pdf-cache/ (SSRF-allowlisted,
               size-capped, conditional GET via etag/last-modified)
   ↓
extract.ts   → pdfjs table-text extraction (col 1 = filia/ЕМ, col 2 = streets/orgs/persons)
   ↓
classify.ts  → tag each item: street / street_with_numbers / settlement / organization / fop / person
   ↓
parse.ts     → assemble a ParsedDocument (queueNumber, subQueue, label, entries)
   ↓
ingest.ts    → write to SQLite (schema.sql); returns an IngestResult
```

`ingest-state.ts` holds the in-memory `IngestState` singleton + `EventEmitter` and drives
the loop via `runIngest(urls)`, emitting `pdf-done` / `done` / `ingest-error`.
`server/bootstrap.ts` fires `runIngest` fire-and-forget on startup.

**Notable robustness details:**
- **Self-healing discovery** — the index page is re-scraped on every ingest, so rotated
  per-publication UUIDs are picked up automatically. `discover.ts` matches PDF links by
  their stable `obl_main_static…​.pdf` filename and accepts both absolute CDN URLs and
  root-relative hrefs, resolving the latter against the index URL.
- **sha256 dedupe** — a re-ingest is skipped when a PDF's hash matches an existing row.
- **SSRF hardening** — PDF hosts are allowlisted and redirects are followed manually so
  each hop's host is re-validated; downloads are size-capped and magic-byte-checked before
  being cached.

### API routes (`src/app/api/`)

| Route | Method | Notes |
|---|---|---|
| `/api/search` | GET | Zod-validated query: `q` (1–120 chars), `kind` (`all`\|`address`\|`org`\|`fop`\|`person`), `page` (1–1000), `pageSize` (1–50). Returns `{ total, page, pageSize, results }`. `503 not_ready` before first ingest. |
| `/api/ingest/stream` | GET | Server-Sent Events stream of ingest progress. Event format: `event: <name>\ndata: <json>\n\n`. |
| `/api/ingest/refresh` | POST | Trigger a re-ingest. Rate-limited (`429 rate_limited`). |

### UI (`src/`)

`app/page.tsx` → `ClientShell` → `IngestOverlay` (subscribes to the SSE stream) +
`SearchBox` (queries `/api/search`).

### Domain notes

- Streets without numbers repeat across files (rural/whole-street outages) → the app
  surfaces the **filia/district** rather than a specific address.
- Text normalization (`вул.` vs `вулиця`, etc.) lives in `src/lib/normalize.ts`.

---

## Project layout

```
src/
  app/            Next.js App Router — page, layout, API routes
  components/     ClientShell, IngestOverlay, SearchBox
  lib/
    pdf/          discover → fetch → extract → classify → parse pipeline
    ingest.ts     writes a parsed document to SQLite
    ingest-state.ts  in-memory ingest singleton + EventEmitter + runIngest()
    db.ts         better-sqlite3 handle; schema in schema.sql
    search.ts     FTS query builder
    normalize.ts  Ukrainian street/name normalization
  server/
    bootstrap.ts  fires runIngest on startup
scripts/          ingest-once.ts + probe-* debugging helpers
tests/            Vitest unit/feature tests + Playwright e2e (tests/e2e/)
docs/             deployment.md and other operator docs
```

---

## Testing

- **Vitest** (node env) — tests in `tests/**/*.test.ts` and `src/**/*.test.ts`.
- **TDD workflow:** write a failing test and commit it (`test(scope): …`), then implement
  and commit (`feat(scope): …` / `fix(scope): …`).
- Module-level singletons (e.g. `ingest-state`) are reset per-test with `vi.resetModules()`
  + `vi.doMock`.
- **Playwright e2e** in `tests/e2e/` (`npm run test:e2e`, Chromium): seeds a fixture SQLite
  DB via the `CHERKASY_E2E_SEED_COMPLETED_AT` bootstrap hook.

```bash
npm test              # unit + feature (must be green before any merge/PR)
npm run test:e2e      # browser e2e
```

---

## Deployment

Production runs as a long-lived Node.js server (VPS or Docker). See
**[`docs/deployment.md`](docs/deployment.md)** for the full Docker-on-VPS guide (build,
volume mounts for `DATA_DIR`, environment, health behavior).

> **Dev-vs-prod caveat:** Next.js dev compiles each route as a separate bundle, so
> module-level singletons (`ingest-state`) are duplicated per route; they're only shared in
> a production build. Verify state-coherence against `npm run build && npm run start`.

---

## Contributing

Conventions, the multi-agent development workflow, and branch/commit rules live in
**[`CONTRIBUTING.md`](CONTRIBUTING.md)** and **[`CLAUDE.md`](CLAUDE.md)**. In short:

- TypeScript strict; import alias `@/*` → `src/*`.
- `better-sqlite3` is **synchronous** — no `await` on DB calls; use prepared statements.
- Validate all route inputs with **Zod** at the boundary.
- UI strings are **Ukrainian** — keep them.
- Integration branch is **`oper`** — never commit directly to it; branch per task
  (`feat/<slug>` / `fix/<slug>` / `docs/<slug>`) and open a PR. `npm test` must be green
  before merge.
