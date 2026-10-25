# 18 — Correctifs de securite : vite, next, zod

- **Dates** : 2026-10-21 → 2026-10-25
- **Objectif** : rendre a nouveau vert l'audit de la CI (`pnpm audit --prod --audit-level=high`), rouge sur toutes les PR dont #30 (usine 1.6.3).

## Ce qui a ete fait
- `vite` : `overrides` `>=8.3.3` (GHSA-587h-7wmj-h5pm, via `better-auth` > `vitest`), 8.3.5 installee.
- `next` et `eslint-config-next` 16.4.3, `zod` 4.6.7 : deux avis critiques et deux high publies pendant la preparation du correctif vite.
- Test AC16 « aucune dependance ajoutee » de la tranche 003 limite aux branches `slice/003-*` : il comparait `HEAD` a main sur toute branche.
- `apps/web/package.json` et le test ecrits par l'humain (commande PowerShell, diffs prepares et verifies par claude-code) : le hook `gate-check` refuse `apps/*` et `tests/*` hors tranche.

## Decisions
- D-098 (vite), D-099 (test AC16), D-100 (next, zod) ; ADR-0013 § 2026-10-25.

## Preuves
`pnpm audit --prod --audit-level=high` (aucune vulnerabilite connue), `pnpm test`, `pnpm run check`, CI de la PR.

## Incidents
- Echeance de 48 h des avis next (vers le 2026-10-24T16:00Z) depassee de moins d'un jour : pas de chemin de maintenance de securite hors tranche (FRICTION, usine 1.6.4).
- Residu hors `--prod` : `next` 16.3.8 et `zod` 4.6.5 dans l'arbre de developpement (D-100).

## Etat a la fin
PR ouverte. La PR #30 (usine 1.6.3, journal 17) reste a fusionner : `docs/DECISIONS.md` et `docs/00-context/JOURNAL.md` se rebasent alors trivialement.

## Etape suivante
Fusion de cette PR, puis de #30 rebasee ; tranche 006 (acceptation d'une invitation).
