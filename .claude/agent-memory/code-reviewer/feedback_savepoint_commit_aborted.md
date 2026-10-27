---
name: savepoint-commit-aborted
description: Savepoint-around-INSERT pattern (D-092/D-116, slice 005) is not proven by API tests, since Postgres turns COMMIT of an aborted transaction into a silent ROLLBACK
metadata:
  type: feedback
---

Routes in this repo wrap an INSERT that can fail with an expected SQLSTATE in a SAVEPOINT, then return a typed error and let `withTenant` COMMIT. Removing the savepoint does not break any API test: Postgres answers COMMIT on an aborted transaction with a ROLLBACK and no error, so the route still returns the same status.

**Why:** seen in review-005 (2026-10-27, SUGGESTION). The journal rationale ("avoid a COMMIT on a failed transaction") read as if this were a correctness requirement.

**How to apply:** do not count the savepoint as tested; flag it as a SUGGESTION (correct the rationale or add a proof), not as a defect. It only matters if code writes after the refusal. Related: [[fixed-message-tests]].
