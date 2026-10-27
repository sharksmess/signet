# Passage autonome du 2026-10-27 (/run-queue)

Budget fixe par l'humain : **1 tranche, la 009** (consultation des collections et des liens), selon `docs/04-runbooks/consigne-run-queue-009.md`, y compris D-129, D-130 et D-131 (decisions humaines). Arret apres `ship-slice.sh` ou a la premiere condition d'arret. Jamais de fusion.

## Prerequis
- `.gates/02-architecture.approved` present ; aucune tranche active.
- `main` a jour sur d2c1462 (PR #36, tranche 005, fusionnee). Arbre : seulement la consigne, non committee, incluse dans le commit d'ouverture.
- File : 009 (depend de 004 et 005, closes et fusionnees). 007 et 008 ont aussi leurs dependances closes : **hors file** (D-130). PR ouverte : #35 (Dependabot), sans lien avec 009.

## Tranche 009 — Consultation des collections et des liens
- Debut : 2026-10-27, 16:46. Branche `slice/009-consultation`.
- Sources relues : PRD US-07, US-09 ; contrats `listCollections` et `listLinks` ; ERD §6.1, §6.2 ; patron des routes et modules de 004 et 005 ; D-114, D-119.
- Verifications avant contrat : (1) les contrats de lecture ne listent pas de `422`, mais leur entree valide les identifiants comme `Uuid` : identifiant malforme -> `422` par le precedent D-114 point 2 (pas un trou de specification) ; (2) `z.string().url()` de Zod 4.6.7 accepte une URL contenant U+202E ou U+200B : D-131 point 4 compatible avec le schema de sortie de `listLinks` ; (3) l'ERD §6.1 dit que l'index des collections « sert aussi la liste triee par nom », contraire a D-131 point 1 (decision humaine, ordre alphabetique ecarte) : phrase alignee dans la tranche, inscrite au registre.
