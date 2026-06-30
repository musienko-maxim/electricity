---
name: git-workflow
description: Use when committing, branching, or opening PRs in the Cherkasy queue-lookup repo — the branch/commit/PR conventions for this project.
---

# Git Workflow

- **Integration branch:** `oper` (this repo's "main"). **Never commit directly on `oper`.**
- **Branch per task** off `oper`: `step<N>` for plan steps, or `feat/<slug>` / `fix/<slug>` / `docs/<slug>`.
- **Conventional commits with scope:** `feat(ingest): ...`, `test(search): ...`, `fix(ui): ...`,
  `docs: ...`, `chore: ...`.
- **TDD commits:** commit the failing test (`test(scope): add failing ...`) before the
  implementation (`feat(scope): ...`).
- End every commit message with the trailer: `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Before merge/PR:** `npm test` must be green.
- **Finishing a branch:** open a PR to `oper` (`gh pr create`) or do a local `--no-ff` merge;
  re-run tests on the merged result; then delete the branch.
- **Parallel agents → worktrees:** when agents write code concurrently, isolate each in its own
  worktree under `.worktrees/<branch>` (gitignored) on its own branch off `oper`, so they don't
  collide in one working tree. Integrate branch-by-branch, then `git worktree remove`. See skills
  `superpowers:using-git-worktrees` and `superpowers:dispatching-parallel-agents`.
- Never force-push shared branches.
- Don't commit `tsconfig.tsbuildinfo` (generated; keep it gitignored).

End PR bodies with the harness's "Generated with Claude Code" trailer.
