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
| `next` | `apps/web` | 15.5.26 (2026-09-22) | **16.3.7** | 2026-09-29T09:04Z | `latest` = 16.3.8, publiee le 2026-09-30T16:07Z : en quarantaine pnpm, non retenue |
| `eslint-config-next` | racine | 15.5.26 (2026-09-22) | **16.3.7** | 2026-09-29T08:55Z | meme version que `next` ; 16.3.8 (2026-09-30T15:59Z) en quarantaine |
| `@eslint/eslintrc` | racine | 3.3.7 (2026-09-01) | **retire** | — | ne servait qu'a `FlatCompat` ; reste present en dependance transitive d'`eslint@9` |
| `eslint` | racine | 9.39.5 (2026-07-10) | **9.39.5** (inchange) | 2026-07-10T20:41Z | 10.11.0 (`latest`, 2026-09-18) essayee et ecartee, voir ci-dessous |

Dependances transitives notables du lockfile : `@next/eslint-plugin-next` 15.5.26 -> 16.3.7 (2026-09-29), `eslint-plugin-react-hooks` 5.2.0 (2025-02-28) -> 7.1.1 (2026-04-17). Aucune autre ligne `"nom": "x.y.z"` ne change dans un `package.json`. `pnpm-workspace.yaml` est inchange (aucun `minimumReleaseAgeExclude`).

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

- **ESLint 10 reporte.** Le depot reste sur `eslint@9.39.5`, que le registre marque deprecie. Le risque est borne : ESLint est un outil de developpement (hors `pnpm audit --prod`), il n'est pas execute en production. Tant qu'`eslint-plugin-react` ne declare pas la prise en charge d'ESLint 10, **Dependabot proposera `eslint` 10 et ces PR sont a refuser** : elles casseraient `pnpm run check`.
- `@eslint/eslintrc` reste installe en dependance transitive d'`eslint@9` : le retrait porte sur la dependance directe et l'usage de `FlatCompat`, pas sur l'arbre.
- `eslint-plugin-react-hooks` passe de 5 a 7 (via `eslint-config-next`) : 16 regles `react-hooks/*` actives sur `apps/web`, dont les regles issues du React Compiler. Sans effet aujourd'hui (aucun composant) ; elles s'appliqueront aux premiers composants de la tranche 002.
- Les objets `ignores` globaux d'`eslint-config-next` sont filtres : si une version future y ajoute un motif utile, il faudra le reporter a la main dans la liste du depot.
- `next` et `eslint-config-next` doivent rester de meme version (test AC1 de la tranche 011) : un groupe Dependabot qui ne monterait que l'un des deux fera echouer la CI.
- 16.3.8 (publiee le jour de la tranche) sera proposee par Dependabot une fois la quarantaine ecoulee.

## Signal de reexamen

- Publication d'une version d'`eslint-plugin-react` (et d'`eslint-plugin-import`, `eslint-plugin-jsx-a11y`) qui accepte `eslint` 10 en pair, reprise par `eslint-config-next` : reessayer ESLint 10 (ligne au backlog).
- Fin de support d'ESLint 9 accompagnee d'un avis de securite sans correctif en 9.x.
- Fin de maintenance annoncee de la ligne Next 16, ou avis de securite sur 16.x sans correctif publie.
- Premiere page ou premier composant React (tranche 002) : relire les lignes « sans objet » du tableau ci-dessus qui dependent de l'absence d'UI (images, navigation, `scroll-behavior`, React Compiler).
