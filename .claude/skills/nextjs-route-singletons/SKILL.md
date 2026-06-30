---
name: nextjs-route-singletons
description: Use when relying on a module-level singleton shared across Next.js App Router routes (e.g. ingest-state) — the dev-vs-prod duplication caveat and how to verify.
---

# Next.js Route Singletons (dev-vs-prod caveat)

**Symptom:** A module-level singleton (like `ingest-state`'s `ingestState` + `EventEmitter`)
appears **not shared** across routes under `next dev` — e.g. `/api/ingest/stream` reports `done`
while `/api/search` still sees `idle`, and each route triggers its own bootstrap ingest.

**Cause:** `next dev` compiles each route handler as a separate on-demand bundle, so the module is
instantiated per route. In a **production** build (`next build` + `next start`) the routes share
one module instance and the singleton is coherent. *(Confirmed empirically on this project.)*

**Rules:**
- Don't trust cross-route singleton state observed in dev. Confirm any singleton-dependent
  behavior with a production build.
- **Verification recipe:** build, start, hit `/api/ingest/stream` until `done`, then immediately
  `/api/search` — results must be coherent (both reflect `done`).
- If you ever need cross-route shared state in dev too, hoist it onto a guarded `globalThis`
  property rather than a plain module variable.
