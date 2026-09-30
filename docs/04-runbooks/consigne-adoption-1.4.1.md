# Consigne — adopter l'usine 1.4.1 (branche `chore/usine-1.4.1`)

Redigee par l'orchestrateur (cowork) le 2026-09-30, decision D-038 de `docs/DECISIONS.md`. L'humain a cree la branche et lance `update-factory.ps1`. Lis `.claude/rules/git.md` et `.claude/rules/documentation.md`. Un commit par etape, Conventional Commits de 72 caracteres au plus, `git --no-pager`. Aucune tranche n'est active : tu ne touches ni `apps/`, ni `packages/`, ni `tests/`.

## Etape 1 — Installation
Committe les fichiers de l'usine que montre `git status --short` (`.claude/`, `scripts/`, `docs/templates/`, et ce qui a change) : `chore: installer l'usine 1.4.1`.

## Etape 2 — Dependabot groupe
Remplace le contenu de `.github/dependabot.yml` par celui du gabarit `C:\dev\saas-factory\templates\github\dependabot.yml`. Commit : `ci: grouper les mises a jour Dependabot`.

## Etape 3 — Documentation deja redigee
L'orchestrateur a ecrit : l'entree 08 du journal (`docs/00-context/journal/08-usine-1.4.1.md` et sa ligne d'index), D-038 dans `docs/DECISIONS.md`, et cette consigne. Relis-les ; signale tout fait faux sans le corriger. Commit : `docs: journal 08 et decision D-038`.

## Etape 4 — Preuve
`pnpm test` puis `pnpm run check`, **au premier plan**.

## Etape 5 — Livraison
`bash scripts/ship-branch.sh "chore: adopter l'usine 1.4.1"`, puis arrete-toi.

Rapport final, court : commits, ligne de resume des tests, check, lien de la PR, remarques de l'etape 3.
