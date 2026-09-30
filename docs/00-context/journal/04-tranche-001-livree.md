# 04 — Tranche 001 livree

- **Date** : 2026-09-28
- **Objectif** : boucler la chaine de bout en bout : cloture, PR, CI, fusion.

## Ce qui a ete fait
- `close-slice.sh` vert (46/46 tests, check, audit des dependances, verdicts PASS), commit bc7066e.
- `ship-slice.sh` : PR #1.
- CI rouge en 20 s (version de pnpm non declaree) : `packageManager` + lockfile (commits b709c9e, 23752fe), puis CI verte (1 min 41 s).
- Fusion en squash par l'humain : commit 55c3773 sur `main`.

## Decisions
- D-018 : `pnpm@12.3.4` declare (cowork). D-019 : PR #1 fusionnee (humain).
- D-020 : fusion sur preuves, sans relecture humaine du code (humain).
- D1/D2 poses a l'EDL : suite = usine puis tranche autonome (D-023) ; MINEUR-1 = option A (D-022).

## Incidents
11 faux echecs locaux (variables pointant sur la base de dev, cause non prouvee) ; une recherche d'agent a affiche deux lignes non secretes de `.env.test.local`. Traites en 1.4.0.

## Etat a la fin
Premiere tranche en production de code sur `main`. 9 MINEUR ouverts, 0 CRITIQUE, 0 MAJEUR.
