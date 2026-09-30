# 011 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : auditee, 3 PASS (`security-auditor`, `contract-guardian`, `code-reviewer` : `docs/04-runbooks/audits/audit-011.md`, `contracts-011.md`, `review-011.md`) ; correctifs de documentation appliques (ADR-0013, contrat, backlog) ; en attente du registre des decisions et de `close-slice.sh` (orchestrateur)
- Branche : slice/011-montee-next16
- Dernier commit de code/doc : 34c36ac `docs(slice-011): ADR-0013, statuts d'ADR-0008 et ADR-0009`
- Verification finale (2026-09-30, au premier plan, une commande a la fois) :
  - `pnpm install --frozen-lockfile` : OK (« Lockfile is up to date »)
  - `pnpm run check` : OK (typecheck des trois projets, `eslint .`)
  - `pnpm test` : 13 fichiers, **107/107 verts** (92 existants inchanges + 15 `tests/stack-upgrade`)
  - `pnpm run build` (variables factices de `ci.yml`) : OK, `Next.js 16.3.7 (Turbopack)`, code 0 ; messages Better Auth identiques a la 15 (voir Decisions)
  - `pnpm audit --prod --audit-level=high` : « No known vulnerabilities found »
  - `pnpm peers check` : « No peer dependency issues found »
  - `git diff main --stat -- apps/web/src packages tests/organizations tests/isolation-hardening tests/_factory` : vide ; `pnpm-workspace.yaml` et `docs/02-architecture/api-contracts/` inchanges
- AC coches dans le contrat : AC1 a AC6. AC2 : partie locale prouvee (suite, check, build, portee du lint) ; « CI verte » a constater sur la PR. AC3 : tests de la tranche 001 verts et inchanges ; `contract-guardian` PASS (`contracts-011.md`) ; reserves annotees sur les lignes AC2 et AC3 du contrat.
- Fichiers crees par Next non committes : aucun (`AGENTS.md` n'est pas apparu ; `next-env.d.ts` et `.next/` deja ignores).
- Prochaine etape (orchestrateur) : lignes au registre `docs/DECISIONS.md`, journal de projet, commit du runbook, `bash scripts/close-slice.sh`. Hors tranche, sous 48 h : montee 16.3.8 (securite), voir backlog.

## Couches
- [x] Versions (`next`, `eslint-config-next` 16.3.7, retrait de `@eslint/eslintrc`) et lockfile : 814ff9d
- [x] Configuration ESLint native (`eslint.config.mjs`) : 814ff9d (meme commit que les versions, voir Decisions)
- [x] Reecritures imposees par `next build` 16 (`apps/web/tsconfig.json`) : beb2de1 (`jsx: react-jsx`, `include` de `.next/dev/types/**/*.ts`, rien d'autre ; aucun `AGENTS.md` ni autre fichier suivi cree par le build)
- [x] Dependabot (`.github/dependabot.yml`) : 610d736 ; `tests/stack-upgrade` 15/15 verts ; fichier relu par `js-yaml` (transitif, sans ajout) : `ignore` bien rattache au bloc npm
- [x] Documentation (ADR-0013, statuts d'ADR-0008 et ADR-0009, backlog) : 34c36ac
- [x] Suite complete verte + `pnpm run check` + `pnpm run build` (voir Etat)

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
- Implementation : ADR-0013 redige d'apres le guide officiel livre avec `next@16.3.7` (`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`, meme contenu que la page `nextjs.org/docs/app/guides/upgrading/version-16`), lu localement plutot que par le reseau : c'est la version exacte installee.
- Implementation : dans ADR-0013, dependances transitives notables citees (`@next/eslint-plugin-next` 16.3.7, `eslint-plugin-react-hooks` 5.2.0 -> 7.1.1) en plus des paquets directs, pour que les relecteurs sachent d'ou viennent les 16 regles `react-hooks/*`.
- Implementation : aucune ligne ajoutee a `docs/DECISIONS.md` par l'implementeur ; le registre revient a l'orchestrateur (etape « registre des decisions » du workflow). Decisions a y reporter : cible 16.3.7 (quarantaine), ESLint 10 reporte (erreur reproduite), filtrage des ignores globaux d'`eslint-config-next`, versions et configuration dans un seul commit.
- Suites des relectures : `next@16.3.8` est une version de securite (7 avis, audit-011 MINEUR 1). 16.3.7 est gardee dans la tranche : aucun avis applicable en production, un seul avis Low limite a `next dev`, et prendre 16.3.8 exigerait une exclusion de quarantaine (derogation a ADR-0012, ecartee). Montee 16.3.8 planifiee dans les 48 h (des la fin de quarantaine le 2026-10-01 vers 16:07Z, echeance 2026-10-02 vers 16:13Z) ; ADR-0013 et backlog.
- Suites des relectures : politique Dependabot pour `eslint` 10 (groupe `majeures`) et egalite `next` = `eslint-config-next` face aux PR de securite : non tranchees dans la tranche (hors perimetre du contrat), ecrites dans ADR-0013 et au backlog, remontees a l'humain. Suggestions de tests 3, 4, 5 de review-011 et le 405 de contracts-011 : au backlog ; aucun test ni code modifie apres les relectures.
