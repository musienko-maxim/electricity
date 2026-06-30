# Contributing to Cherkasy Queue Lookup

This guide is for developers and operators working on the project. It is the human-facing
counterpart to `CLAUDE.md`, which is the agent-facing specification — refer to `CLAUDE.md`
for deeper architectural detail and agent-workflow rules.

---

## Prerequisites and setup

- Node.js 20+
- `npm install` (installs Next.js 15, better-sqlite3, pdfjs-dist, Zod, Vitest, etc.)
- No database setup needed — SQLite is created automatically on first ingest.

```bash
git clone <repo-url>
cd cherkasy-queue-lookup
npm install
```

---

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server at http://localhost:3000 (ingest runs async in background) |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm test` | Run Vitest once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run ingest` | One-off ingest via `scripts/ingest-once.ts` |

### Wiping the SQLite cache (force cold-start)

```bash
rm -f data/cherkasy.sqlite data/cherkasy.sqlite-shm data/cherkasy.sqlite-wal
```

The PDF disk cache at `data/pdf-cache/` is separate — keeping it makes a re-ingest faster
because PDFs whose sha256 matches an existing `pdfs` row are skipped.

---

## Project layout and data flow

```
src/
  app/
    page.tsx                  # Root page → ClientShell
    api/
      search/route.ts         # GET, Zod-validated
      ingest/stream/route.ts  # SSE progress stream
      ingest/refresh/route.ts # POST, triggers re-ingest
  lib/
    pdf/
      discover.ts             # Find PDF URLs from CHERKASY_INDEX_URL
      fetch.ts                # Download + sha256, cache to data/pdf-cache/
      extract.ts              # pdfjs text extraction
      classify.ts             # Tag items: street / org / fop / person / …
      parse.ts                # Assemble ParsedDocument
    ingest.ts                 # Write to SQLite; return IngestResult
    ingest-state.ts           # IngestState singleton + EventEmitter + runIngest()
    db.ts                     # better-sqlite3 connection (schema.sql)
    normalize.ts              # Street-name normalization
    search.ts                 # Search logic
  server/
    bootstrap.ts              # Fire-and-forget runIngest() on startup
scripts/
  ingest-once.ts              # npm run ingest entry point
  probe-extract.ts            # Debug: raw pdfjs output
  probe-parse.ts              # Debug: ParsedDocument output
  probe-dahn.ts               # Debug: district-network probing
data/
  pdf-cache/                  # Downloaded PDFs (gitignored)
  cherkasy.sqlite             # SQLite database (gitignored)
```

### PDF pipeline

```
discover → fetch → extract → classify → parse → ingest
```

1. `discover.ts` — list PDF URLs from the Cherkasyoblenergo index.
2. `fetch.ts` — download each PDF, compute sha256, cache to `data/pdf-cache/`; skip if
   sha256 already in the `pdfs` table.
3. `extract.ts` — extract table text with pdfjs. Table structure: column 1 = filia / ЕМ
   (district network), column 2 = streets / organizations / persons.
4. `classify.ts` — tag each entry: `street`, `street_with_numbers`, `settlement`,
   `organization`, `fop`, `person`.
5. `parse.ts` — assemble a `ParsedDocument` (queueNumber, subQueue, label, entries).
6. `ingest.ts` — write to SQLite via `db.ts` / `schema.sql`; return `IngestResult`.
7. `ingest-state.ts` — `runIngest(urls)` drives the loop, updates the `IngestState`
   singleton, and emits `pdf-done` / `done` / `ingest-error` events.

UI entry point: `page.tsx` → `ClientShell` → `IngestOverlay` (consumes SSE) + `SearchBox`.

---

## Coding conventions

- **TypeScript strict** throughout. Import alias `@/*` maps to `src/*`.
- **`better-sqlite3` is synchronous** — never `await` a DB call. Use prepared statements:
  `.prepare(...).get()`, `.prepare(...).all()`, `.prepare(...).run()`.
- **Zod at every route boundary** — validate and shape all incoming request data before
  touching business logic.
- **UI strings are Ukrainian** — do not translate or replace them.
- **SSE event format:** `event: <name>\ndata: <json>\n\n`. The stream route and the overlay
  component must agree on event names (`init`, `pdf-done`, `done`, `ingest-error`).
- **Module-level singletons** (e.g. `ingest-state`): in `next dev` each route is compiled as
  a separate bundle, so the singleton is duplicated per route. In production (`next build` +
  `next start`) routes share one instance. See the gotcha below and `CLAUDE.md` for details.

---

## TDD workflow

