# 28 — Avis transitifs avant l'usine 1.6.7

- **Dates** : 2026-11-24
- **Objectif** : rendre `pnpm audit --prod --audit-level=moderate` propre (seuil de l'usine 1.6.7) et ne plus laisser aucun avis `high` ou `critical`, meme en developpement, en traitant ensemble les trois points du backlog laisses par le correctif next 16.4.5 (D-162, D-163).

## Ce qui a ete fait
- Branche `fix/audit-transitifs` depuis `main` a jour (8493748, PR #49), consigne `docs/04-runbooks/consigne-correctif-audit-transitifs.md` de l'orchestrateur, chemin « correctif de securite hors tranche ».
- **Etape 1, analyse** (lecture seule) : `pnpm why`, registre npm, API des avis GitHub. Arret de l'agent comme prevu par la consigne : `glob` et `minimatch` n'ont de correctif que dans une majeure hors de la plage de leur parent ; constat que `gaxios` 7.1.3 n'importe jamais `rimraf`, donc ni `glob` ni ce `minimatch`. Quatre options presentees a l'humain.
- **Arbitrage humain** (D-165) : option 1 modifiee, `typescript-eslint` laisse en 8.72.0 (quarantaine).
- `.logs/` ajoute au `.gitignore` (regle de l'usine 1.6.7). Commit 682a494.
- `pnpm-workspace.yaml` : `overrides` `"inngest>next": "16.4.5"` pour la copie `next@16.3.8` installee d'office sous `@inngest/test` ; `auditConfig.ignoreGhsas` pour GHSA-3g3m-2fjr-6pw4 (`glob`) et GHSA-g3hv-75wg-m249 (`minimatch`), motif et decision en commentaire. Lockfile : `+1 -12`, seule la copie 16.3.8 et ce qui en depend disparaissent. Commit 2f8ebf3.
- Documentation : D-164 a D-166, section 2026-11-24 « avis transitifs » d'ADR-0013, backlog (trois points faits, ligne de reexamen des avis ecartes).

## Decisions
- D-164 : correctif groupe, une seule branche `fix/`, avant l'usine 1.6.7 (humain).
- D-165 : option 1 modifiee ; `glob` et `minimatch` ecartes par `auditConfig.ignoreGhsas`, signal de reexamen au backlog ; `typescript-eslint` reste en 8.72.0 ; `.logs/` ignore (humain).
- D-166 : application, selecteur `inngest>next` plutot que `@inngest/test>next` (`next` est un pair d'`inngest`), verification du lockfile, preuves (claude-code). Le detail est dans `docs/DECISIONS.md`.

## Preuves
`pnpm test` (75 fichiers, 981 verts, 1 ignore, 186 s), `pnpm run check` (types et lint), `pnpm audit --prod --audit-level=moderate` et `pnpm audit --audit-level=high` : sortie 0, seuls les 2 avis ecartes restent (« 2 ignored »). Avant : 2 critiques, 1 eleve, 8 moderes. Sorties completes dans `.logs/audit-transitifs-*.log` (local). CI de la PR.

## Incidents
Aucun bloquant. Le garde-fou `block-dangerous` a refuse un `grep -r` dans `node_modules` (il aurait pu lire des fichiers de secrets) ; relance avec `--include='*.js'`. Git Bash reecrit `gh api /advisories/...` en chemin de fichier ; relance sans la barre initiale.

## Etat a la fin
Audit modere de production propre, aucun avis eleve ou critique dans tout l'arbre ; deux avis moderes ecartes avec motif et signal de reexamen. PR ouverte.

## Etape suivante
Fusion par l'humain ; puis adoption de l'usine 1.6.7. `typescript-eslint` 8.74.0 arrivera par Dependabot et permettra de reexaminer l'exclusion de `minimatch`.
