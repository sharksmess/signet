# ADR-0013 — Montee Next 16 (16.3.7) avec `eslint-config-next` 16 en configuration native ; ESLint reste en 9.x

- **Statut** : accepte (claude-code en mode autonome, en application de D-041 ; contestable par l'humain a la revue de la PR)
- **Date** : 2026-09-30
- **Phase** : 3 — tranche technique 011 (`docs/03-slices/011-montee-next16.md`)
- **Remplace** : la partie « ligne Next 15 » d'ADR-0008 ; la partie « ESLint / `eslint-config-next` / `FlatCompat` » d'ADR-0009

## Contexte

La ligne Next 15 arrive en fin de maintenance en **octobre 2026** (ADR-0008) : au-dela, un correctif de securite pourrait ne plus etre publie en 15.5.x. L'humain a decide de migrer maintenant, par une tranche technique executee avant la tranche 002, tant que le projet ne compte que trois Route Handlers (D-041, option A ; ecartees : apres 002, ou juste avant la mise en ligne).

Deux ADR portaient l'etat anterieur :
- ADR-0008 : `next` epingle en 15.5.26 (balise `backport`), migration vers 16 renvoyee a un ADR dedie ;
- ADR-0009 : ESLint 9.39.5 (ligne de maintenance), `eslint-config-next@15.5.26` charge par `FlatCompat` (`@eslint/eslintrc`), regles Next restreintes a `apps/web`. Son signal de reexamen : « montee de `next` en 16.x : reprendre `eslint-config-next` 16, reevaluer ESLint 10 et retirer `@eslint/eslintrc` ».

ADR-0012 a reporte les PR Dependabot #7 (`eslint-config-next` 16) et #9 (`next` 16) : la premiere cassait le lint (`FlatCompat` ne sait pas charger la configuration plate native de la 16), la seconde changeait une majeure du socle hors tranche. Ces deux PR deviennent sans objet.

Contraintes : aucun code applicatif touche (`apps/web/src/` hors perimetre), aucun contrat d'API modifie, quarantaine pnpm 12 respectee sans exclusion (regle d'ADR-0012), aucune dependance nouvelle.

## Options envisagees

### Option A — Next 16 + ESLint 10
Aligne tout l'outillage sur `latest`. Mais ESLint 10 n'est pas pris en charge par les greffons que charge `eslint-config-next` 16 (erreur reproduite ci-dessous) : le lint casse et `pnpm peers check` echoue.

### Option B — Next 16 + ESLint 9 (derniere 9.x)
Ligne Next maintenue, configuration ESLint native de la meme ligne, ESLint sur la derniere version compatible avec les greffons. Coute un report d'ESLint 10, sur incompatibilite constatee.

### Option C — Rester en Next 15
Aucun travail maintenant, mais contraire a D-041 et a la fin de maintenance de la ligne 15.

## Decision

**Option B.** `next` et `eslint-config-next` en **16.3.7**, `eslint` reste en **9.39.5**, `@eslint/eslintrc` retire, `eslint.config.mjs` reecrit sans `FlatCompat`. Critere : la seule configuration qui passe `pnpm run check`, `pnpm peers check`, la suite complete et le build. ESLint 10 est retrograde sur incompatibilite reproduite, conformement a `.claude/rules/dependencies.md` (« Retrograder »).

### Versions (registre interroge le 2026-09-30)

| Paquet | Manifeste | Avant | Apres | Publication (registre) | Remarque |
|---|---|---|---|---|---|
| `next` | `apps/web` | 15.5.26 (2026-09-22) | **16.3.7** | 2026-09-29T09:04Z | `latest` = 16.3.8, publiee sur npm le 2026-09-30T16:07Z : **version de securite** (7 avis, voir « 16.3.8 : correctif de securite »), en quarantaine pnpm, non retenue dans cette tranche |
| `eslint-config-next` | racine | 15.5.26 (2026-09-22) | **16.3.7** | 2026-09-29T08:55Z | meme version que `next` ; 16.3.8 (2026-09-30T15:59Z) en quarantaine, a monter avec `next` |
| `@eslint/eslintrc` | racine | 3.3.7 (2026-09-01) | **retire** | — | ne servait qu'a `FlatCompat` ; reste present en dependance transitive d'`eslint@9` |
| `eslint` | racine | 9.39.5 (2026-07-10) | **9.39.5** (inchange) | 2026-07-10T20:41Z | 10.11.0 (`latest`, 2026-09-18) essayee et ecartee, voir ci-dessous |

