# Passage autonome du 2026-10-26 (/run-queue)

Budget fixe par l'humain : **1 tranche, la 004** (creation d'une collection), selon `docs/04-runbooks/consigne-run-queue-004.md`, y compris D-113 (decision humaine). Arret apres `ship-slice.sh` ou a la premiere condition d'arret. Jamais de fusion.

## Prerequis
- `.gates/02-architecture.approved` present.
- `main` a jour sur aa7b2fb (PR #33, tranche 006, fusionnee). Arbre : seulement la consigne, non committee, incluse dans le commit d'ouverture.
- File : 004 (depend de 001, close). PR ouverte : #32 (Dependabot), sans lien avec 004.

## Tranche 004 — Creation d'une collection
- Debut : 2026-10-26.
- Sources relues : PRD US-05 et US-09, ERD §6.1, matrice d'isolation, contrat `collections.ts` (`createCollection`), patron de 003 (`withTenant`, appartenance explicite, `Result`). Aucune regle metier manquante ou contradictoire constatee ; lectures de forme inscrites en D-114 (a valider par l'humain).
- Ouverture : branche `slice/004-creation-collection`, contrat, perimetre (`.gates/scope-004.txt`), journal de tranche ; D-113 applique (`tests/stack-upgrade/lint-scope.test.ts`, quatre `it` a 60 s, assertions intactes) ; registre D-113, D-114 ; index du journal de projet (lignes 17 et 19) ; backlog (index d'auteur, D-114 point 5).
