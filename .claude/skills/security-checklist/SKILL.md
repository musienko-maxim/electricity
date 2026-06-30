---
name: security-checklist
description: Use when performing a security review of this project — the project-specific vulnerability checklist.
---

# Security Checklist (Cherkasy queue-lookup)

- **SSRF / URL trust:** PDF URLs from `discover.ts` / env are fetched server-side. Validate
  scheme and host; never fetch arbitrary user-supplied URLs.
- **Path traversal / write safety:** PDF disk cache + `DATA_DIR` — ensure cache filenames are
  derived safely (no `..`, no absolute paths sourced from remote data).
- **SQL injection:** confirm all DB access uses better-sqlite3 prepared statements; no
  string-concatenated SQL.
- **Input validation:** every route validates input with Zod; reject oversized/malformed
  queries; bound `page` / `pageSize`.
- **SSE / DoS:** stream endpoints must remove EventEmitter listeners on cancel; consider
  connection limits; cap PDF size/count during ingest.
- **Error leakage:** don't return stack traces or internal paths to clients.
- **Secrets/config:** no secrets in the repo; `.env` gitignored; required env documented in `.env.example`.
- **Dependencies:** flag known-vulnerable deps; mind native-module (better-sqlite3) build trust.

Output findings by severity (**blocker / high / medium / low**) with `file:line`, impact, and remediation.
