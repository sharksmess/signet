# Consigne — adopter l'usine 1.4.0 (branche `chore/usine-1.4.0`)

Redigee par l'orchestrateur (cowork) le 2026-09-28, decision humaine D-023/D-026 de `docs/DECISIONS.md`. L'humain a deja cree la branche et lance `update-factory.ps1`. Lis `.claude/rules/git.md` et `.claude/rules/documentation.md`, puis applique ce qui suit : **un commit par etape**, Conventional Commits, `git --no-pager` pour toute commande qui pagine. Aucune tranche n'est active : tu ne touches ni `apps/`, ni `packages/`, ni `tests/` (le hook le refuse, c'est voulu).

## Etape 1 — Installation de l'usine
`git status --short` doit montrer les fichiers de l'usine : `.claude/` (settings, agents dont `code-reviewer`, regles dont `documentation.md`, skills), `scripts/` (dont `ship-branch.sh`), `.githooks/`, `.gitattributes`, `docs/templates/`, `tests/_factory/`, `gates.ps1`. Committe-les ensemble : `chore: installer l'usine 1.4.0`. Les fichiers `.claude/settings.json.bak-*` sont ignores par git, c'est normal.

## Etape 2 — Fins de ligne
`git add --renormalize .` puis `git status --short`. S'il y a des fichiers, committe : `chore: normaliser les fins de ligne (.gitattributes)`. Sinon, passe.

## Etape 3 — CI
Dans `.github/workflows/ci.yml` : `runs-on: ubuntu-24.04` (avec un commentaire : `ubuntu-latest` change sous nos pieds), `gitleaks/gitleaks-action@v3` (v2 tourne sur Node 20, obsolete), et au-dessus de `pnpm/action-setup` le commentaire « version de pnpm lue dans package.json (packageManager) ». Rien d'autre. Commit : `ci: figer ubuntu-24.04 et passer gitleaks-action en v3`.

## Etape 4 — CLAUDE.md
Aligne `CLAUDE.md` sur le gabarit 1.4 de l'usine (`C:\dev\saas-factory\templates\CLAUDE.md`), sans perdre ce qui est propre a Signet : regle absolue « tout est documente dans le depot » et etape 5 du workflow (trois relecteurs, registre, fiche de preuves, fusion humaine sur preuves). Commit : `docs: CLAUDE.md aligne sur l'usine 1.4.0`.

## Etape 5 — Documentation deja redigee
L'orchestrateur a ecrit : `docs/DECISIONS.md` (registre, D-001 a D-026), `docs/03-slices/000-backlog.md` (tranche 010, ordre d'execution, MINEUR-1 tranche), `docs/04-runbooks/FRICTION.md` (frictions du 2026-09-28), et cette consigne. Relis-les ; si un fait te semble faux au regard du depot, **signale-le sans le corriger**. Commit : `docs: registre des decisions, cadrage de la tranche 010, frictions du 2026-09-28`.

## Etape 6 — Preuve
Lance `pnpm test` puis `pnpm run check`. Nouveau dans la suite : `tests/_factory/db-catalog.test.ts` verifie qu'aucun role applicatif n'est `SUPERUSER` ou `BYPASSRLS`. S'il echoue, c'est un vrai constat, pas un bug de test : arrete-toi et rapporte-le (sa correction appartient a la tranche 010). Si `loadTestEnv` signale une variable en conflit avec `.env.test.local`, arrete-toi et rapporte le **nom** de la variable.

## Etape 7 — Livraison
`bash scripts/ship-branch.sh "chore: adopter l'usine 1.4.0 et ouvrir le registre des decisions"`, puis arrete-toi. La CI tourne ; la fusion appartient a l'humain.

Rapport final, court : commits, resultat de `pnpm test` (ligne de resume) et de `pnpm run check`, lien de la PR, ce que tu as signale a l'etape 5.
