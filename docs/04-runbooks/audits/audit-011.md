# Audit de sécurité : tranche 011, montée vers Next 16 et ESLint en configuration plate native

Branche `slice/011-montee-next16`, diff `git diff main...HEAD` (main = 192dd46, HEAD = a2af79f). Je n'ai relancé ni `pnpm test` ni aucune commande qui touche à la base, et je n'ai modifié aucun fichier.

**Verdict : aucun constat CRITIQUE ni MAJEUR.** La tranche ne change aucun code applicatif, et aucun avis de sécurité connu sur `next@16.3.7` ne concerne ce que l'application utilise. Il reste deux constats MINEUR, qui portent tous deux sur la façon de récupérer le correctif `next@16.3.8`.

## Périmètre vérifié
- `git diff --stat main...HEAD` : 20 fichiers. Aucun fichier modifié sous `apps/web/src/`, sous `packages/` ni parmi les tests existants. Les tests ajoutés sont sous `tests/stack-upgrade/*`.
- Les critères 1 (isolation tenant), 2 (autorisation), 3 (validation des entrées), 4 (injection), 6 (webhooks) et 7 (fonctions `SECURITY DEFINER`) ne s'appliquent pas : aucune requête, route, fonction SQL ni migration n'est touchée.

## Constats

### MINEUR 1 : `next@16.3.7` est touché par 7 avis publiés aujourd'hui, et aucun ne s'applique au code actuel de Signet

**Emplacement :** `apps/web/package.json:13` (`"next": "16.3.7"`) et `docs/02-architecture/ADR/0013-montee-next16-eslint.md:39` et `:149`.

**Preuve :** `gh release view v16.3.8 -R vercel/next.js` (version publiée le 2026-09-30 à 16:13Z) indique que 16.3.8 corrige 7 avis :

| Avis | Gravité | Sujet | Condition d'exposition | Signet est-il exposé ? |
|---|---|---|---|---|
| GHSA-cjq9-62q9-8jv4 | High | SSRF dans l'optimisation d'images | `images.remotePatterns` configuré | Non : `apps/web/next.config.ts` ne contient que `reactStrictMode` |
| GHSA-4jqv-mc3x-m676 | Medium | Empoisonnement du cache SSG/ISR | Pages Router | Non : aucune page |
| GHSA-mcj8-r9mp-w47p | Medium | Empoisonnement du cache SSG/ISR | Page catch-all à la racine avec SSG/ISR | Non : `api/auth/[...all]` est un gestionnaire de route, pas une page racine |
| GHSA-f87g-xv8r-7p7x | Medium | Divulgation via les routes d'image de métadonnées | Routes `opengraph-image` / `twitter-image` | Non : aucune |
| GHSA-3w37-wq28-93x7 | Medium | Fuite du contenu Draft Mode | `use cache` avec Draft Mode | Non : `git grep` ne trouve ni `use cache` ni `draftMode` |
| GHSA-h694-7cp9-m8p3 | Medium | Fuite de cache entre valeurs de root param | `cacheComponents: true` | Non |
| GHSA-39w2-rjm5-chcv | Low | Endpoint MCP du serveur `next dev` qui ne vérifie pas l'origine | `next dev` uniquement | **Oui, en local seulement** |

- Le dernier avis n'existait pas en Next 15 (plage vulnérable `>= 16.0.0`). La tranche introduit donc cette exposition sur les postes de développement.
- Deux des avis (cache SSG/ISR) touchent aussi la ligne 15.5 sur laquelle est `main`. La tranche ne dégrade donc rien sur ce point.
- `pnpm audit` répond « No known vulnerabilities found ». Ce n'est pas une contradiction : ces avis ne sont publiés que sur le dépôt `vercel/next.js`. `gh api advisories/GHSA-cjq9-62q9-8jv4` renvoie 404 dans la base mondiale, que lisent `pnpm audit` et les mises à jour de sécurité de Dependabot. Ni l'audit ni la CI ne verront donc ces avis tant que GitHub ne les aura pas relus.

