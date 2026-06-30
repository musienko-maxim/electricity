# CLAUDE.md

## Project: Cherkasy Queue Lookup

Next.js 15 (App Router) + TypeScript app. Users enter an address, organization,
FOP, or person name and find which electricity shed-queue (черга + підчерга) they
belong to. Data comes from Cherkasyoblenergo outage-schedule PDFs at
`https://www.cherkasyoblenergo.com/static/perelik-gpv`, parsed and cached in SQLite.

## Commands

- `npm run dev` — dev server at http://localhost:3000 (ready immediately; ingest runs async)
- `npm run build` / `npm run start` — production build / serve
- `npm test` — Vitest (run once); `npm run test:watch`
- `npm run ingest` — one-off ingest (`scripts/ingest-once.ts`)
- Wipe SQLite cache (force cold-start): `rm -f data/cherkasy.sqlite data/cherkasy.sqlite-shm data/cherkasy.sqlite-wal`

## Architecture / data flow

PDF pipeline (`src/lib/pdf/`):
`discover.ts` (find PDF URLs) → `fetch.ts` (download + sha256, disk cache in `data/pdf-cache/`)
→ `extract.ts` (pdfjs table text) → `classify.ts` (filia / street / org / FOP / person)
→ `parse.ts` (→ `ParsedDocument`).
Then `ingest.ts` writes to SQLite (`db.ts`, schema in `schema.sql`) and returns `IngestResult`.
`ingest-state.ts` holds the in-memory `IngestState` singleton + `EventEmitter` + `runIngest()`.

API routes (`src/app/api/`): `search` (Zod-validated GET), `ingest/stream` (SSE progress),
`ingest/refresh` (POST re-ingest). `server/bootstrap.ts` fires `runIngest` fire-and-forget on startup.
UI: `page.tsx` → `ClientShell` → `IngestOverlay` (SSE) + `SearchBox`.

## Conventions

- TypeScript strict. Import alias `@/*` → `src/*`.
- `better-sqlite3` is **synchronous** — no `await` on DB calls; use prepared statements
  (`.prepare(...).get/all/run`).
- Validate all route inputs with **Zod** at the boundary.
- UI strings are **Ukrainian** — keep them.
- SSE event format: `event: <name>\ndata: <json>\n\n`.
- Module-level singletons (`ingest-state`): see skill `nextjs-route-singletons` for the
  dev-vs-prod caveat.

## Testing

- Vitest, node environment. Tests in `tests/**/*.test.ts` and `src/**/*.test.ts`.
- TDD: write a failing test, commit it (`test(scope): ...`), implement, commit (`feat(scope): ...`).
- Reset module singletons per-test with `vi.resetModules()` + `vi.doMock`. See skill `testing-conventions`.
- No Playwright yet — the `e2e-qa` agent scaffolds it.

## Git workflow

- Integration branch is **`oper`** (this repo's "main"). **Never commit directly on `oper`.**
- Branch per task off `oper`: `step<N>` for plan steps, or `feat/<slug>` / `fix/<slug>` / `docs/<slug>`.
- Conventional commits with scope: `feat(ingest): ...`, `test(search): ...`, `fix(ui): ...`, `docs: ...`.
- End commit messages with: `Co-Authored-By: Claude <noreply@anthropic.com>`.
- `npm test` must be green before merge/PR.
- `tsconfig.tsbuildinfo` is generated — keep it gitignored; don't commit it.
- Full procedure: skill `git-workflow`.

## Multi-agent workflow

The main session is the **orchestrator**: it splits work, dispatches subagents, integrates
results, makes decisions, and owns cross-layer integration. Subagents are **stateless** and
**do not talk to each other** — all coordination routes through the orchestrator. Every agent
is a full team member: argue your position, raise risks, don't just execute.

Roster (`.claude/agents/`):

| Agent | Tools | Role |
|---|---|---|
| `feature-developer` | full | Vertical-slice implementation, TDD-first |
| `tester` | Read/Edit/Write/Bash | Vitest unit + feature tests |
| `e2e-qa` | Read/Edit/Write/Bash | Playwright e2e + user stories |
| `code-reviewer` | read-only | Quality audit → report |
| `security-reviewer` | read-only | Vulnerability review → report |
| `docs-writer` | Read/Edit/Write | Technical docs under `docs/` |
| `devops` | Read/Edit/Write/Bash | Docker packaging (final phase) |

Shared skills (`.claude/skills/`): `git-workflow`, `testing-conventions`, `pdf-ingest-pipeline`,
`running-the-app`, `nextjs-route-singletons`, `security-checklist`.

### Parallel execution

**Default to dispatching agents in parallel whenever their tasks are independent** — different
subsystems, different files, no shared state. Examples: `code-reviewer` + `security-reviewer`
auditing the same diff at once; one `feature-developer` per independent vertical slice; several
agents fixing unrelated failing test files. Run them **sequentially only** when one needs another's
output, or they'd edit the same files. Decision rule + prompt structure: skill
`superpowers:dispatching-parallel-agents`.

The orchestrator dispatches all independent agents in a **single batch** (multiple Agent calls in
one turn), then integrates: read each summary, check for conflicts, run `npm test` on the merged
result, and resolve seams before moving on.

### Worktree isolation (avoid parallel-agent conflicts)

**Any agent that writes code in parallel gets its own git worktree** so concurrent agents never
collide in one working tree. Mechanics + safety steps: skill `superpowers:using-git-worktrees`.

- Worktrees live under **`.worktrees/<branch>`** at the repo root (gitignored). Use a native
  worktree tool if one is available; otherwise `git worktree add .worktrees/<branch> -b <branch>`.
- Each writing agent works on **its own branch off `oper`** (`step<N>` / `feat/<slug>` / `fix/<slug>`).
- **Read-only agents** (`code-reviewer`, `security-reviewer`) need no worktree — they don't write,
  so they can share the current checkout even in parallel.
- The orchestrator integrates each agent's branch, runs `npm test` on the merged result, opens the
  PR to `oper` (skill `git-workflow`), then removes finished worktrees (`git worktree remove`).

## Gotchas

- **Next.js dev** compiles each route as a separate bundle → module-level singletons are
  duplicated per route; only shared in production. Verify state-coherence with a prod build.
  (skill `nextjs-route-singletons`)
- This harness blocks foreground `sleep` — poll with bounded loops instead.
- `pkill -f "<pattern>"` can match and kill the wrapping shell if the pattern is in its argv —
  kill by PID (`ss -ltnp | grep :3000`) instead.