Dependances transitives notables du lockfile : `@next/eslint-plugin-next` 15.5.26 -> 16.3.7 (2026-09-29), `eslint-plugin-react-hooks` 5.2.0 (2025-02-28) -> 7.1.1 (2026-04-17). Aucune autre ligne `"nom": "x.y.z"` ne change dans un `package.json`. `pnpm-workspace.yaml` est inchange (aucun `minimumReleaseAgeExclude`).

`eslint-plugin-react-hooks` 7.1.1 (regles issues du React Compiler) tire une vingtaine de paquets transitifs : `@babel/*` 7.29.x, `browserslist`, `caniuse-lite`, `hermes-*` notamment. Cet arbre sert uniquement au developpement (lint), il est hors `pnpm audit --prod`, et aucun de ces paquets n'a de script d'installation (`preinstall`, `install`, `postinstall` : verifie par l'audit de securite, `docs/04-runbooks/audits/audit-011.md`).

### 16.3.8 : correctif de securite

`next@16.3.8` n'est pas une simple version en quarantaine : c'est une **version de securite**. Sa note de version (`gh release view v16.3.8 -R vercel/next.js`, publiee le 2026-09-30T16:13Z) corrige 7 avis qui touchent `next@16.3.7` (audit-011, MINEUR 1) :

| Avis | Gravite | Sujet | Condition d'exposition | Signet expose ? |
|---|---|---|---|---|
| GHSA-cjq9-62q9-8jv4 | High | SSRF dans l'optimisation d'images | `images.remotePatterns` configure | Non : `apps/web/next.config.ts` ne contient que `reactStrictMode` |
| GHSA-4jqv-mc3x-m676 | Medium | Empoisonnement du cache SSG/ISR | Pages Router | Non : aucune page |
| GHSA-mcj8-r9mp-w47p | Medium | Empoisonnement du cache SSG/ISR | Page catch-all a la racine avec SSG/ISR | Non : `api/auth/[...all]` est un gestionnaire de route, pas une page racine |
| GHSA-f87g-xv8r-7p7x | Medium | Divulgation via les routes d'image de metadonnees | Routes `opengraph-image` / `twitter-image` | Non : aucune |
| GHSA-3w37-wq28-93x7 | Medium | Fuite du contenu Draft Mode | `use cache` avec Draft Mode | Non : ni `use cache` ni `draftMode` |
| GHSA-h694-7cp9-m8p3 | Medium | Fuite de cache entre valeurs de root param | `cacheComponents: true` | Non |
| GHSA-39w2-rjm5-chcv | Low | Endpoint MCP du serveur `next dev` sans controle d'origine | `next dev` uniquement | **Oui, sur les postes de developpement seulement** |

- Les deux avis sur le cache SSG/ISR (GHSA-4jqv-mc3x-m676, GHSA-mcj8-r9mp-w47p) touchent aussi la ligne 15.5 de `main` : la tranche ne degrade rien sur ce point.
- GHSA-39w2-rjm5-chcv (Low) est **introduit par la ligne 16** (plage vulnerable `>= 16.0.0`) et concerne les postes de developpement : une page malveillante visitee pendant `pnpm dev` peut interroger l'endpoint MCP local et lire le chemin du projet, les routes, des extraits de source et les journaux de developpement. `next start` (production) n'est pas concerne.
- `pnpm audit` ne voit pas encore ces avis (« No known vulnerabilities found ») : ils ne sont publies que sur le depot `vercel/next.js`, pas encore dans la base mondiale des avis GitHub que lisent `pnpm audit` et les mises a jour de securite de Dependabot. Ni la CI ni Dependabot ne les signaleront avant que GitHub ne les ait relus.

**Pourquoi 16.3.7 reste la version de cette tranche.** Prendre 16.3.8 aujourd'hui imposerait une exclusion `minimumReleaseAgeExclude`, c'est-a-dire deroger au garde-fou de chaine d'approvisionnement d'ADR-0012 (une version compromise est generalement retiree dans les heures qui suivent sa publication). Aucun des six avis qui visent la production ne touche le code actuel, et le seul avis applicable est Low et limite au developpement : moins d'une journee d'exposition ne justifie pas la derogation. La montee est planifiee dans les 48 h, voir « Consequences acceptees ».

### Essai ESLint 10 (reproduit dans la tranche)

`pnpm add -w -E -D eslint@10.11.0` avec la configuration native, puis `pnpm lint` :

```
Oops! Something went wrong! :(

ESLint: 10.11.0

TypeError: Error while loading rule 'react/display-name': contextOrFilename.getFilename is not a function
Occurred while linting C:\dev\mon-saas\apps\web\next.config.ts
    at resolveBasedir (.../eslint-plugin-react@7.37.5/.../lib/util/version.js:31:100)
    at detectReactVersion (.../eslint-plugin-react@7.37.5/.../lib/util/version.js:85:19)
    at getReactVersionFromContext (.../eslint-plugin-react@7.37.5/.../lib/util/version.js:116:25)
```

`pnpm peers check` :

```
Issues with peer dependencies found

✕ unmet peer eslint
  Installed: 10.11.0
  Wanted:
    "^2 || ^3 || ^4 || ^5 || ^6 || ^7.2.0 || ^8 || ^9":
      eslint-plugin-import@2.32.0
    "^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9":
      eslint-plugin-jsx-a11y@6.10.2
    "^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9.7":
      eslint-plugin-react@7.37.5
```

`eslint-plugin-react@7.37.5` est sa derniere version publiee (`latest`, 2025-04-03) : il appelle `context.getFilename()`, API retiree d'ESLint 10. `eslint-config-next@16.3.7` le charge sans alternative. Retour a `eslint@9.39.5` : `git restore package.json pnpm-lock.yaml` puis `pnpm install`, le lockfile est identique a celui de la couche precedente, `pnpm install --frozen-lockfile` et `pnpm peers check` (« No peer dependency issues found ») propres.

Note : le registre marque `eslint@9.39.5` comme deprecie (« This version is no longer supported ») depuis la sortie d'ESLint 10. C'est une consequence acceptee, voir plus bas.

### Configuration ESLint native

`eslint.config.mjs` importe `eslint-config-next/core-web-vitals` et `eslint-config-next/typescript` (tableaux de configurations plates), restreints a `apps/web/**/*.{ts,tsx}` avec `settings.next.rootDir = "apps/web"`, comme sous ADR-0009. Inchanges : la liste d'ignores, `recommendedTypeChecked`, `projectService.allowDefaultProject`, `no-explicit-any` et `ban-ts-comment` en erreur partout (options conservees), `disableTypeChecked` pour `*.mjs`/`*.js`.

Les deux exports declarent chacun un objet `{ ignores: [".next/**", "out/**", "build/**", "next-env.d.ts"] }` **global**, relatif a la racine du depot. Ils sont filtres : les ignores du depot restent la seule liste, a l'identique. Ecartes : les garder (ajout silencieux d'ignores a la racine) ou leur ajouter `files` (un objet `files` + `ignores` sans autre cle ne configure rien).