**Scénario d'exploitation (avis Low, seul applicable) :**
1. Un développeur lance `pnpm dev` (Next 16.3.7).
2. Il visite une page malveillante dans le même navigateur.
3. Cette page interroge l'endpoint MCP local, qui ne contrôle pas l'origine.
4. Elle récupère le chemin du projet sur le disque, la liste des routes, des extraits de source tirés des rapports d'erreur et les journaux de développement.
- La production (`next start`) n'est pas concernée.
- Aucun secret de `.env*.local` n'est cité par l'avis. Les journaux de développement peuvent en revanche contenir des messages d'erreur.

**Pourquoi MINEUR :** l'avis est de gravité Low, limité au développement, et les six autres ne s'appliquent pas. Mais l'ADR-0013 (ligne 149) présente 16.3.8 comme une simple version « proposée par Dependabot une fois la quarantaine écoulée ». Elle ne dit pas que c'est une version de sécurité. Or deux des six conditions d'exposition deviennent vraies dès qu'une tranche future ajoute `images.remotePatterns` ou `use cache`.

**Remédiation :**
- Consigner dans l'ADR-0013, et dans le registre `docs/DECISIONS.md`, que 16.3.8 est un correctif de sécurité, avec la liste des avis et la raison de leur non-applicabilité.
- Planifier la montée en 16.3.8 (avec `eslint-config-next` 16.3.8) dès la fin de la quarantaine pnpm (2026-10-01 vers 16:07Z), sans attendre le passage hebdomadaire de Dependabot du lundi 2026-10-05. Ne pas utiliser d'exclusion `minimumReleaseAgeExclude` : une journée d'exposition à un avis Low limité au développement ne justifie pas de déroger à l'ADR-0012.
- Tant que 16.3.8 n'est pas installée, ne pas lancer `pnpm dev` en naviguant sur des sites non fiables.

### MINEUR 2 : l'égalité imposée entre `next` et `eslint-config-next` peut retarder une mise à jour de sécurité isolée

**Emplacement :** `tests/stack-upgrade/versions.test.ts:55-59`.

**Preuve :** le test exige `eslint-config-next` === `next`. Une PR de mise à jour de sécurité Dependabot ne monte que le paquet visé par l'avis (`next`). Sa CI serait rouge tant que quelqu'un n'aligne pas `eslint-config-next` à la main. Les PR de mise à jour de version groupées (`mineures-et-correctifs`) montent les deux ensemble et ne sont pas touchées.

**Scénario :**
1. Un avis Critical est publié sur `next` (comme GHSA-vcvr-r3jv-pc5j le 2026-09-22).
2. Dependabot ouvre une PR de sécurité `next` seul.
3. La CI échoue sur l'AC1.
4. La fusion attend une intervention manuelle, et l'application reste exposée pendant ce délai.

Ce n'est pas une faille : l'effet est un délai, pas un blocage. Le `code-reviewer` a remonté le même point.

**Remédiation :** documenter la procédure (aligner `eslint-config-next` dans la même PR) ou assouplir le test pour les PR de sécurité. La décision revient à l'humain.

## Points vérifiés sans constat

