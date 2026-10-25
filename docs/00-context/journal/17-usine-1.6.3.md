# 17 — Usine 1.6.3 : perimetres Next.js, variables facultatives, cles de test

- **Dates** : 2026-10-21
- **Objectif** : lever les trois frictions de la tranche 003 avant la tranche 006 (objectif A, D-083).

## Ce qui a ete fait
- Usine 1.6.3 (depot `saas-factory`, tag `v1.6.3`), 122 scenarios verts :
  - `gate-check` lit les crochets d'un motif de perimetre comme des caracteres : le dossier `[organizationId]` est reconnu ;
  - `env-check.ps1` traite une variable vide du modele comme facultative ;
  - `/implement` exige des valeurs de test inventees visiblement fausses (faible entropie), pour que gitleaks ne les prenne pas pour des secrets ;
  - `WINDOWS.md` : installation de gitleaks et de jq.
- Poste : gitleaks 8.30.1 installe le 20/10 (la cloture le lance desormais) ; jq installe le 19/10.

## Decisions
- D-097 : adoption de l'usine 1.6.3 (cowork, en application de D-083). Cote usine : D-028 a D-030.

## Preuves
Usine : `tests/run-tests.sh` 122/122 sur le poste (`update-factory.ps1`). Adoption : `pnpm test`, `pnpm run check`, CI de la PR.

## Incidents
Aucun.

## Etat a la fin
Usine 1.6.3 publiee, adoption en PR. Tranche 003 fusionnee (PR #29, commit 86198df).

## Etape suivante
Tranche 006 (acceptation d'une invitation).
