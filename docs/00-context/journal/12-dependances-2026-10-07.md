# 12 — Mises a jour Dependabot #19, dont better-auth 1.7.7

- **Dates** : 2026-10-07
- **Objectif** : appliquer les mises a jour encore utiles de la PR Dependabot #19, en priorite `better-auth` 1.7.7 qui corrige des avis de securite.

## Ce qui a ete fait
- Inventaire de la #19 : 8 paquets, dont `next` et `eslint-config-next` 16.3.8 deja dans `main` (PR #21) ; versions et dates verifiees au registre.
- Avis de `better-auth` 1.7.7 identifies (GHSA-965c-763c-88jm critique, GHSA-r4xp-prcw-77qf, GHSA-44jh-23m7-hpcf) et exposition de Signet etablie : **aucune** (pas de greffon Magic Link ni OAuth Proxy, aucun `magicLink` dans `apps/web/src`, pas de fournisseur social, limiteur en memoire).
- `better-auth` 1.7.7, `@types/node` 24.19.1, `dotenv` 18.0.5, `pg` 8.23.1, `typescript-eslint` 8.71.0, `vitest` 5.0.3, epinglage exact, sans exception a la quarantaine pnpm (commit bfe1b02).
- ADR-0014, registre D-051 a D-053, cette entree ; consigne de l'orchestrateur versionnee (`docs/04-runbooks/consigne-dependabot-19.md`).

## Decisions
- D-051 : mises a jour de la #19, dont `better-auth` 1.7.7 (claude-code, en application de la consigne).
- D-052 : D-048 et D-050 validees (humain).
- D-053 : suite decidee, usine 1.5 (WSL2) apres cette PR (humain).

Le detail est dans `docs/DECISIONS.md`.

## Preuves
- `pnpm install --frozen-lockfile`, `pnpm run check`, `pnpm test` (13 fichiers, 107 tests), `pnpm audit --prod --audit-level=high` (aucune vulnerabilite connue), tous verts.
- Commits sur `chore/dependances-2026-10-07` ; CI de la PR.

## Incidents
Aucun.

## Etat a la fin
Branche `chore/dependances-2026-10-07` poussee, PR ouverte, CI en cours. `better-auth` 1.7.7, audit de production propre.

## Etape suivante
L'humain fusionne la PR sur preuves (Dependabot fermera la #19) ; puis usine 1.5 (WSL2).
