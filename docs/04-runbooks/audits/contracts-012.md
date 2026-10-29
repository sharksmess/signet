# Rapport contract-guardian, tranche 012 (`slice/012-ecrans`)

J'ai lu `git diff main...HEAD` en lecture seule. Je n'ai lancé aucun test et je n'ai pas lu d'environnement. (Rapport rendu sans outil d'écriture, recopié tel quel par l'orchestrateur.)

## Contrats existants
- **`api-contracts/` :** le seul fichier modifié est `docs/02-architecture/api-contracts/organizations.ts`, avec 2 lignes changées.
  - `createOrganization.minRole` passe de `"public"` à `"authenticated"`.
  - `listMyOrganizations.minRole` passe de `"public"` à `"authenticated"`.
  - Les commentaires sont alignés sur D-143.
  - Les formes d'entrée et de sortie, les routes, les méthodes et les listes `errors` sont inchangées.
  - C'est une correction de métadonnée documentaire. Le comportement réel était déjà un `401` sans session, donc aucun client n'est touché. Elle était annoncée par 013 (D-139 point 6) et correspond exactement à l'attendu.
- **Fichiers hors périmètre :** `git diff main...HEAD --name-only` ne remonte aucun fichier sous `apps/web/src/app/api/`, `apps/web/src/lib/` ou `packages/`. Aucun fichier de migration, `package.json`, lockfile, `stack.json` ou `ERD.md` n'est modifié.

## Schéma de base et ERD
Aucune migration, aucun changement de schéma. L'ERD n'a pas à bouger.

## Dépendances et variables d'environnement
- Aucune dépendance nouvelle : ni `package.json` ni lockfile ne figurent dans le diff.
- Aucune variable d'environnement nouvelle. Une recherche Grep de `process.` et `NEXT_PUBLIC` dans `apps/web/src/ui` et dans `apps/web/src/app` (hors `api/`) ne trouve rien.

## Types partagés
`lib/errors.ts` n'est pas modifié et aucun type partagé n'est ajouté ni changé. Les types nouveaux (`FormId`, `FormRequest`, `SignUpOutcome`, `FetchLike`) sont locaux à `apps/web/src/ui/`.

## Conformité de la consommation

| Page ou module | Contrat consommé | Constat |
|---|---|---|
| `organisations/page.tsx`, `[organizationId]/page.tsx`, `collections/[collectionId]/page.tsx` | `listMyOrganizations`, `listCollections`, `listMembers`, `listLinks`, `getSubscription` | Les pages appellent les fonctions existantes de `@/lib/...` et les contrats réexportés (`members/contracts`, `links/contracts`), telles quelles. Aucune forme nouvelle. |
| `ui/requests.ts` | `createOrganization`, `createCollection`, invitation, `createLink`, `acceptInvitation` | Les routes et méthodes correspondent aux contrats : `POST /api/organizations` avec `{ name }`, `/collections` avec `{ name }`, `/invitations` avec `{ email }`, `/collections/:id/links` avec `{ url, title }`, `/api/invitations/accept` avec `{ token }`. Les identifiants du chemin passent par `encodeURIComponent`. |
| `ui/requests.ts` | better-auth (`/api/auth/sign-in/email`, `/sign-up/email`, `/sign-out`) | Route tierce, hors `api-contracts/`. L'envoi de `name: email` est tracé par D-144 Q-1. |
| `createdIdOf` | `createOrganizationOutput` | Lit `id` et le valide en UUID. Cohérent avec le contrat. |

## Table des messages (`ui/messages.ts`) face à `lib/errors.ts` et aux contrats
- **Textes fixes :** identiques à `lib/errors.ts` pour `ORGANIZATION_NOT_FOUND`, `INSUFFICIENT_ROLE`, `INVITATION_ALREADY_PENDING`, `ALREADY_MEMBER` (émission), `INVITATION_NOT_FOUND`, `INVITATION_EXPIRED`, `INVITATION_ALREADY_USED`, `INVITATION_EMAIL_MISMATCH`, `COLLECTION_NAME_TAKEN`, `COLLECTION_NOT_FOUND` et `SERVICE_UNAVAILABLE`.
- **`ALREADY_MEMBER` à l'acceptation :** le texte « Le compte connecte est deja membre… » reprend celui de `errors.ts` ligne 145 (P-5), distinct du texte d'émission. Les deux sont corrects.
- **Codes gérés, formulaire par formulaire :**
  - `create-organization` : `401`, `422` (le code `UNAUTHENTICATED` n'est pas lu, seul le statut compte).
  - `create-collection` : `401`, `404 ORGANIZATION_NOT_FOUND`, `422`, `409 COLLECTION_NAME_TAKEN`. Conforme à `collections.ts`.
  - `invite` : `401`, `404`, `403 INSUFFICIENT_ROLE`, `422`, `409 INVITATION_ALREADY_PENDING`, `409 ALREADY_MEMBER`, `503 SERVICE_UNAVAILABLE`. Conforme à `invitations.ts`, aucun code manquant.
  - `add-link` : `401`, `404 ORGANIZATION_NOT_FOUND`, `404 COLLECTION_NOT_FOUND`, `422`, `409 FREE_TIER_QUOTA_EXCEEDED`. Conforme à `links.ts`.
  - `accept` : `401`, `422`, `404 INVITATION_NOT_FOUND`, `410 INVITATION_EXPIRED`, `409 INVITATION_ALREADY_USED`, `403 INVITATION_EMAIL_MISMATCH`, `409 ALREADY_MEMBER`. Conforme à `acceptInvitation`.
- **Codes déclarés mais sans texte dédié :** `INSUFFICIENT_ROLE` n'est traité que pour `invite`. Sur `add-link` et `create-collection` il retombe sur le message générique, ce qui est sûr. Dans les contrats lus, il n'est déclaré ni pour `createCollection` ni pour `createLink`.
- **Codes better-auth** (`USER_ALREADY_EXISTS*`, `429`, `401`) : hors contrats internes, traités par la table.
- **Aucun écart bloquant :** aucun code géré par `messages.ts` qui n'existe pas dans les contrats ou dans `lib/errors.ts`. Tout code inconnu retombe sur `MESSAGES.generic`, ce qui est une liste fermée.

## Écarts non bloquants
1. Le `422 VALIDATION_FAILED` de plusieurs routes n'est pas toujours déclaré dans `errors` (écart déjà tracé, 009 et 013). La page l'interprète par le statut. Ce n'est pas une rupture.
2. `add-link` compare `message` au texte exact de la route pour distinguer l'erreur d'URL de l'erreur de titre. Une modification future de ces messages côté serveur dégraderait seulement le texte vers `linkInvalid`. C'est un couplage souple, sans effet sur le contrat.

## Ruptures
Aucune. Il n'y a ni champ ou route supprimés, ni code de statut changé, ni colonne ou enum touchés, ni événement modifié. Le seul changement de contrat est une étiquette `minRole` documentaire (D-143).

CONTRACTS: PASS
