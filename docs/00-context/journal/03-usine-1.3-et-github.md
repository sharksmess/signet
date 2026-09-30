# 03 — Usine 1.3 : rituel git, tests autonomes, GitHub

- **Dates** : 2026-09-27 → 2026-09-28
- **Objectif** : chaque lot de code part sur GitHub selon un rituel sur ; les agents travaillent via le pont desktop sans jamais voir un secret.

## Ce qui a ete fait
- Usine 1.3.0 : une branche par tranche, Conventional Commits, hooks git (pre-commit, commit-msg, pre-push), `close-slice.sh`, `ship-slice.sh`, CI GitHub Actions, infrastructure de test autonome (base de test recreee, serveur demarre par les tests), invariants du catalogue Postgres. 65 scenarios de test de l'usine.
- Depot `sharksmess/signet` cree, `main` protegee cote serveur (PR, CI verte, historique lineaire, squash).
- Adoption dans Signet par Claude Code (consigne 1.3) : roles idempotents, lint reel (ADR-0009), migrations 0007 et 0008, limiteur de debit (ADR-0010).

## Decisions
- D-012 : depot public (humain). D-013 : rituel git et fusion humaine (humain).
- D-014 : ESLint 9 (ADR-0009). D-015 : limiteur coupe seulement en test (humain, ADR-0010). D-016, D-017 : decisions de tranche (journal 001).

## Incidents
Protection de `main` refusee a cause d'un BOM PowerShell (corrige) ; classifieur du mode automatique indisponible ; pager `less` ; migration 0006 sans effet (corrigee par 0008).

## Etat a la fin
Tranche 001 re-auditee (AUDIT: PASS, CONTRACTS: PASS) et prete a etre livree.