- **Routes et `params` asynchrones.** `apps/web/src/app/api/organizations/[organizationId]/route.ts:9,17` utilisait déjà `params: Promise<...>` et `await params`, donc la suppression de l'accès synchrone en Next 16 ne change rien. Il n'y a pas de `middleware.ts` : le renommage en `proxy` ne s'applique pas. Aucun `export const runtime` n'est déclaré, les routes restent en runtime Node.
- **Limiteur de débit (ADR-0010).** `apps/web/src/lib/auth-rate-limit.ts` ne lit aucun en-tête. L'IP est déterminée par better-auth 1.7.6, dont la version ne change pas (seule la contrainte de pair `next@16.3.7` change dans le lockfile). Next ne réécrit pas `x-forwarded-for` différemment pour un gestionnaire de route. Les 107 tests transmis par l'orchestrateur, dont `auth-rate-limit.test.ts`, sont verts.
- **Cookies better-auth.** `toNextJsHandler` est inchangé et la version de better-auth est identique.
- **Variables d'environnement inlinées par Turbopack.** Les secrets sont lus par accès dynamique `process.env[name]` (`auth.ts:24`, `db.ts:23`), côté serveur seulement. Cette forme n'est pas remplacée au build. `git grep` ne trouve aucun `NEXT_PUBLIC` et il n'y a aucun composant client. Une recherche dans le build 16.3.7 (`apps/web/.next/static` et `.next/server`) de `postgres://...@`, `DATABASE_URL` et `BETTER_AUTH_SECRET` ne trouve rien. Je n'ai lu aucun fichier `.env*`.
- **Chaîne d'approvisionnement.**
  - `next` et `eslint-config-next` 16.3.7 ont été publiés le 2026-09-29 et ont donc plus d'un jour. Ce sont des versions stables, pas des pré-versions.
  - `pnpm-workspace.yaml` n'est pas modifié : `allowBuilds` est identique et il n'y a aucune exclusion de quarantaine.
  - Nouveaux paquets transitifs : `@babel/*` 7.29.x (via `eslint-plugin-react-hooks@7.1.1`), browserslist et ses données, `hermes-*`, `zod-validation-error@4.0.2`, `@swc/helpers@0.5.23`. `pnpm view` ne montre aucun script `preinstall`, `install` ni `postinstall` pour eux, et tous ont plus d'un jour.
  - `@rushstack/eslint-patch` (qui modifiait ESLint à l'exécution) et `@eslint/eslintrc` sont retirés.
  - Résultats de mes commandes : `pnpm audit` complet sans vulnérabilité (voir la réserve du MINEUR 1). `pnpm audit --prod` et `peers` ont été lancés par l'implémenteur, pas par moi.
- **Lint et règles de typage.** `eslint --print-config` sur `apps/web/src/lib/auth.ts` et `packages/db/src/migrate.ts` donne `no-explicit-any` = error et `ban-ts-comment` = error avec `{ts-expect-error, ts-ignore, ts-nocheck: true}`. Les configurations Next, appliquées après les règles du dépôt, ne relâchent donc pas ces options (elles ne reposent que la gravité).
  - Le filtre `isGlobalIgnores` (`eslint.config.mjs:16-20`) retire exactement 2 objets, tous deux `{ ignores: [".next/**","out/**","build/**","next-env.d.ts"] }`.
  - Sur les 45 fichiers `ts`, `tsx`, `mjs` et `js` suivis par git, `ESLint.isPathIgnored` n'en ignore qu'un : `docs/templates/vitest.config.example.ts`, exclusion déjà voulue par l'ADR-0009.
- **tsconfig.** `jsx: react-jsx` et l'include `.next/dev/types` sont des fichiers générés par Next. Sans incidence sur la sécurité.
- **Dependabot.** L'`ignore` ne vise que les majeures de `@types/node`, qui ne contient que des définitions de types sans code exécuté. Même dans le cas le plus défavorable, où cette règle s'appliquerait aussi aux mises à jour de sécurité, aucune correction de sécurité exécutable ne peut être bloquée. `next`, `better-auth` et `pg` ne sont pas concernés.

## Fichiers concernés
- `C:\dev\mon-saas\apps\web\package.json`
- `C:\dev\mon-saas\docs\02-architecture\ADR\0013-montee-next16-eslint.md`
- `C:\dev\mon-saas\tests\stack-upgrade\versions.test.ts`
- `C:\dev\mon-saas\eslint.config.mjs`
- `C:\dev\mon-saas\.github\dependabot.yml`

AUDIT: PASS
