# 011 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : implementation en cours
- Branche : slice/011-montee-next16
- Dernier commit : 814ff9d `build(slice-011): monter next et eslint-config-next en 16`
- Etat des tests (`pnpm exec vitest run tests/stack-upgrade`, 15 tests) : 10 verts, 5 rouges attendus.
  - Rouges (implementation absente) : AC1 `next` 15.5.26 au lieu de 16.x.y ; AC1 `eslint-config-next` idem ; AC1 `@eslint/eslintrc` present dans `package.json` ; AC1 `eslint.config.mjs` contient `FlatCompat` ; AC6 pas de section `ignore` pour `@types/node` dans le bloc npm.
  - Verts : AC1 `eslint` 9.39.5, `minimumReleaseAgeExclude` absent, version installee = manifeste ; AC6 `.nvmrc` = 24, groupes et limites conserves ; AC2 (4 tests de non-regression, verts des maintenant, attendu).
- Prochaine etape : essai ESLint 10 (reproduire l'erreur ou garder 10), puis tsconfig, Dependabot, documentation

## Couches
- [x] Versions (`next`, `eslint-config-next` 16.3.7, retrait de `@eslint/eslintrc`) et lockfile : 814ff9d
- [x] Configuration ESLint native (`eslint.config.mjs`) : 814ff9d (meme commit que les versions, voir Decisions)
- [ ] Reecritures imposees par `next build` 16 (`apps/web/tsconfig.json`)
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
