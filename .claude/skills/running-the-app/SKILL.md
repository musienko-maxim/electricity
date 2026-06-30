---
name: running-the-app
description: Use when running, building, or smoke-testing the app — dev/prod commands, wiping the cache, and the cold-start verification recipe.
---

# Running the App

- **Dev:** `npm run dev` → http://localhost:3000 (server is ready immediately; ingest runs async).
- **Prod:** `npm run build` then `npm run start`.
- **Tests:** `npm test`.
- **Wipe the SQLite cache** (force cold-start):
  `rm -f data/cherkasy.sqlite data/cherkasy.sqlite-shm data/cherkasy.sqlite-wal`.
  The PDF disk cache (`data/pdf-cache/`) keeps a re-ingest fast.

## Cold-start smoke test

1. Wipe cache; start server.
2. `curl -sN http://localhost:3000/api/ingest/stream` → expect `init` → ~12× `pdf-done` → `done`.
3. `curl "http://localhost:3000/api/search?q=..."` → 503 `not_ready` while idle, 200 with results once `done`.
4. `curl -X POST http://localhost:3000/api/ingest/refresh` → 202; re-ingest advances `completedAt`.

## Harness gotchas

- Foreground `sleep` is blocked — poll with a bounded `for` loop + `curl`, or run servers in the background.
- Don't `pkill -f "next ..."` — the pattern can match and kill the wrapping shell. Kill by PID:
  `ss -ltnp | grep :3000`.
- Verify singleton/state coherence with a **production** build (see skill `nextjs-route-singletons`).
