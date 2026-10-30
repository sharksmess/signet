# 25 — Usine 1.6.5 : serveur de test plus strict, cloture et livraison assouplies

- **Dates** : 2026-10-29
- **Objectif** : lever les candidats 1.6.5 (D-146 point 1, D-153) et les frictions du 2026-10-28 et du 2026-10-29 avant le second projet de l'objectif A, pour qu'il demarre avec une usine non modifiee (D-083 point 6).

## Ce qui a ete fait
- Usine 1.6.5 (depot `saas-factory`, commit `0ee232c`, tag `v1.6.5`), installee par l'humain avec `update-factory.ps1` sur la branche `chore/usine-1.6.5`, creee depuis `main` a jour (`ca47370`, PR #40). Corrige :
  - le serveur de test ne recoit plus `TEST`, `VITEST`, `VITEST_*` ni `TEST_*` (`buildServerEnv`) : better-auth n'y saute plus son controle d'origine ;
  - le `globalSetup` refuse `.env`, `.env.local`, `.env.production*` dans le dossier de l'application (tests de demarrage hermetiques) ;
  - la cloture conserve la section `## Complements` de la fiche de preuves (resultat d'une visite guidee consigne avant la cloture) ;
  - `close-slice.sh` et `ship-branch.sh` tolerent le marqueur `.gates/current-slice` ;
  - les marqueurs `TODO|FIXME|XXX` sont cherches en mots entiers (plus de refus sur `[U+XXXX]`) ;
  - consignes `/slice` et `/implement` completees ; `rules/nextjs.md` (fichiers d'environnement).
- Reporte (usine D-036) : l'outil de preparation du poste de developpement.
- Installation verifiee : `.claude/FACTORY_VERSION` a `1.6.5`, ecriture dans `.gates/` refusee par le hook `gate-check`, aucun fichier inattendu ; commit `7b5e74c` (`chore: installer l'usine 1.6.5`).
- Backlog : candidats 1.6.5 passes a « fait (usine 1.6.5) », sauf l'outil de preparation du poste (reporte).

## Decisions
- D-156 : adoption de l'usine 1.6.5 avant le second projet (humain). Cote usine : D-033 a D-036. Le detail est dans `docs/DECISIONS.md`.

## Preuves
Usine : 142/142 scenarios sur le poste (`update-factory.ps1`). Signet, avec le serveur de test plus strict : `pnpm test` 74 fichiers, 971 verts, 1 ignore (408 s) ; `pnpm run check` vert. CI de la PR.

## Incidents
Premier passage de `pnpm test` en echec sans echec d'assertion : un processus Vitest n'a pas demarre a temps pour `tests/billing/review-corrections.test.ts` (15 tests non executes). Fichier rejoue seul 15/15, puis suite complete verte. FRICTION 2026-10-29.

## Etat a la fin
Usine 1.6.5 adoptee, PR ouverte. Aucun test n'a dependu de `TEST`, `VITEST` ni `TEST_*` cote serveur. Restent ouverts (D-146 points 2 et 3, `tests/` ferme hors tranche) : le test « better-auth refuse une `Origin` etrangere (`403`) » et la correction du commentaire de `tests/helpers/auth.ts` ; ils attendent une tranche technique, decision humaine.

## Etape suivante
Fusion de l'adoption par l'humain ; decision sur la tranche technique qui retablit le test d'origine ; puis second projet de l'objectif A.
