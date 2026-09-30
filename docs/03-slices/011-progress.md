# 011 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : implementation en cours
- Branche : slice/011-montee-next16
- Dernier commit : beb2de1 `build(slice-011): reecritures tsconfig imposees par next 16`
- Etat des tests (`pnpm exec vitest run tests/stack-upgrade`, 15 tests) : 10 verts, 5 rouges attendus.
  - Rouges (implementation absente) : AC1 `next` 15.5.26 au lieu de 16.x.y ; AC1 `eslint-config-next` idem ; AC1 `@eslint/eslintrc` present dans `package.json` ; AC1 `eslint.config.mjs` contient `FlatCompat` ; AC6 pas de section `ignore` pour `@types/node` dans le bloc npm.
  - Verts : AC1 `eslint` 9.39.5, `minimumReleaseAgeExclude` absent, version installee = manifeste ; AC6 `.nvmrc` = 24, groupes et limites conserves ; AC2 (4 tests de non-regression, verts des maintenant, attendu).
- Prochaine etape : Dependabot, puis documentation, puis verification finale

## Couches
- [x] Versions (`next`, `eslint-config-next` 16.3.7, retrait de `@eslint/eslintrc`) et lockfile : 814ff9d
- [x] Configuration ESLint native (`eslint.config.mjs`) : 814ff9d (meme commit que les versions, voir Decisions)
- [x] Reecritures imposees par `next build` 16 (`apps/web/tsconfig.json`) : beb2de1 (`jsx: react-jsx`, `include` de `.next/dev/types/**/*.ts`, rien d'autre ; aucun `AGENTS.md` ni autre fichier suivi cree par le build)
- [ ] Dependabot (`.github/dependabot.yml`)
- [ ] Documentation (ADR-0013, statuts d'ADR-0008 et ADR-0009, backlog)
- [ ] Suite complete verte + `pnpm run check` + `pnpm run build`

## Blocages
<!-- cause, essais, options. Vide = aucun. -->

## Decisions
<!-- Toute decision prise sans l'humain, avec sa raison. Reprise dans la PR. -->
- Ouverture (orchestrateur) : cible `next@16.3.7` / `eslint-config-next@16.3.7` et non 16.3.8, publiee le jour meme (quarantaine pnpm 12, regle d'ADR-0012).
- Ouverture (orchestrateur) : essai prealable sur branche jetable (`tmp/essai-next16`, supprimee) pour fixer un perimetre juste avant le gel ; resultats dans le contrat, « Notes d'implementation ».
- Implementation : reference sous Next 15.5.26 (`pnpm run build`, variables factices de la CI) : `[Better Auth] Could not validate the database schema` (4 fois) et `Base URL is not set` (4 fois) apparaissent deja ; ils ne viennent pas de Next 16 (better-auth a l'import des routes pendant la collecte des pages, base injoignable, `BETTER_AUTH_URL` non fourni).
- Implementation : `next@16.3.7` et `eslint-config-next@16.3.7` (publies le 2026-09-29, plus d'un jour ; 16.3.8 publie le 2026-09-30, en quarantaine). `pnpm-workspace.yaml` inchange.
- Implementation : versions et configuration native dans un seul commit (814ff9d) : sans `@eslint/eslintrc`, l'ancienne configuration ne se charge plus (`ERR_MODULE_NOT_FOUND`), et `FlatCompat` n'a plus de raison d'etre avec les exports plats de la 16 ; le lint ne pouvait pas etre vert entre les deux couches.
- Implementation : les objets `{ ignores }` globaux des exports `core-web-vitals` et `typescript` de `eslint-config-next` 16 (`.next/**`, `out/**`, `build/**`, `next-env.d.ts`, relatifs a la racine) sont filtres : la liste d'ignores du depot reste seule et identique. Option ecartee : les garder (ajout silencieux de `out/**` et `build/**` a la racine) ou leur ajouter `files` (objet vide de sens).
- Implementation : ESLint 10 reporte, `eslint` reste en 9.39.5. Essai `eslint@10.11.0` (latest, publie le 2026-09-18) avec la configuration native : `pnpm lint` echoue sur `TypeError: Error while loading rule 'react/display-name': contextOrFilename.getFilename is not a function` (`eslint-plugin-react@7.37.5`, `lib/util/version.js:31`, sur `apps/web/next.config.ts`) ; `pnpm peers check` : `unmet peer eslint` pour `eslint-plugin-import@2.32.0`, `eslint-plugin-jsx-a11y@6.10.2`, `eslint-plugin-react@7.37.5` (bornes a ^9). `eslint-plugin-react@7.37.5` est sa derniere version (2025-04-03). Retour a 9.39.5 par `git restore package.json pnpm-lock.yaml` + `pnpm install` : lockfile identique a celui du commit 814ff9d, `--frozen-lockfile` et `pnpm peers check` propres. Option ecartee : forcer ESLint 10 (lint casse, pairs non satisfaits).
- Implementation : `pnpm build` sous 16.3.7 (Turbopack) : memes messages Better Auth qu'en 15.5.26 (3+1 `Base URL is not set`, 3+1 `Could not validate the database schema`), code de sortie 0. Le build ne lance plus le lint ni ne l'annonce ; la route `/404` (pages) devient `/_not-found` (app), generee par Next.