Portee verifiee par `ESLint#calculateConfigForFile` (`tests/stack-upgrade/lint-scope.test.ts`) : `apps/web/src/lib/organizations.ts` recoit 22 regles `@next/next/*` et 16 regles `react-hooks/*` actives ; `packages/db/src/migrate.ts` aucune.

### Changements cassants du guide officiel

Source : guide « How to upgrade to version 16 » (`https://nextjs.org/docs/app/guides/upgrading/version-16`), lu dans la version livree avec le paquet (`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`, `next@16.3.7`). Signet ne contient que trois Route Handlers (`apps/web/src/app/api/**/route.ts`), aucune page, aucun layout, aucun composant React, aucun `middleware`, aucune image, aucun style.

| Changement | Traitement dans Signet |
|---|---|
| Node.js 20.9+ minimum, TypeScript 5.1+ minimum, navigateurs recents | Sans objet : Node 24 (`.nvmrc`), TypeScript 6.0.3 |
| Turbopack par defaut pour `dev` et `build` ; echec du build si une configuration `webpack` existe | Applique sans changement : aucune configuration `webpack`, aucun drapeau `--turbopack` dans les scripts ; `next build` affiche « Next.js 16.3.7 (Turbopack) » |
| `experimental.turbopack` devenu `turbopack` de premier niveau | Sans objet : `next.config.ts` ne contient que `reactStrictMode: true` |
| `resolveAlias` de repli, imports Sass `~` | Sans objet : aucun module natif importe cote client, aucun Sass |
| Cache disque de Turbopack active par defaut | Sans objet pour le code ; artefacts sous `.next/`, deja ignore par git |
| API de requete asynchrones (synchronisme retire : `cookies`, `headers`, `draftMode`, `params`, `searchParams`) | Deja conforme : aucun import de `next/headers` ; le seul `params` (`api/organizations/[organizationId]/route.ts`) est deja type `Promise<...>` et attendu par `await` |
| `params` et `id` asynchrones pour `opengraph-image`, `twitter-image`, `icon`, `apple-icon` | Sans objet : aucun fichier de metadonnees image |
| `id` asynchrone pour `sitemap` | Sans objet : pas de `sitemap` |
| React 19.2 (App Router sur React canary) | Sans objet pour le code : React reste en 19.3.0, pair `^19.0.0` de `next@16.3.7` satisfait (`pnpm peers check` propre) ; aucun composant |
| React Compiler stable (`reactCompiler`, non active par defaut) | Non active (hors perimetre de la tranche) ; `babel-plugin-react-compiler` non installe |
| `revalidateTag` exige un second argument ; `updateTag`, `refresh` ; `cacheLife`/`cacheTag` sans `unstable_` | Sans objet : aucune API de cache utilisee |
| Refonte du routage et de la navigation cote client | Sans objet : aucune navigation client |
| PPR experimental retire (`experimental.ppr`, `experimental_ppr`), remplace par `cacheComponents` | Sans objet : jamais active ; `cacheComponents` non active (hors perimetre) |
| `middleware` renomme `proxy` | Sans objet : aucun `middleware` dans le projet |
| `next/image` : images locales avec query string, `minimumCacheTTL`, `imageSizes`, `qualities`, restriction des IP locales, `maximumRedirects`, `next/legacy/image` et `images.domains` deprecies | Sans objet : aucune image, aucune configuration `images` |
| `dev` et `build` dans des repertoires distincts (`.next/dev`), verrou contre les instances concurrentes | Applique : `next build` 16 ajoute `.next/dev/types/**/*.ts` a `include` d'`apps/web/tsconfig.json` (et `jsx: react-jsx`) ; ces deux reecritures imposees sont committees, rien d'autre. `.next/` est ignore par git |
| Routes paralleles : `default.js` obligatoire | Sans objet : aucune route parallele |
| ESLint : `@next/eslint-plugin-next` en configuration plate par defaut | Applique : `eslint.config.mjs` natif, `FlatCompat` et `@eslint/eslintrc` retires |
| `scroll-behavior` plus surcharge pendant la navigation | Sans objet : aucun CSS, aucune page |
| Sortie de `next build` sans `size` ni `First Load JS` | Constate, sans effet (aucune preuve du projet ne s'appuyait sur ces colonnes) |
| `next dev` ne charge plus la configuration deux fois (`process.argv` sans `dev`) | Sans objet : `next.config.ts` ne lit pas `process.argv` |
| Build Adapters API (alpha) | Sans objet, non utilise |
| Sass moderne (`sass-loader` 16) | Sans objet : aucun Sass |
| Retrait d'AMP | Sans objet : jamais utilise |
| Retrait de `next lint` ; `next build` ne lance plus le lint ; option `eslint` de `next.config` retiree | Sans effet : le lint passe par `pnpm run check` (`eslint .`), deja en CI ; `next.config.ts` n'a pas d'option `eslint`. L'avertissement « The Next.js plugin was not detected in your ESLint configuration » du build 15 disparait avec lui |
| Retrait de `serverRuntimeConfig` / `publicRuntimeConfig` | Sans objet : jamais utilises ; la configuration serveur est lue dans `process.env` au chargement (`apps/web/src/lib/db.ts`, `auth.ts`) |
| Options `devIndicators` retirees (`appIsrStatus`, `buildActivity`, `buildActivityPosition`) | Sans objet : non configurees |
| `experimental.dynamicIO` et `experimental.useCache` retires | Sans objet : jamais actives |
| `unstable_rootParams` retire | Sans objet : non utilise |
| Guide : generation d'`AGENTS.md` par `next dev` | Non adopte (contrat de la tranche : la documentation d'agent vit dans `CLAUDE.md` et `.claude/`). Le fichier n'est pas apparu pendant la tranche (`next build` et les tests, qui lancent le serveur, ne l'ont pas cree) ; s'il apparait, il n'est pas committe |

