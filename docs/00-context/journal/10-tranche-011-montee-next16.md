# 10 — Tranche 011 : montee Next 16 en autonomie

- **Dates** : 2026-09-30
- **Objectif** : realiser D-041 : passer le socle web sur la ligne Next maintenue avant la tranche 002, la ligne 15 arrivant en fin de maintenance en octobre 2026 (ADR-0008).

## Ce qui a ete fait
- `/run-queue`, budget 1 tranche (011). Essai prealable sur une branche jetable pour geler un perimetre juste, puis ouverture (470546c, avec le cadrage de 011 et D-041).
- `test-writer` : 15 tests `tests/stack-upgrade/*` (versions, portee du lint, Dependabot).
- `slice-implementer` : `next` et `eslint-config-next` 15.5.26 -> 16.3.7 ; `eslint.config.mjs` au format plat natif, `@eslint/eslintrc` retire ; `apps/web/tsconfig.json` reecrit par `next build` ; Dependabot ignore les majeures de `@types/node` (D-040) ; ADR-0013. Aucun fichier sous `apps/web/src`, `packages` ni test existant modifie.
- ESLint 10 essaye deux fois, casse (`eslint-plugin-react@7.37.5`) : `eslint` reste en 9.39.5.
- Trois relecteurs en parallele, suites de relecture reportees dans ADR-0013 et au backlog.

## Decisions
- D-042 : 16.3.7 et non 16.3.8 (quarantaine) ; 16.3.8 est un correctif de securite a monter dans les 48 h (orchestrateur, echeance a valider).
- D-043 : ESLint 10 reporte, erreur reproduite (slice-implementer).
- D-044 : configuration ESLint native, filtrage des ignores globaux d'`eslint-config-next` (slice-implementer).
- D-045 : essai prealable avant gel du perimetre (orchestrateur).
Le detail est dans `docs/DECISIONS.md`, ADR-0013 et `docs/03-slices/011-progress.md`.

## Preuves
Fiche `docs/04-runbooks/evidence/011.md` (produite par `close-slice.sh`). `pnpm run check`, `pnpm test` 107/107 (dont les suites 001 et 010 inchangees), `pnpm run build` (Next 16.3.7, Turbopack), `pnpm audit --prod` propre, `pnpm peers check` propre. AUDIT: PASS, CONTRACTS: PASS, REVIEW: PASS (`docs/04-runbooks/audits/*-011.md`).

## Incidents
- `next@16.3.8`, publiee pendant la tranche, corrige 7 avis de securite que `pnpm audit` ne voit pas encore (publies sur le depot de Next seulement). Aucun ne s'applique au code actuel, sauf un avis Low sur `next dev` (postes de developpement).
- Aucun sous-agent bloque ; aucune reprise par l'orchestrateur.

## Etat a la fin
PR de la tranche 011 ouverte, en attente de CI et de fusion humaine. PR Dependabot #7 et #9 sans objet apres fusion.

## Etape suivante
Decisions humaines : fusion ; montee 16.3.8 (securite, 48 h) ; politique Dependabot pour ESLint 10 et pour l'egalite `next` = `eslint-config-next`. Puis tranche 002 (MINEUR-2 en critere d'acceptation, D-033).
