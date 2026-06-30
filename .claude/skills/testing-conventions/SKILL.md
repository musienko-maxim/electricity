---
name: testing-conventions
description: Use when writing or running tests in this project — Vitest setup, the singleton-reset pattern, and the red→green→commit cadence.
---

# Testing Conventions

- Runner: **Vitest** (`npm test` = `vitest run`, `npm run test:watch`). Node environment,
  `globals: false` — import `describe/it/expect/vi` from `'vitest'`.
- Test locations: `tests/**/*.test.ts` and `src/**/*.test.ts`. Alias `@/` → `src/`.
- **Module singletons** (e.g. `ingest-state`): give each test a fresh instance with
  `vi.resetModules()` in `beforeEach`, then `vi.doMock('@/lib/...', () => ({ ... }))` **before**
  `await import(...)`. Use `vi.restoreAllMocks()` in `afterEach`.
- **SSE / stream routes:** read chunks via `res.body!.getReader()` and assert on decoded text;
  verify listener cleanup after `reader.cancel()`.
- **Cadence:** failing test → commit (`test(...)`) → implement → `npm test` green → commit
  (`feat(...)`). See skill `git-workflow`.
- Report real pass/fail counts; never claim green without running.