### Compatibilite verifiee

- **better-auth 1.7.6** : pair `next` = `^14.0.0 || ^15.0.0 || ^16.0.0` ; `toNextJsHandler` (`apps/web/src/app/api/auth/[...all]/route.ts`) inchange ; tests d'authentification et limiteur de debit (ADR-0010, `tests/organizations/auth-rate-limit.test.ts`) verts, sans modification.
- **React 19.3.0** : pair `^18.2.0 || 19.0.0-rc-de68d2f4-20241204 || ^19.0.0` de `next@16.3.7` satisfait, `pnpm peers check` propre.
- **drizzle** (`packages/db`) : non concerne par le build web ; typecheck et tests d'isolation (`tests/isolation-hardening/**`, `tests/_factory/db-catalog.test.ts`) verts, sans modification.
- Suite complete : 13 fichiers, 107 tests verts (92 existants inchanges + 15 de `tests/stack-upgrade`).

### Messages Better Auth pendant `next build`

Avec les variables factices de `ci.yml`, `next build` affiche, sous 15.5.26 comme sous 16.3.7 (constate avant et apres le changement de version) :
- `WARN [Better Auth]: Base URL is not set ...` ;
- `ERROR [Better Auth]: Could not validate the database schema. Check your database connection.`

Origine : `apps/web/src/lib/auth.ts` est evalue a l'import des Route Handlers pendant la collecte des pages ; better-auth tente alors de valider le schema sur une base injoignable et note l'absence de `BETTER_AUTH_URL`, que la CI ne fournit pas. Le code de sortie reste 0. Ce bruit est anterieur a la tranche et sans lien avec Next 16 ; il n'est pas traite ici (hors perimetre : `apps/web/src/`).

