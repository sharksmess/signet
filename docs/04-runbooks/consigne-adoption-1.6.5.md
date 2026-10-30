# Consigne — adopter l'usine 1.6.5 (branche `chore/usine-1.6.5`)

Redigee par l'orchestrateur (cowork) le 2026-10-29. L'humain a cree la branche depuis `main` a jour (`ca47370`, PR #40) et lance `update-factory.ps1` (tests de l'usine : 142/142 sur le poste). Lis `.claude/rules/git.md` et `.claude/rules/documentation.md`. Un commit par etape, Conventional Commits de 72 caracteres au plus, `git --no-pager`. Aucune tranche n'est active : tu ne touches ni `apps/`, ni `packages/`, ni `tests/` (hors ce que le script d'installation a copie). **Tout script au premier plan.**

## Ce que l'humain a deja decide (a inscrire au registre)
- **D-156 (humain, 2026-10-29)** : l'usine 1.6.5 est publiee (depot `saas-factory`, commit `0ee232c`, tag `v1.6.5`) et adoptee **avant** le second projet de l'objectif A, pour que celui-ci demarre avec une usine non modifiee (D-083 point 6). Contenu, cote usine D-033 a D-036 : serveur de test sans `TEST`, `VITEST`, `VITEST_*` ni `TEST_*` (`buildServerEnv`) ; `globalSetup` qui refuse `.env`, `.env.local`, `.env.production*` dans le dossier de l'application ; section `## Complements` de la fiche de preuves conservee par la cloture ; marqueur `.gates/current-slice` tolere par `close-slice.sh` et `ship-branch.sh` ; marqueurs `TODO|FIXME|XXX` en mots entiers ; consignes `/slice` et `/implement` completees ; `rules/nextjs.md` (fichiers d'environnement). Reporte (usine D-036) : l'outil de preparation du poste de developpement. Repond aux candidats 1.6.5 du backlog (D-146 point 1, D-153) et aux frictions du 2026-10-28 et du 2026-10-29.
- **Index du journal** : la ligne 24 passe a « PR #40 fusionnee (commit ca47370) ».

## Etape 1 — Installation
`.claude/FACTORY_VERSION` doit contenir `1.6.5` ; sinon arrete-toi. Verifie que les garde-fous mordent : une tentative d'ecrire dans `.gates/` avec l'outil Write doit etre refusee (constate seulement le refus). Committe les fichiers de l'usine que montre `git status --short` (attendus : `.claude/`, `scripts/close-slice.sh`, `scripts/ship-branch.sh`, `tests/_factory/env.ts`, `tests/_factory/global-setup.ts`, `tests/_factory/preflight.ts`), sans cette consigne : `chore: installer l'usine 1.6.5`. Signale tout fichier inattendu.

## Etape 2 — Preuve : la suite complete avec un serveur de test plus strict
`pnpm test` puis `pnpm run check`, au premier plan. C'est le vrai test de l'adoption : le serveur de test ne recoit plus `TEST`, `VITEST` ni les variables `TEST_*`. Attendu : tout vert (971 passes, 1 ignore, comme a la cloture de 012).
- Si le `globalSetup` refuse de demarrer a cause d'un fichier d'environnement dans `apps/web/` : arrete-toi et donne le **nom** du fichier (jamais son contenu) ; c'est un geste humain.
- Si un test echoue parce qu'il comptait sur `TEST`, `VITEST` ou une variable `TEST_*` cote serveur (ou parce que better-auth applique desormais son controle d'origine) : **arrete-toi** avec le nom du test et le message ; ne modifie aucun test (`tests/` est ferme hors tranche).

## Etape 3 — Documentation
- Registre : D-156 (ci-dessus).
- Journal de projet : entree 25 `docs/00-context/journal/25-usine-1.6.5.md` (gabarit `docs/templates/JOURNAL-ENTREE.md`) et sa ligne d'index, plus la ligne 24 mise a jour. Contenu : ce qui a ete corrige (liste de D-156), preuves (usine 142/142 ; suite Signet de l'etape 2), ce qui reste.
- Backlog : les candidats 1.6.5 de D-146 point 1 et D-153 passent a « fait (usine 1.6.5) », sauf l'outil de preparation du poste (reporte, usine D-036). Le test « better-auth refuse une `Origin` etrangere (`403`) » et la correction du commentaire de `tests/helpers/auth.ts` (D-146 points 2 et 3) restent ouverts : ils touchent `tests/`, ferme hors tranche ; ecris qu'ils attendent une tranche technique, decision humaine.
- FRICTION : rien a ajouter sauf incident pendant cette adoption.
Commit : `docs: adoption de l'usine 1.6.5 (D-156, journal 25)`, avec cette consigne.

## Etape 4 — Livraison
`bash scripts/ship-branch.sh "chore: adopter l'usine 1.6.5"` au premier plan, et arrete-toi avec le lien de la PR. Rapport court et en clair : resultat de la suite, fichiers installes, tout ecart.
