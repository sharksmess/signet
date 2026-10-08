# Consigne — adopter l'usine 1.5.0 (branche `chore/usine-1.5.0`)

Redigee par l'orchestrateur (cowork) le 2026-10-07, decision D-056 de `docs/DECISIONS.md`. L'humain a cree la branche et lance `update-factory.ps1`. Lis `.claude/rules/git.md` et `.claude/rules/documentation.md`. Un commit par etape, Conventional Commits de 72 caracteres au plus, `git --no-pager`. Aucune tranche n'est active : tu ne touches ni `apps/`, ni `packages/`, et dans `tests/` seulement ce que l'usine a installe dans `tests/_factory/`.

## Etape 1 — Installation
`.claude/FACTORY_VERSION` doit contenir `1.5.0` ; sinon, arrete-toi et dis-le. Committe les fichiers de l'usine que montre `git status --short` (attendus : `.claude/`, `scripts/` dont `close-slice.sh`, `tests/_factory/preflight.ts` nouveau, `tests/_factory/global-setup.ts` modifie, `docs/templates/` si change), **sans** les fichiers de l'etape 3 : `chore: installer l'usine 1.5.0`. Signale tout fichier inattendu sans le committer.

## Etape 2 — Preuve du controle prealable
`pnpm test` puis `pnpm run check`, **au premier plan**. Attendu : 13 fichiers, 107 tests, sans message du controle prealable (Smart App Control est desactive sur ce poste).

## Etape 3 — Documentation deja redigee
L'orchestrateur a ecrit : l'entree 13 du journal (`docs/00-context/journal/13-usine-1.5-wsl2.md` et sa ligne d'index, ainsi que la ligne 12 passee a « PR #22 fusionnee »), D-054 a D-056 dans `docs/DECISIONS.md`, quatre lignes du 2026-10-07 dans `docs/04-runbooks/FRICTION.md`, et cette consigne. Relis-les ; signale tout fait faux sans le corriger. Commit : `docs: journal 13, decisions D-054 a D-056`.

## Etape 4 — Livraison
`bash scripts/ship-branch.sh "chore: adopter l'usine 1.5.0"`, puis arrete-toi.

Rapport final, court : commits, ligne de resume des tests, check, lien de la PR, remarques de l'etape 3.
