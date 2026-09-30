# 01 — Cadrage : usine installee, PRD et architecture approuves

- **Dates** : 2026-09-22
- **Objectif** : installer l'usine logicielle sur le poste Windows et franchir les deux gates humains qui precedent tout code.

## Ce qui a ete fait
- Installation de Claude Code, de l'usine (`C:\dev\saas-factory`) et du projet `C:\dev\mon-saas` ; premiers ajustements Windows (droits d'execution des scripts, chemins des hooks, Git Bash).
- Phase 1 : PRD de Signet (partage de liens en equipe : organisations, roles owner/member, collections, quota Free de 50 liens, Stripe).
- Phase 2 : ERD, contrats d'API, ADR-0001 a ADR-0006, backlog de 9 tranches.

## Decisions
- D-001 : PRD approuve (humain). D-002 : architecture approuvee, socle gele (humain).
- D-003 a D-008 : isolation par RLS, quota atomique, jeton d'invitation hache, autorisation par role, Stripe, Inngest (ADR-0001 a 0006).

## Preuves
Commits fa76b01 (PRD) et b0e9cd7 (architecture) ; `.gates/01-prd.approved`, `.gates/02-architecture.approved`.

## Incidents
Voir FRICTION.md (22/09) : auto-approbation possible d'un gate par un agent (corrigee), perimetre de tranche impossible a ecrire (usine 1.2.0), reponses perdues par `/spec`.

## Etat a la fin
Code autorise, tranche 001 prete a s'ouvrir.
