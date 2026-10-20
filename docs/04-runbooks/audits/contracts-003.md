## Rapport de controle des contrats, tranche 003 (invitation d'un membre) — 2026-10-20

> Note de l'orchestrateur : rapport rendu par `contract-guardian` (sans droit d'ecriture sur le depot) sur `git diff main..HEAD` (HEAD b9e75a2), recopie tel quel. Resultat de la suite transmis au relecteur : `pnpm test` 30/30 fichiers, 354/354 tests, 0 echec (execute par l'orchestrateur au premier plan).

Aucune rupture de contrat sur la tranche 003. Je n'ai pas lancé `pnpm test` et je n'ai lu aucun fichier `.env*.local`.

**Contrat `createInvitation`** (`docs/02-architecture/api-contracts/invitations.ts`)
- Le diff ajoute seulement `409 ALREADY_MEMBER` et `503 SERVICE_UNAVAILABLE` au tableau `errors`. Ce sont les deux ajouts autorisés par D-086.
- L'entrée, la sortie, la route, la méthode, `minRole`, les 5 erreurs existantes et `idempotency` sont inchangés. Rien n'a été touché dans `acceptInvitation`.

**Implémentation**
- La route importe le contrat par `lib/invitations/contracts.ts`, qui ré-exporte le fichier de la source unique. Il n'y a pas de schéma parallèle.
- `normalizedEmail` (minuscules, 254 caractères maximum) complète le contrat sans le contredire. C'est une restriction de la forme enregistrée, pas un élargissement.
- Le chemin fait autorité sur `organizationId`. Les champs inconnus du corps sont ignorés.
- Les statuts sont 401, 404 (organisation inexistante et non-membre ont la même réponse), 403, 422, 409 `INVITATION_ALREADY_PENDING`, 409 `ALREADY_MEMBER` et 503. La réponse de succès est `201 { id, organizationId, email, expiresAt }`, sans jeton.
- Le corps d'erreur `{ code, message }` est identique à celui des routes existantes (`organizations`, `subscription`, `webhooks/stripe`).
- `ApiErrorCode` est étendu de `INVITATION_ALREADY_PENDING` et `ALREADY_MEMBER`, sans aucun retrait. L'union `status` de `ApiError` est inchangée.

**Autres contrats et routes**
- `organizations.ts`, `subscriptions.ts` et `_contract.ts` ne sont pas modifiés. Aucun fichier de route existant n'est modifié, sauf `/api/inngest`.
- `/api/inngest` sert en plus `getSendInvitationEmail()`. C'est un ajout de fonction, le protocole reste le même.
- `/api/webhooks/stripe` est inchangé.

**Base de données**
- `packages/db/migrations/0014_invitation.sql` et `meta/0004_snapshot.json` sont les seuls fichiers de migration ajoutés (statut `A`).
- `meta/_journal.json` reçoit une entrée `idx 4` avec le tag `0014_invitation`, en fin de liste. Les migrations 0001 à 0013 ne sont pas modifiées.
- La table `invitation` correspond à ERD §5 sur les colonnes, les types, les valeurs par défaut, les CHECK, les clés étrangères et les quatre index (dont l'index unique partiel).
- Aucune table ni colonne existante n'est modifiée. Seuls `CREATE TABLE invitation`, les politiques RLS, les GRANT et la fonction `signet.create_invitation` sont ajoutés.
- `packages/db/src/schema/index.ts` ajoute un export.
- `create_invitation` est une nouvelle fonction. Sa signature `(p_organization_id, p_email, p_token_hash)` diffère de la prose initiale de l'ERD, qui prévoyait `invited_by_user_id` en paramètre. Ce n'est pas une rupture, car la fonction n'existait pas. L'ERD est mis à jour dans la même PR.

**Événements**
- L'événement Stripe de 002 (`stripe/customer.subscription.changed`) est inchangé.
- Le nouvel événement `signet/invitation.created` correspond à la section Contrat d'API de la tranche. Son `id` est l'identifiant de l'invitation. Ses données sont `{ invitationId, organizationId, email, organizationName, sealedToken }` en schéma `strict`, sans jeton en clair. Il n'a pas encore de consommateur externe.

**Variables d'environnement**
- `INVITATION_TOKEN_KEY` n'est pas dans `serverEnvSchema`. Elle est validée au premier usage (`invitationTokenKey()`), donc l'environnement de production de 002 reste valide sans elle.
- `EMAIL_CAPTURE_URL` est optionnelle et refusée hors `APP_ENV=test`, comme `STRIPE_API_BASE_URL`. Aucune variable existante n'est modifiée.

**Observations hors rupture**
1. `tests/billing/environment.test.ts` reçoit une ligne `vi.stubEnv("EMAIL_CAPTURE_URL", undefined)`. Ce fichier est hors du périmètre déclaré (« sans modification »). Aucune assertion ne change, et le stub sert à isoler le test de la nouvelle garde. Je le signale pour l'arbitrage.
2. En production, sans `INVITATION_TOKEN_KEY`, l'émission lève une erreur avant toute écriture et la route répond 500. Aucun 5xx de ce type n'est déclaré au contrat. C'est un invariant de déploiement documenté (`env.ts`), pas une rupture.

CONTRACTS: PASS
