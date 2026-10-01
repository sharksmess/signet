# Passage autonome du 2026-09-30 (/run-queue)

Budget fixe par l'humain : **1 tranche, la 011** (ordre d'execution du backlog). Arret apres `ship-slice.sh`.

## Prerequis
- `.gates/02-architecture.approved` present.
- `main` a jour sur 192dd46 (PR #16 fusionnee). Arbre : seulement le cadrage de 011 (backlog) et D-041 (registre), non committes, a inclure dans le commit d'ouverture sur instruction de l'humain.
- File : 011 (depend de 010, close et fusionnee). Aucune autre tranche dans le budget.

## Tranche 011 — Montee Next 16 et configuration ESLint native
- Debut : 2026-09-30, ~16:30 UTC.
- Essai prealable jetable (avant gel du perimetre) : Next 16.3.7 vert (typecheck, build, 92/92) sans code applicatif ; ESLint 10.11.0 casse (`eslint-plugin-react@7.37.5`, `getFilename`) ; ESLint 9.39.5 vert.
- Ouverture : branche `slice/011-montee-next16`, contrat, perimetre, journal (commit 470546c, avec cadrage 011, D-041 et ligne 09 du journal de projet).
- `test-writer` lance (tests `tests/stack-upgrade/*` : AC1, AC2 portee du lint, AC6). Termine : 15 tests (AC1 x7, AC2 x4, AC6 x4), 5 echecs attendus, 10 verts (AC2 = non-regression) ; commits dbe16c6, 6d2a544. Tests relus par l'orchestrateur : conformes au contrat.
- `slice-implementer` lance (versions, ESLint natif, tsconfig, Dependabot, ADR-0013). Termine (~13 min) : commits 814ff9d a a2af79f ; `next`/`eslint-config-next` 16.3.7, ESLint 10 casse de nouveau (erreur reproduite), `eslint` garde en 9.39.5, `@eslint/eslintrc` retire ; check, 107/107, build, audit, peers : verts ; aucun fichier sous `apps/web/src`, `packages` ni test existant. Diff relu par l'orchestrateur : dans le perimetre.
- Relecteurs lances en parallele : `security-auditor`, `contract-guardian`, `code-reviewer` (resultats de tests transmis, pas de `pnpm test` de leur cote).
  - `contract-guardian` : CONTRACTS: PASS (`audits/contracts-011.md`) ; point non couvert : 405 sur methodes non exportees.
  - `code-reviewer` : REVIEW: PASS (`audits/review-011.md`) ; 2 A CORRIGER (PR Dependabot `majeures` bloquees par ESLint 10 ; egalite `next` = `eslint-config-next` face a une PR de securite isolee), 7 SUGGESTION.
  - `security-auditor` : AUDIT: PASS (`audits/audit-011.md`) ; 2 MINEUR : `next@16.3.8` (publiee pendant la tranche) corrige 7 avis, aucun applicable sauf un Low sur `next dev` (verifie par l'orchestrateur via `gh release view`) ; egalite `next` = `eslint-config-next` (meme point que la relecture).
- Suites des relectures (skill implement § 3) : correctifs de documentation renvoyes a `slice-implementer` (ADR-0013 : 16.3.8 securite et echeance 48 h, consequences Dependabot ; annotations AC2/AC3 ; lignes de backlog). Registre (D-042 a D-045) et journal de projet (entree 10) ecrits par l'orchestrateur.
