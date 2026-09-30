# 07 — Decisions du point d'arret, journal de projet

- **Date** : 2026-09-30
- **Objectif** : trancher les six points du point d'arret et garder une trace de chaque etape dans GitHub.

## Ce qui a ete fait
- CI de la PR #12 verifiee (`gh pr checks 12` : ci pass, 1 min 38 s), puis fusion en squash : commit 95d60e6. Le message de squash reprend desormais la description de la PR (reglage `github-setup.ps1 -ProtectOnly`, usine 1.4.0) : preuves et decisions sont dans l'historique de `main`.
- Journal de projet cree : cet index et un recapitulatif par etape (01 a 07), reconstitues pour 01 a 06.
- Registre complete (D-031 a D-037) ; backlog : MINEUR-2 devient un critere d'acceptation de la tranche 002.

## Decisions (humain)
- D-031 : PR #12 fusionnee sur preuves.
- D-032 : ADR-0011 validee, avec ses trois points contestables.
- D-033 : audit-010 MINEUR-2 = critere d'acceptation obligatoire de la tranche 002.
- D-034 : reprise des tests par l'orchestrateur acceptee ; l'usine doit encadrer ce cas.
- D-035 : PR Dependabot regroupees dans une branche `chore/` avec un ADR.
- D-036 : depot de l'usine prive, confirme.
- D-037 : un recapitulatif versionne a chaque etape.

## Preuves
PR #12 : CI verte, fiche `docs/04-runbooks/evidence/010.md`. Cette PR : hook pre-push (check + 47 tests) puis CI.

## Etat a la fin
`main` contient les tranches 001 et 010 ; 92 tests. Ouverts : 9 PR Dependabot (D-035), MINEUR du backlog, dont MINEUR-11 avant tout hebergement.

## Etape suivante
Usine 1.4.1 (D-034, D-037 comme regle d'usine, `/run-queue` capable d'ouvrir et d'implementer une tranche, tests au premier plan), puis regroupement Dependabot (D-035), puis tranche 002.
