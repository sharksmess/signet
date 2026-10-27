---
name: fixed-message-tests
description: Checking tests of "fixed error message" decisions; "value not echoed" tests do not prove "no Zod message"; when texts are deliberately not frozen (D-124), check order/equality-class assertions instead
metadata:
  type: feedback
---

When a slice decides "422/409 messages are fixed, no submitted value, no Zod message" (D-107 in 006, D-114 point 4 in 004), check that a test compares `message` to the exact fixed texts. Tests that only assert the body does not contain the submitted value pass even under the mutation `validationFailed(parsed.error.message)`, because Zod 4 messages do not echo the input.

Exception: in slice 005 the human decided (D-124) NOT to freeze the 422 texts. Then do not ask for exact texts; instead check that ordering rules ("url and title invalid -> url message") are proven by comparing equality classes (url-only message differs from title-only message). Equality-only tests pass under the mutation "one constant message for every 422" (review-005, A CORRIGER 2).

**Why:** the human reopened slice 006 (D-111) because the D-107 texts had no automated proof. The same gap came back in slice 004 (review-004, A CORRIGER 1, 2026-10-26).

**How to apply:** read the registry first to know whether texts are frozen; then run the mutations "return the Zod message" and "constant message" in your head against the 422 tests. See [[review-file-verdict]] and [[savepoint-commit-aborted]].
