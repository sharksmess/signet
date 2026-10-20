# Consigne — adopter l'usine 1.6.0 (branche `chore/usine-1.6.0`)

Redigee par l'orchestrateur (cowork) le 2026-10-19, decision D-082 de `docs/DECISIONS.md`. L'humain a cree la branche et lance `update-factory.ps1`. Lis `.claude/rules/git.md` et `.claude/rules/documentation.md`. Un commit par etape, Conventional Commits de 72 caracteres au plus, `git --no-pager`. Aucune tranche n'est active : tu ne touches ni `apps/` ni `packages/`. **Tout script au premier plan.**

## Etape 1 — Installation
`.claude/FACTORY_VERSION` doit contenir `1.6.1` ; sinon arrete-toi. Verifie d'abord que les garde-fous mordent : une tentative d'ecrire dans `.gates/` avec l'outil Write doit etre refusee par `gate-check` (n'insiste pas, constate seulement le refus). Committe les fichiers de l'usine que montre `git status --short` (attendus : `.claude/`, `scripts/` dont `ci-build.sh` et `env-check.ps1` nouveaux, `close-slice.sh` modifie, `gates.ps1`, `docs/templates/`, `ci/build.env` cree depuis le gabarit), sans les fichiers de l'etape 4 : `chore: installer l'usine 1.6.1`. Signale tout fichier inattendu.

## Etape 2 — Etape Build de la CI
1. Remplis `ci/build.env` avec les **trois** variables de l'etape Build actuelle de `.github/workflows/ci.yml` (`DATABASE_URL_APP`, `DATABASE_URL_AUTH`, `BETTER_AUTH_SECRET`), memes valeurs inventees, et rien d'autre.
2. Dans `.github/workflows/ci.yml`, l'etape Build devient `run: bash scripts/ci-build.sh`, sans bloc `env:` propre (le commentaire explique que l'environnement vient de `ci/build.env`).
3. Preuve : `bash scripts/ci-build.sh` au premier plan, code 0. S'il faut une variable de plus, dis laquelle et pourquoi avant de l'ajouter.
Commit : `ci: etape Build par scripts/ci-build.sh (usine 1.6)`.

## Etape 2b — Modele des variables de test
`scripts/env-check.ps1`, lance par l'humain, montre que `.env.test.example` ne decrit plus les variables reelles : il annonce `TEST_SERVER_ENV_DATABASE_URL` (remplacee par `TEST_SERVER_ENV_DATABASE_URL_APP` et `_AUTH`) et ne decrit pas `TEST_DATABASE_URL_APP`, `TEST_DATABASE_URL_BYPASSRLS`, `TEST_DATABASE_URL_TABLE_OWNER`, `TEST_SERVER_ENV_DATABASE_URL_APP`, `TEST_SERVER_ENV_DATABASE_URL_AUTH`. Mets le modele a jour d'apres ce que lisent reellement `tests/` et `tests/_factory/` (noms seulement ; valeurs factices, `MOT_DE_PASSE` pour les secrets ; `TEST_RLS_EXEMPT_TABLES` reste, vide, avec son commentaire). Ne lis jamais `.env.test.local`. Commit : `docs: modele des variables de test a jour`.

## Etape 3 — Menage
`git worktree list`. L'ancien worktree d'agent `.claude/worktrees/agent-a219314fe88bd941b` (septembre) : s'il est encore enregistre et sans travail non committe, `git worktree remove` (sinon arrete-toi et dis ce qu'il contient). Ajoute a `docs/04-runbooks/FRICTION.md` deux lignes du 2026-10-19 : garde-fous inoperants sur le poste faute d'outil JSON (alias Python du Store, ni jq ni Python ; corrige par jq et l'usine 1.6.1), et deux serveurs Next lances depuis ce worktree les 24 et 25/09 tournaient encore et consommaient de la memoire. Commit : `chore: retirer l'ancien worktree d'agent`.

## Etape 4 — Documentation deja redigee
L'orchestrateur a ecrit : l'entree 15 du journal (`docs/00-context/journal/15-usine-1.6.md` et sa ligne d'index, avec la ligne 14 passee a « PR #26 fusionnee »), D-082 et cette consigne. Relis-les ; signale tout fait faux sans le corriger. Commit : `docs: journal 15 et decision D-082`.

## Etape 5 — Preuve et livraison
`pnpm test` puis `pnpm run check`, au premier plan. Puis `bash scripts/ship-branch.sh "chore: adopter l'usine 1.6.1"` au premier plan, et arrete-toi avec le lien de la PR.
