---
name: parallel-reviews-no-pnpm-test
description: When reviewing in parallel with security-auditor/contract-guardian, do not run pnpm test (shared test DB and port); pnpm run check is safe
metadata:
  type: feedback
---

Do not run `pnpm test` during a slice review when other reviewers run in parallel; `pnpm run check` is fine.

**Why:** the vitest globalSetup drops/recreates the same test database and binds the same server port, so concurrent runs produce cross-failures (orchestrator instruction, slice 010 review, 2026-09-30). The orchestrator runs the suite itself and reports the result.

**How to apply:** rely on the orchestrator's reported test result, state in the report that it was not independently re-run, and verify test logic by reading (e.g. red-before-green reasoning against the previous migrations).
