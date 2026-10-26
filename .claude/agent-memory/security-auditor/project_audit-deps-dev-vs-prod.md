---
name: audit-deps-dev-vs-prod
description: Sur Signet, `pnpm audit` complet remonte des avis dev-only (next 16.3.8 via @inngest/test, zod via eslint-config-next) que la CI (`--prod`) ne voit pas
metadata:
  type: project
---

Audit 004 (2026-10-26) : `pnpm audit` complet = 2 critiques + 2 hautes, toutes en
devDependencies : seconde copie `next@16.3.8` tiree par `@inngest/test>inngest` (peer),
et `zod` < 4.6.6 via `eslint-config-next`. L'app tourne sur `next@16.4.3` / `zod@4.6.7` ;
`pnpm audit --prod --audit-level=high` (critere de la CI) est propre.

**Why:** la CI et `close-slice.sh` ne regardent que `--prod` ; la copie dev de `next`
sert au harnais de test Inngest, jamais servie. Signale en INFO, hors perimetre de tranche.

**How to apply:** toujours lancer les deux (`pnpm audit` et `--prod`), verifier avec
`pnpm -C apps/web why next` quelle copie est servie, et ne classer MAJEUR que si la
version servie est touchee. Verifier si une tranche `chore/` a depuis aligne la copie dev.
Voir [[audit-scope-worktree]].