Tests live in `tests/**/*.test.ts` and `src/**/*.test.ts`. The runner is Vitest in a Node
environment. Import test helpers explicitly — `globals: false` is set.

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

### Red-green-commit cadence

1. Write a failing test and commit it:
   ```
   test(scope): add failing test for <feature>
   ```
2. Implement the feature until `npm test` is green.
3. Commit the implementation:
   ```
   feat(scope): implement <feature>
   ```

### Resetting module-level singletons between tests

Because `ingest-state` and `db` are module-level singletons, isolate each test with
`vi.resetModules()` and `vi.doMock()` — called **before** the dynamic `import()`:

```typescript
beforeEach(() => {
  vi.resetModules();
  vi.doMock('@/lib/ingest-state', () => ({
    // provide the fake singleton here
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

it('...', async () => {
  const { runIngest } = await import('@/lib/ingest-state');
  // ...
});
```

For SSE/stream routes: read chunks from `res.body!.getReader()` and assert on the decoded
text. Verify that EventEmitter listeners are cleaned up after `reader.cancel()`.

---

## Git workflow

The integration branch is **`oper`** — never commit directly on it.

### Branches

| Prefix | Use |
|---|---|
| `step<N>` | Numbered plan steps |
| `feat/<slug>` | New features |
| `fix/<slug>` | Bug fixes |
| `docs/<slug>` | Documentation |

```bash
git checkout oper
git pull
git checkout -b feat/my-feature
```

### Conventional commits

Format: `type(scope): short description`

Examples: `feat(ingest): add sha256 deduplication`, `test(search): add edge-case tests`,
`fix(ui): correct queue display`, `docs: add CONTRIBUTING`.

Every commit message must end with the trailer:

```
Co-Authored-By: Claude <noreply@anthropic.com>
```

### Before opening a PR

```bash
npm test   # must be green
```

Open the PR against `oper` (`gh pr create --base oper`). After merge, delete the feature
branch and re-run tests on the merged result.

Do not commit `tsconfig.tsbuildinfo` — it is generated and gitignored.

---

## Multi-agent and parallel-worktree workflow

This project is developed with Claude Code agents orchestrated from a main session.

### Roles

| Agent | Role |
|---|---|
| `feature-developer` | Vertical-slice implementation, TDD-first |
| `tester` | Vitest unit and feature tests |
| `e2e-qa` | Playwright end-to-end tests |
| `code-reviewer` | Read-only quality audit |
| `security-reviewer` | Read-only vulnerability review |
| `docs-writer` | Technical docs under `docs/` |
| `devops` | Docker packaging |

Agent definitions live in `.claude/agents/`. Shared reference skills are in `.claude/skills/`.

### Parallel execution

Independent agents are dispatched in a single batch — for example, `code-reviewer` and
`security-reviewer` auditing the same diff simultaneously, or separate `feature-developer`
instances working on unrelated vertical slices. Sequential dispatch is used only when one
agent's output is a required input for the next, or when agents would edit the same files.

### Worktree isolation

Any agent that writes code in parallel gets its own git worktree so concurrent agents never
collide in a single working tree.

```bash
git worktree add .worktrees/<branch> -b <branch>
```

Worktrees live under `.worktrees/<branch>` at the repo root (gitignored). Each writing agent
works on its own branch off `oper`. Read-only agents (`code-reviewer`, `security-reviewer`)
share the current checkout — they do not write, so isolation is not needed.

The orchestrator integrates each agent's branch, runs `npm test` on the merged result, opens
the PR to `oper`, and then removes finished worktrees:

```bash
git worktree remove .worktrees/<branch>
```

---

## Known gotchas

### Next.js dev: singleton duplication per route

`next dev` compiles each route handler as a separate on-demand bundle. A module-level
singleton (like `ingestState` in `ingest-state.ts`) is instantiated once per route, so
cross-route state sharing does not work in development. In a production build (`next build` +
`next start`) the routes share one module instance and the singleton is coherent.

**Rule:** do not trust cross-route singleton behavior observed under `next dev`. Verify with a
production build.

**Verification recipe:**

```bash
npm run build && npm run start
curl -sN http://localhost:3000/api/ingest/stream   # wait for done event
curl "http://localhost:3000/api/search?q=вулиця"  # must return results, not 503
```

If you ever need cross-route shared state under dev too, hoist the singleton onto a guarded
`globalThis` property rather than a plain module variable.

### Process management

Do not use `pkill -f "next ..."` — the pattern can match and kill the wrapping shell. Kill
by PID instead:

```bash
ss -ltnp | grep :3000
kill <pid>
```
