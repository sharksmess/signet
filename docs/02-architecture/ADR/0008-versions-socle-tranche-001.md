# ADR-0008 — Versions du socle a la reprise de la tranche 001 : ligne Next 15, epinglage exact, fin de vie octobre 2026

- **Statut** : accepte ; partie « ligne Next 15 » remplacee par ADR-0013 (tranche 011)
- **Date** : 2026-09-24
- **Phase** : 3 — tranche 001 (creation d'organisation et compte owner), reprise apres interruption

## Contexte

Le travail partiel de la tranche 001 (commit `c851dc6`) a ete amorce avec des versions choisies au
demarrage du depot et jamais revues depuis : `next@15.1.4`, `better-auth@1.2.7`,
`drizzle-orm@0.38.3`, `drizzle-kit@0.30.1`, `zod@3.24.1`, `vitest@2.1.8`, `typescript@5.7.2`. `stack.json`
fige les CHOIX techniques (Next.js, Drizzle, Postgres, better-auth, etc., ADR-0001 et suivants) mais
ne fige aucune version precise de paquet : le gel du socle (`.gates/02-architecture.approved`) porte
sur l'architecture, pas sur un instantane de `package.json`. Revoir les versions avant de poursuivre
l'implementation ne rouvre donc pas le gate 02.

`next@15.1.4` cumule des correctifs de securite manques, verifies ici plutot que rappeles de memoire
(le projet impose `pnpm view <paquet> version`, jamais une version supposee) :

- **CVE-2025-29927** — contournement d'autorisation du middleware Next.js (l'en-tete
  `x-middleware-subrequest` fait sauter entierement l'execution du middleware). Corrige en 15.2.3
  pour la ligne 15.x. Notre code s'appuiera sur des Route Handlers avec verification de session
  explicite (ADR-0004) et non sur le middleware pour l'autorisation, mais rester sur une version
  vulnerable au niveau du framework reste un risque inutile.
- **CVE-2026-75604** — execution de code a distance non authentifiee, specifique aux deploiements
  sur systeme de fichiers Windows (traversee de chemin via des sequences `\` encodees, non
  normalisees par la couche de routage avant d'atteindre le cache disque). Corrige en 15.5.24 pour
  la ligne 15.x. Le poste de developpement de cette tranche est Windows (cf. environnement) : cette
  CVE s'applique directement, pas seulement en theorie.

Le registre npm expose une balise `backport` a `15.5.26` sur `next` : c'est la ligne de
retro-portage de securite 15.x la plus recente (au-dela des deux CVE ci-dessus, qui ne fixent qu'un
plancher a 15.2.3 et 15.5.24 respectivement), donc la version qui cumule tous les correctifs connus
sans changer de ligne majeure.

## Options envisagees

### Option A — Rester sur la ligne Next 15, epingler `15.5.26`
Conserve la compatibilite avec l'existant (App Router, Route Handlers, config `next.config.ts`,
integration better-auth deja pensee pour Next 14/15 dans l'ERD) sans aucune reecriture. Next 15
reste maintenue (corrections de securite) jusqu'a une fin de vie annoncee en octobre 2026 : cette
tranche, et vraisemblablement plusieurs tranches suivantes du banc d'essai, resteront couvertes.

### Option B — Sauter directement a Next 16 (`16.3.6`, balise `latest`)
Beneficierait d'un support plus long, mais Next 16 est une ligne majeure : aucune tranche de ce
depot n'a encore ete implementee contre elle, l'ERD et les notes d'implementation de la tranche 001
(cf. `docs/03-slices/001-creation-organisation.md`) ont ete ecrites en presupposant l'API App Router
de Next 14/15. Changer de ligne majeure au milieu d'une tranche deja entamee, sans passage par
`/architect` ni reevaluation de l'ERD, serait un changement de socle non gouverne — precisement ce
que le gel de `stack.json` interdit sans reouverture explicite du gate 02.

## Decision

Option A. `next` epingle exactement a `15.5.26` (ligne 15 retenue par compatibilite avec le travail
deja engage sur cette tranche ; corrige les deux CVE ci-dessus et tous les correctifs de la balise
`backport`). Fin de maintenance de la ligne Next 15 : **octobre 2026**. La migration vers Next 16
est explicitement **hors perimetre de ce banc d'essai** — a rouvrir par un ADR dedie et un passage
par `/architect` si une tranche future l'exige.

Les autres paquets nommes par la demande de reprise sont epingles exactement sur la derniere version
stable du registre (verifiee par `pnpm view <paquet> version`, jamais de memoire), sans contrainte
de ligne particuliere (aucune CVE ni contrainte de compatibilite ne les retient en arriere) :

| Paquet | Avant | Apres | Raison du choix de version |
|---|---|---|---|
| `next` | 15.1.4 | **15.5.26** | Ligne 15 retenue (Option A) ; balise `backport`, au-dela du plancher CVE-2025-29927 (15.2.3) et CVE-2026-75604 (15.5.24) |
| `better-auth` | 1.2.7 | **1.7.5** | Derniere stable ; sa propre `peerDependency`/`dependency` exige `zod@^4.5.4` et `drizzle-orm@^0.45.2 \|\| >=1.0.0-rc.1`, ce qui entraine les deux lignes suivantes |
| `drizzle-orm` | 0.38.3 | **0.45.3** | Derniere stable ; satisfait l'exigence de better-auth 1.7.5 |
| `drizzle-kit` | 0.30.1 | **0.31.11** | Derniere stable ; satisfait l'exigence de better-auth 1.7.5 (`>=0.31.4`) |
| `zod` | 3.24.1 | **4.6.5** | Derniere stable ; exigee telle quelle (`^4.5.4`) par la dependance `better-auth` |
| `vitest` | 2.1.8 | **5.0.1** | Derniere stable ; compatible avec la `peerDependency` `vitest` de better-auth (`^2.0.0 \|\| ^3.0.0 \|\| ^4.0.0 \|\| ^5.0.0`) |
| `typescript` | 5.7.2 | ~~7.0.2~~ **6.0.3** | Voir correction du 2026-09-24 ci-dessous : `7.0.2` casse `next dev` (`next.config.ts`), retenu `6.0.3` — derniere version qui conserve l'API compilateur classique |

Consequences directes verifiees dans cette session, avant tout code metier :
- `pnpm install` reussit sans conflit de peer dependencies restant (`pnpm peers check` : aucun apres
  ajustement de `@types/node`, cf. plus bas).
- `pnpm typecheck` (les trois `tsconfig.json` du monorepo, y compris le contrat en lecture seule
  `docs/02-architecture/api-contracts/organizations.ts` qui utilise `z.ZodTypeAny`, `.uuid()`,
  `.datetime()`) passe sans modification du contrat lui-meme : ces API zod 3 restent presentes
  (depreciees mais fonctionnelles) en zod 4.
- Un seul ajustement de code a ete necessaire, dans le perimetre de la tranche (`tests/helpers/**`) :
  `tests/helpers/auth.ts` utilisait le type ambiant `HeadersInit` (lib DOM), jamais fourni par
  `@types/node` ni par la configuration `lib: ["ES2022"]` du projet (backend uniquement, pas de
  lib DOM). Remplace par `Record<string, string>`, le type reellement retourne — correction de
  typage strict, aucun changement de comportement.
- `@types/node` (non nomme dans la demande de reprise, mais bloquant) est monte de `22.10.2` a
  `22.19.21` : `vitest@5` embarque `vite@8`, dont la `peerDependency` `@types/node` exige
  `>=22.12.0`, que `22.10.2` ne satisfaisait plus.
- `pnpm audit` : 8 vulnerabilites (5 high, 3 moderate) sur des dependances **transitives** de
  `next`, `better-auth` et `drizzle-kit` (`postcss` < 8.5.23 via `next`/`better-auth>next`, `kysely`
  < 0.28.17 via `drizzle-orm`, `esbuild` < 0.25.0 via la chaine depreciee
  `drizzle-kit>@esbuild-kit/esm-loader>@esbuild-kit/core-utils`), aucune ne venant d'un paquet
  epingle directement par ce projet. Resolues par un override `pnpm` (`pnpm-workspace.yaml`,
  `overrides: { postcss: ">=8.5.23", kysely: ">=0.28.17", esbuild: ">=0.25.0" }`) plutot qu'un ADR :
  ce ne sont pas de nouvelles dependances mais des repincages de versions de paquets deja presents
  dans l'arbre, a la version corrigee de leur propre avis de securite. `pnpm audit` confirme "No
  known vulnerabilities found" apres cet override.

## Consequences acceptees

- La ligne Next 15 atteint sa fin de maintenance en **octobre 2026** : toute tranche encore active
  a cette date devra soit avoir migre vers Next 16 (nouvel ADR, passage par `/architect`), soit
  accepter de tourner sur une ligne non maintenue. Ce banc d'essai ne s'engage pas a migrer avant
  cette date : le signal de reexamen ci-dessous fixe le declencheur.
- `typescript@7.0.2` est un changement de ligne majeure important (portage natif du compilateur).
  Verifie ici uniquement pour `tsc --noEmit` sur les trois `tsconfig.json` du monorepo : aucune
  garantie n'est prise sur d'autres usages futurs de l'API compilateur TypeScript (plugins,
  generation de types avancee) qui ne seraient pas exerces par la simple verification de types.
- `zod@4` change des API par defaut (messages d'erreur, `.safeParse` renvoie une forme d'erreur
  differente de zod 3 dans le detail). Le contrat `docs/02-architecture/api-contracts/organizations.ts`
  continue de fonctionner tel quel (API depreciees mais presentes), mais tout code ecrit dans cette
  tranche qui inspecterait la forme exacte d'une erreur zod (plutot que de la traduire via
  `validationFailed()`, `apps/web/src/lib/errors.ts`) doit etre ecrit contre l'API zod 4, jamais
  suppose identique a zod 3.
- L'override `pnpm` de `postcss`/`kysely`/`esbuild` (dans `pnpm-workspace.yaml`) doit etre revisite
  a chaque bump futur de `next`, `better-auth` ou `drizzle-kit` : une fois que ces paquets bundlent
  eux-memes une version corrigee, l'override devient un plancher inutile plutot qu'un correctif —
  a retirer si `pnpm audit` reste propre sans lui.

## Signal de reexamen

- Toute nouvelle CVE Next.js publiee contre la ligne 15.x apres `15.5.26` : re-executer
  `pnpm view next dist-tags --json` et re-epingler sur la balise `backport` courante.
  Toute CVE dont le correctif n'existe que sur la ligne 16.x forcerait une reouverture complete de
  cet ADR (et du gate 02, puisque cela impliquerait un changement de ligne majeure hors plan).
- Approche d'octobre 2026 (fin de maintenance annoncee de Next 15) sans qu'une tranche de migration
  vers Next 16 n'ait ete planifiee au backlog.
- `typescript` retente `7.x` (ou une ligne posterieure) des que Next.js et le reste de l'ecosysteme
  outillage confirment leur compatibilite avec la nouvelle API (cf. correction ci-dessous) — a
  re-verifier avant tout futur bump de cette ligne, pas seulement `pnpm view`.

## Correction du 2026-09-24 — `typescript@7.0.2` casse `next dev`

En verifiant la tranche apres la correction de l'import `pg` (ci-dessous), le demarrage de
`next dev` echouait systematiquement :

```
⨯ Failed to load next.config.ts
TypeError: Cannot read properties of undefined (reading 'fileExists')
    at getTsConfig (.../next/dist/build/next-config-ts/transpile-config.js:71)
```

Cause identifiee : `typescript@7.0.2` est le portage natif (Go) du compilateur — confirme par ses
`optionalDependencies` par plateforme (`@typescript/typescript-win32-x64` et equivalents pour
chaque OS/architecture, absentes de toute version `6.x`) et par la disparition du binaire
`tsserver` (present sur `6.0.3`, absent sur `7.0.2`). Cette version n'expose plus l'API compilateur
classique (`ts.sys`, `ts.createProgram`, `ts.findConfigFile`, etc.) dont depend le chargeur
`next.config.ts` de Next.js — et vraisemblablement d'autres outils de l'ecosysteme qui s'appuient
sur cette meme API (ESLint, etc.), non tous verifies ici.

`pnpm typecheck` (simple invocation CLI `tsc --noEmit`) continuait de passer avec `7.0.2` : le
risque etait deja explicitement signale plus haut ("aucune garantie n'est prise sur d'autres usages
futurs de l'API compilateur TypeScript") mais seulement au niveau du risque, pas encore constate.
C'est desormais constate, sur un cas reel et bloquant (l'application ne demarre plus du tout).

**Decision** : `typescript` repingle a **`6.0.3`** (derniere version stable qui conserve
l'architecture et l'API classiques, verifie par la presence de `tsserver` et l'absence
d'`optionalDependencies` par plateforme). `pnpm typecheck`, `pnpm audit` et un demarrage reel de
`next dev` (requete HTTP contre une route, echec attendu uniquement sur la connexion Postgres
factice utilisee pour le test) ont ete revalides apres ce repinglage.

Consequence acceptee : le projet n'est plus sur la toute derniere version du registre pour ce
paquet, en ecart assume avec l'instruction initiale ("prends les dernieres versions stables ...
epinglees exactement") — mais la toute derniere version casse une fonctionnalite centrale
(demarrage du serveur de developpement), donc "stable" au sens du registre npm (balise `latest`)
ne l'est pas au sens de compatibilite avec ce projet.
