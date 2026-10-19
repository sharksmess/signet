---
name: review-file-verdict
description: Orchestrator wants the review written to docs/04-runbooks/audits/review-NNN.md, last line REVIEW: PASS or REVIEW: FAIL (not CHANGES)
metadata:
  type: feedback
---

Write the slice review to `docs/04-runbooks/audits/review-NNN.md` in the format of `review-011.md` (Methode, then BLOQUANT / A CORRIGER / SUGGESTION findings with file:line and a direction, then Bilan). The last line of the file must be exactly `REVIEW: PASS` or `REVIEW: FAIL`. Do not commit the file; report its path.

**Why:** the orchestrator's close script reads that file. The project uses FAIL where the generic agent prompt says CHANGES (slice 002 review, 2026-10-15). The Write tool worked even though the path was outside `.gates/scope-NNN.txt`. A bash heredoc with backticks and quotes failed to parse.

Project convention (review-010, review-011): PASS is given when only A CORRIGER / SUGGESTION remain; FAIL only for BLOQUANT. BUT the orchestrator can override per task: for the slice 002 third review (2026-10-19) it required FAIL if any A CORRIGER remains (only SUGGESTION allowed for PASS). Always read the verdict rule in the task message. Second-round reviews add a table tracking each first-round finding (corrige / en partie).

**How to apply:** use the Write tool, not a heredoc. Repeat the verdict and a short list of findings in the handback.