## Consequences acceptees

- **Montee en `next` + `eslint-config-next` 16.3.8 dans les 48 h** (regle « correctif de securite » de `.claude/rules/dependencies.md`) : echeance **2026-10-02 vers 16:13Z** (48 h apres la note de version), a faire des la fin de la quarantaine pnpm (**2026-10-01 vers 16:07Z**), sans exclusion, sans attendre le passage hebdomadaire de Dependabot (lundi 2026-10-05). D'ici la, ne pas naviguer sur des sites non fiables pendant `pnpm dev` (GHSA-39w2-rjm5-chcv).
- **ESLint 10 reporte.** Le depot reste sur `eslint@9.39.5`, que le registre marque deprecie. Le risque est borne : ESLint est un outil de developpement (hors `pnpm audit --prod`), il n'est pas execute en production. Effet reel sur Dependabot : tant qu'`eslint-plugin-react` ne declare pas la prise en charge d'ESLint 10, le groupe `majeures` (`.github/dependabot.yml`) contiendra `eslint` 10 **chaque semaine**. Refuser cette PR groupee fait perdre aussi les autres majeures du groupe ; l'accepter casse `pnpm run check`. Deux options sont remontees a l'humain, hors perimetre du contrat de la tranche 011 (qui limitait le changement Dependabot a `@types/node`) : un `ignore` `semver-major` pour `eslint`, sur le modele de `@types/node` (D-040), lie au signal de reexamen ci-dessous ; ou un refus manuel accepte et ecrit au registre (review-011, A CORRIGER 1).
- `@eslint/eslintrc` reste installe en dependance transitive d'`eslint@9` : le retrait porte sur la dependance directe et l'usage de `FlatCompat`, pas sur l'arbre.
- `eslint-plugin-react-hooks` passe de 5 a 7 (via `eslint-config-next`) : 16 regles `react-hooks/*` actives sur `apps/web`, dont les regles issues du React Compiler. Sans effet aujourd'hui (aucun composant) ; elles s'appliqueront aux premiers composants de la tranche 002.
- Les objets `ignores` globaux d'`eslint-config-next` sont filtres : si une version future y ajoute un motif utile, il faudra le reporter a la main dans la liste du depot.
- `next` et `eslint-config-next` doivent rester de meme version (test AC1 de la tranche 011). Les PR groupees de Dependabot (`mineures-et-correctifs`, `majeures`) montent les deux ensemble. En revanche, **une PR de securite Dependabot ne monte que le paquet vise par l'avis** (`next`) : sa CI echouera sur AC1. Procedure : aligner `eslint-config-next` a la main sur la meme version, dans la meme PR, sans attendre (le correctif de securite prime, 48 h). Le choix d'une autre politique (groupe Dependabot dedie `next` + `eslint-config-next` couvrant les mises a jour de securite, ou test relache a la meme ligne majeure.mineure) est remonte a l'humain (audit-011 MINEUR 2, review-011 A CORRIGER 2).

## Signal de reexamen

