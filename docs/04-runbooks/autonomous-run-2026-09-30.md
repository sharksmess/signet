# Passage autonome du 2026-09-30 (/run-queue)

Budget fixe par l'humain : **1 tranche, la 011** (ordre d'execution du backlog). Arret apres `ship-slice.sh`.

## Prerequis
- `.gates/02-architecture.approved` present.
- `main` a jour sur 192dd46 (PR #16 fusionnee). Arbre : seulement le cadrage de 011 (backlog) et D-041 (registre), non committes, a inclure dans le commit d'ouverture sur instruction de l'humain.
- File : 011 (depend de 010, close et fusionnee). Aucune autre tranche dans le budget.

## Tranche 011 — Montee Next 16 et configuration ESLint native
- Debut : 2026-09-30, ~16:30 UTC.
- Essai prealable jetable (avant gel du perimetre) : Next 16.3.7 vert (typecheck, build, 92/92) sans code applicatif ; ESLint 10.11.0 casse (`eslint-plugin-react@7.37.5`, `getFilename`) ; ESLint 9.39.5 vert.
- Ouverture : branche `slice/011-montee-next16`, contrat, perimetre, journal.
