# 011 — Montee Next 16 et configuration ESLint native (tranche technique)

## Capacite
Tranche technique transverse, sans capacite utilisateur nouvelle. En tant qu'exploitant de Signet, je veux que le socle web tourne sur une ligne Next maintenue (la ligne 15 arrive en fin de maintenance en octobre 2026, ADR-0008), avec la configuration ESLint de la meme ligne, afin de continuer a recevoir les correctifs de securite sans migration d'urgence.

Origine : decision humaine D-041 (option A, avant la tranche 002). Cadrage : `docs/03-slices/000-backlog.md` § Tranche 011. Les PR Dependabot #7 (`eslint-config-next` 16) et #9 (`next` 16), reportees par ADR-0012, deviennent sans objet.

## Perimetre
- **Touche** :
  - versions : `next` (apps/web), `eslint-config-next` (racine), `eslint` (racine, 10 si compatible, sinon derniere 9.x) ; retrait de `@eslint/eslintrc` devenu inutile ;
  - `eslint.config.mjs` reecrit au format plat natif de `eslint-config-next` 16 (plus de `FlatCompat`), memes regles et memes portees qu'aujourd'hui ;
  - `apps/web/tsconfig.json` : seulement les reecritures que `next build` 16 impose (`jsx: react-jsx`, `include` de `.next/dev/types`) ;
  - `apps/web/next.config.ts` : seulement si un changement cassant de Next 16 l'exige ;
  - `.github/dependabot.yml` : ignorer les montees majeures de `@types/node` (D-040) ;
  - ADR-0013 ; statut d'ADR-0008 (partie « ligne Next 15 ») et d'ADR-0009 (partie ESLint) marque remplace par ADR-0013.
- **NE touche PAS** :
  - aucune capacite nouvelle, aucune route nouvelle, aucune forme de requete ou de reponse modifiee (`docs/02-architecture/api-contracts/` identique, `contract-guardian` PASS) ;
  - aucun code applicatif sous `apps/web/src/` : l'essai prealable (16.3.7, 92/92 verts) montre qu'aucun changement n'est requis ; s'il le devenait, c'est un signal d'arret, pas une extension de perimetre ;
  - aucune migration, aucun fichier de `packages/db/` ;
  - aucune assertion de test existante (`tests/organizations/**`, `tests/isolation-hardening/**`, `tests/_factory/**`) ;
  - pas de montee majeure de React (19.3.0 satisfait `next@16`) ; pas de `reactCompiler`, pas de `cacheComponents`, pas de `proxy` (aucun `middleware` dans le projet) ;
  - `@types/node` reste en 24.19.0 (D-040) ; `typescript` reste en 6.0.3 ;
  - aucune exclusion `minimumReleaseAgeExclude` dans `pnpm-workspace.yaml` ;
  - `AGENTS.md` : le guide de Next 16 le fait generer par `next dev` ; il n'est pas ajoute par cette tranche (la documentation d'agent du projet vit dans `CLAUDE.md` et `.claude/`). S'il apparait, il n'est pas committe et le fait est signale.

## Perimetre de fichiers
Declare dans `.gates/scope-011.txt` (source de verite du hook `gate-check.sh`, qui controle `apps/`, `packages/` et `tests/`). Les fichiers de la racine y figurent aussi, pour memoire.

```
apps/web/package.json
apps/web/tsconfig.json
apps/web/next.config.ts
tests/stack-upgrade/*
package.json
pnpm-lock.yaml
eslint.config.mjs
.github/dependabot.yml
```

Plus la documentation de la tranche : `docs/03-slices/011-*`, ADR-0013, statuts d'ADR-0008 et ADR-0009, `docs/DECISIONS.md`, `docs/03-slices/000-backlog.md`, journal de projet, rapports d'audit et fiche de preuves.