- Publication d'une version d'`eslint-plugin-react` (et d'`eslint-plugin-import`, `eslint-plugin-jsx-a11y`) qui accepte `eslint` 10 en pair, reprise par `eslint-config-next` : reessayer ESLint 10 (ligne au backlog).
- Fin de support d'ESLint 9 accompagnee d'un avis de securite sans correctif en 9.x.
- Fin de maintenance annoncee de la ligne Next 16, ou avis de securite sur 16.x sans correctif publie.
- Premiere page ou premier composant React (tranche 002) : relire les lignes « sans objet » du tableau ci-dessus qui dependent de l'absence d'UI (images, navigation, `scroll-behavior`, React Compiler).

## 2026-10-02 — Passage a 16.3.8

- **Decision** : D-047 (claude-code, en application de D-042), branche `fix/next-16.3.8`, consigne `docs/04-runbooks/consigne-next-16.3.8.md`.
- **Versions** : `next` (`apps/web`) et `eslint-config-next` (racine) passent de 16.3.7 a **16.3.8**, epinglage exact, par `pnpm add -E`. Publication au registre : `next@16.3.8` le 2026-09-30T16:07Z, `eslint-config-next@16.3.8` le 2026-09-30T15:59Z, soit plus de 24 h avant la montee : quarantaine pnpm respectee, aucune exclusion `minimumReleaseAgeExclude`. Les deux paquets restent de meme version (test AC1 de la tranche 011).
- **Avis corriges** : les 7 avis du tableau « 16.3.8 : correctif de securite » ci-dessus, liste reverifiee le 2026-10-07 dans la note de version `v16.3.8` (publiee le 2026-09-30T16:13Z) : GHSA-cjq9-62q9-8jv4, GHSA-4jqv-mc3x-m676, GHSA-mcj8-r9mp-w47p, GHSA-f87g-xv8r-7p7x, GHSA-3w37-wq28-93x7, GHSA-h694-7cp9-m8p3, GHSA-39w2-rjm5-chcv.
- **Celui qui concernait le projet** : **GHSA-39w2-rjm5-chcv** (Low), endpoint MCP de `next dev` sans controle d'origine, sur les postes de developpement uniquement. Les six autres exigent une configuration ou des fonctions absentes de Signet (voir la colonne « Signet expose ? »). La precaution « ne pas naviguer sur des sites non fiables pendant `pnpm dev` » est levee avec cette montee.
- **Echeance** : la montee a ete committee le 2026-10-02, dans les 48 h, mais la preuve locale a ete bloquee par Smart App Control, qui refusait le binaire natif non signe `@next/swc-win32-x64-msvc` (16.3.8 comme 16.3.7) : aucune construction locale possible. L'humain l'a desactive le 2026-10-07 (D-049) ; la PR part donc apres l'echeance du 2026-10-02 vers 16:13Z (`docs/04-runbooks/FRICTION.md`).
- **Audit a la preuve (2026-10-07)** : `pnpm audit --prod --audit-level=high` remontait deux avis transitifs publies apres la tranche 011, tous deux tires par `next` : GHSA-wq5f-xc86-pv6w (`sharp` < 0.35.5, CVE-2026-96889 dans librsvg) et GHSA-68fv-2mgg-jv7q (`source-map-js` < 1.2.2, via `postcss`). Corriges par `overrides` dans `pnpm-workspace.yaml` (`sharp` >= 0.35.5, publie le 2026-09-27 ; `source-map-js` >= 1.2.2, publie le 2026-09-30), comme le prevoit `.claude/rules/dependencies.md` (D-050). Les deux versions restent dans les plages declarees par `next@16.3.8` (`sharp ^0.35.4`). A retirer quand `next` exigera lui-meme ces versions.
- **Dependabot** : les majeures d'`eslint` (D-043) et de `typescript` (commit 948df22) sont ignorees dans `.github/dependabot.yml` (D-048) ; signal de reexamen de chaque regle en commentaire, en plus de celui de cet ADR.
- **Preuve** : `pnpm install --frozen-lockfile`, `pnpm run check`, `pnpm test` (13 fichiers, 107 tests), `pnpm audit --prod --audit-level=high` (aucune vulnerabilite connue) : tous verts le 2026-10-07.
- **Hors perimetre** : `next@16.4.0` (`latest` depuis le 2026-10-06T18:35Z) n'est pas un correctif de securite ; il arrivera par la PR Dependabot hebdomadaire.
