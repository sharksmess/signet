---
name: fixed-message-tests
description: Checking tests of "fixed error message" decisions; "value not echoed" tests do not prove "no Zod message" since Zod 4 messages never echo input
metadata:
  type: feedback
---

When a slice decides "422/409 messages are fixed, no submitted value, no Zod message" (D-107 in 006, D-114 point 4 in 004), check that a test compares `message` to the exact fixed texts. Tests that only assert the body does not contain the submitted value pass even under the mutation `validationFailed(parsed.error.message)`, because Zod 4 messages do not echo the input.

**Why:** the human reopened slice 006 (D-111) because the D-107 texts had no automated proof. The same gap came back in slice 004 (review-004, A CORRIGER 1, 2026-10-26).

**How to apply:** when relevant, run the mutation "return the Zod message" in your head against the 422 tests; flag it as A CORRIGER if they stay green. See [[review-file-verdict]].
