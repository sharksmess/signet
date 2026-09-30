# 09 — Mises a jour Dependabot regroupees

- **Dates** : 2026-09-30
- **Objectif** : realiser D-035 : regrouper les PR Dependabot ouvertes dans une seule branche `chore/`, avec un ADR.

## Ce qui a ete fait
- Branche `chore/dependances-2026-09-30`, consigne `docs/04-runbooks/consigne-dependances-2026-09-30.md` appliquee par Claude Code.
- Inventaire : #2 deja fermee (gitleaks deja en v3), #3 a #5 remplacees par la PR groupee #15 depuis l'usine 1.4.1 ; perimetre reel #6 a #10 et #15.
- Actions GitHub `checkout` v7, `pnpm/action-setup` v6, `setup-node` v7 (commit f68dcab).
- Paquets `pg`, `@types/pg`, `vitest`, `better-auth`, `react`, `react-dom`, `@types/react`, `@types/react-dom`, `dotenv` 18, par les commandes pnpm, epinglage exact (commit ec63408). `@types/node` d'abord passe en 26, puis aligne sur Node 24 (24.19.0) par decision humaine D-040.
- `eslint-config-next` 16 essaye puis annule (lint casse) ; `next` 16 non essaye (majeure du socle).
- ADR-0012 : tableau complet, applique ou reporte, avec les raisons.

## Decisions
- D-039 : tri et application des mises a jour (claude-code, en application de D-035). Le detail est dans `docs/DECISIONS.md` et ADR-0012.
- D-040 : `@types/node` suit le Node reellement utilise (24) : 24.19.0 au lieu de 26.6.3 (humain).

## Preuves
`pnpm install --frozen-lockfile`, `pnpm run check`, `pnpm test` (92/92), `pnpm run build` (avec les variables factices de la CI), `pnpm audit --prod --audit-level=high` : tous verts. CI de la PR.

## Incidents
- pnpm 12 ajoute de lui-meme des exclusions `minimumReleaseAgeExclude` quand on demande une version publiee le jour meme (`pg@8.23.1`, `vitest@5.0.3`). Exclusions refusees : versions precedentes retenues (ADR-0012).
- L'essai d'`eslint-config-next` 16 laissait des residus dans le lockfile (Babel, pair optionnel de `styled-jsx`) apres retour en 15 : lockfile regenere depuis celui de `main`.

## Etat a la fin
PR ouverte, en attente de CI et de fusion humaine. PR Dependabot #7 (`eslint-config-next` 16) et #9 (`next` 16) laissees ouvertes. #10 (`@types/node` 26) le restera aussi : a refuser tant que le runtime est en Node 24 (D-040). #6, #8 et #15 deviendront inutiles apres fusion ; Dependabot les fermera.

## Etape suivante
Decision humaine sur la migration Next 16 : la ligne 15 arrive en fin de maintenance en octobre 2026 (ADR-0008). Puis tranche 002 (avec MINEUR-2 en critere d'acceptation, D-033).
