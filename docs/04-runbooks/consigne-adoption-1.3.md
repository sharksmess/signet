# Consigne — adopter l'usine 1.3 sur la tranche 001, puis la clore

Branche : `slice/001-creation-organisation` (deja rebasee sur `main`). Lis `.claude/rules/git.md` et applique-le : **un commit par etape ci-dessous**, Conventional Commits, et tiens `docs/03-slices/001-progress.md` (a creer depuis `docs/templates/PROGRESS.md`, en reconstituant l'etat depuis `git log`).

## Etape 1 — Roles idempotents
`packages/db/migrations/0001_roles_schema_context.sql` fait des `CREATE ROLE` nus. Les roles sont communs au cluster : sur une base de test neuve, la migration echoue. Cette migration n'est pas dans `main`, elle se corrige encore (le hook l'autorise). Rends chaque creation idempotente (`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '...') THEN CREATE ROLE ...; END IF; END $$;`), attributs inchanges.

## Etape 2 — Infrastructure de test de l'usine
- `vitest.config.ts` : `globalSetup: ["./tests/_factory/global-setup.ts"]`, `hookTimeout: 180000`, garde `fileParallelism: false`.
- Les helpers de `tests/helpers/` lisent l'environnement via `tests/_factory/env.ts` (`loadTestEnv`) et ne supposent plus un serveur lance a la main.
- Supprime toute assertion sur un total global (`countOrganizationsDirect` compte toute la table) : compte uniquement les lignes creees par le test.
- `packages/db/src/migrate.ts` doit fonctionner avec `DATABASE_URL_MIGRATE` fourni par le globalSetup (il pointe sur `signet_test`).
- Ne lis jamais `.env.test.local`, `.env.local` ni l'environnement : l'humain les a remplis, le processus les charge.

## Etape 3 — Lint reel et script check
ESLint (config Next + typescript-eslint), versions interrogees dans le registre (`rules/dependencies.md`), ADR-0009 pour ces dependances. Scripts racine : `"lint"` et `"check": "pnpm typecheck && pnpm lint"`. Corrige ce que le lint signale. Ajoute `"engines": { "node": ">=24" }`.

## Etape 4 — Preuve
Lance toi-meme `pnpm test` puis `pnpm run check`. Si le globalSetup echoue sur un pre-requis (Postgres, variable manquante, port occupe), arrete-toi et rapporte la phrase exacte. `tests/_factory/db-catalog.test.ts` peut reveler des tables sans RLS forcee ou des fonctions mal protegees : c'est un vrai constat, corrige-le par une nouvelle migration 0007.

## Etape 5 — Re-audit et cloture
Les etapes 1 a 3 touchent la base et la securite : relance `security-auditor` et `contract-guardian` sur le diff depuis le dernier rapport, ajoute leur nouveau passage **a la suite** des rapports existants (derniere ligne = verdict). Puis `bash scripts/close-slice.sh`.

## Etape 6 — Livraison
Si `git remote get-url origin` repond : `bash scripts/ship-slice.sh`, puis arrete-toi. Sinon arrete-toi et dis que la creation du depot GitHub est attendue.

Rapport final : commits, resultat des tests, verdicts, decisions prises, et ce qui attend l'humain.
