# 02 — Tranche 001 : premiere implementation

- **Dates** : 2026-09-22 → 2026-09-25
- **Objectif** : creation d'organisation et compte owner (US-01), avec isolation tenant.

## Ce qui a ete fait
- Ouverture de la tranche (perimetre, tests) — commit 54e98b5.
- Schema, roles Postgres, politiques RLS, fonctions `SECURITY DEFINER`, routes `/api/organizations`, tests.
- Plusieurs interruptions de session ; reprise laborieuse faute de journal d'avancement.

## Decisions
- D-009 : refus humain du `BYPASSRLS` propose par l'implementeur ; roles sans passe-droit (ADR-0007).
- D-010 : refus humain de versions anciennes et vulnerables (Next 15.1.4, CVE-2025-29927) ; versions du registre + audit.
- D-011 : ligne Next 15, epinglage exact (ADR-0008).

## Incidents
Messages d'echec de test trompeurs ; suite dependante d'un serveur lance a la main (28 faux echecs) ; travail non committe perdu par des worktrees d'agent. Tous consignes dans FRICTION.md et traites par l'usine 1.3.

## Etat a la fin
Tranche implementee mais non livrable : pas de rituel git, pas de CI, suite de tests fragile.