## Dependances
- Tranches devant etre closes avant celle-ci : 010 (close, PR #12 fusionnee).
- PR #16 (Dependabot regroupe) fusionnee : socle de depart `next@15.5.26`, React 19.3.0, `@types/node@24.19.0`.

## Contrat de donnees
Aucun changement. Aucune table, colonne, politique, fonction ni migration.

## Contrat d'API
Aucun changement. Routes existantes, formes inchangees :

| Route | Methode | Entree | Sorties | Role minimal | Idempotent sur |
|---|---|---|---|---|---|
| `/api/auth/*` | GET, POST | inchangee (better-auth) | inchangees | selon better-auth | inchange |
| `/api/organizations` | POST | `{ name }` | inchangees | authentifie | inchange |
| `/api/organizations/:organizationId` | PATCH | `{ organizationId, name }` | inchangees | `owner` | inchange |

## Criteres d'acceptation
- [x] AC1 — versions : `next` et `eslint-config-next` en 16.x stable (ni `canary`, ni `rc`, ni `beta`, ni `preview`), epingles exactement, de meme version entre eux ; `eslint` epingle exactement en 10.x, ou en 9.x si ADR-0013 contient l'erreur reproduite sous 10 ; `@eslint/eslintrc` absent des manifestes ; `eslint.config.mjs` n'utilise plus `FlatCompat` ; `pnpm-workspace.yaml` sans `minimumReleaseAgeExclude` ; ADR-0013 nomme chaque paquet change avec sa date de publication.
- [x] AC2 — non-regression : suite complete verte **sans modifier aucune assertion existante** ; `pnpm run check` et `pnpm run build` verts ; les regles Next (`@next/next/*`, `react-hooks/*`) s'appliquent toujours aux fichiers de `apps/web`, et pas a ceux de `packages/db` (meme portee qu'avant, ADR-0009) ; les regles `no-explicit-any` et `ban-ts-comment` restent en erreur partout.
- [x] AC3 — contrats : reponses de `/api/auth/*` et `/api/organizations*` inchangees : les tests existants de la tranche 001 passent tels quels ; `contract-guardian` PASS.
- [x] AC4 — securite : `pnpm audit --prod --audit-level=high` propre ; limiteur de debit d'authentification (ADR-0010) intact : `tests/organizations/auth-rate-limit.test.ts` vert et inchange ; validation des entrees intacte (aucun fichier de `apps/web/src/` modifie).
- [x] AC5 — isolation tenant : un utilisateur du tenant B ne peut ni lire ni modifier les donnees du tenant A ; les tests d'isolation des tranches 001 (`tests/organizations/isolation.test.ts`) et 010 (`tests/isolation-hardening/**`) restent verts et inchanges.
- [x] AC6 — Dependabot : `.github/dependabot.yml` ignore les montees `semver-major` de `@types/node` pour l'ecosysteme npm tant que `.nvmrc` reste sur 24 (D-040), sans toucher aux autres regles (groupes, calendrier, limites).

Cas limites couverts :
- version `latest` publiee depuis moins d'un jour (quarantaine pnpm 12) : on prend la precedente stable de la ligne, sans exclusion (regle d'ADR-0012). Le 2026-09-30, `next@16.3.8` et `eslint-config-next@16.3.8` sont dans ce cas : cible 16.3.7 ;
- ESLint 10 incompatible : erreur reproduite, repli sur la derniere 9.x, consignee dans ADR-0013 et au backlog ;
- pairs non satisfaits (`pnpm peers check`) : aucun toleres en fin de tranche ;
- fichier genere par Next hors perimetre (`AGENTS.md`, `next-env.d.ts`) : jamais committe (`next-env.d.ts` est deja ignore).

## Anti-regression
- `tests/organizations/**` (tranche 001) et `tests/isolation-hardening/**` (tranche 010) : inchanges, verts.
- `tests/_factory/db-catalog.test.ts` : inchange, vert.
- Nouveaux tests `tests/stack-upgrade/*` : versions et epinglage (AC1), portee des regles de lint (AC2), configuration Dependabot (AC6).

## Notes d'implementation
- Essai prealable du 2026-09-30, sur une branche jetable supprimee ensuite : `next@16.3.7` + `eslint-config-next@16.3.7`, `pnpm typecheck` vert, `next build` vert (Turbopack), 92/92 tests verts, sans toucher `apps/web/src/`.
- ESLint 10.11.0 echoue sous la configuration native : `TypeError: Error while loading rule 'react/display-name': contextOrFilename.getFilename is not a function` (`eslint-plugin-react@7.37.5`, derniere version publiee, dependance d'`eslint-config-next@16.3.7`, qui appelle une API retiree d'ESLint 10). `pnpm peers check` signale aussi `eslint-plugin-import`, `eslint-plugin-jsx-a11y` et `eslint-plugin-react` limites a ESLint 9. Avec `eslint@9.39.5` (derniere 9.x) : lint vert, aucun pair manquant. A reproduire et consigner dans ADR-0013.
- Configuration native : `eslint-config-next/core-web-vitals` et `eslint-config-next/typescript` exportent des tableaux de configurations plates ; les restreindre a `apps/web/**/*.{ts,tsx}` avec `settings.next.rootDir = "apps/web"`, comme aujourd'hui.
- `next build` 16 ne lance plus le lint (le lint passe par `pnpm run check`, deja en CI) et affiche `Better Auth: Could not validate the database schema` quand la base n'est pas joignable pendant la collecte des pages : bruit sans effet sur le code de sortie, a verifier contre le comportement de la ligne 15 avant de le documenter.
- Changements cassants du guide officiel (`nextjs.org/docs/app/guides/upgrading/version-16`, version 16.3.7) a traiter un par un dans ADR-0013, la plupart sans objet ici (pas de pages, d'images, de `middleware`, d'AMP, de `runtimeConfig`, de routes paralleles ni de `revalidateTag`).
