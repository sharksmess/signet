---
name: review-file-verdict
description: Orchestrator wants the review written to docs/04-runbooks/audits/review-NNN.md, last line REVIEW: PASS or REVIEW: FAIL (not CHANGES)
metadata:
  type: feedback
---

Write the slice review to `docs/04-runbooks/audits/review-NNN.md` in the format of the previous review (Methode, then BLOQUANT / A CORRIGER / SUGGESTION findings with file:line and a direction, then Bilan). The last line of the file must be exactly `REVIEW: PASS` or `REVIEW: FAIL`. Do not commit the file; report its path.

**Why:** the orchestrator's close script reads that file. The project uses FAIL where the generic agent prompt says CHANGES (slice 002 review, 2026-10-15).

Project convention (review-010 to review-013): PASS when only A CORRIGER / SUGGESTION remain; FAIL only for BLOQUANT. The orchestrator can override per task (slice 002 third review, 2026-10-19: FAIL if any A CORRIGER remains). Always read the verdict rule in the task message. Second-round reviews add a table tracking each first-round finding.

**How to apply:** use the Write tool when available. When only Bash is available (slice 012, 2026-10-28): one big quoted heredoc (`<<'EOF'`) of ~100 lines failed with "unexpected EOF while looking for matching '"; writing the same text in 3-4 chunks (`cat >` then `cat >>`, each `<<'EOF'`) worked. Repeat the verdict and a short list of findings in the handback.
