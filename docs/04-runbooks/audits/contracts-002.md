## Rapport de contrôle des contrats, tranche 002 (abonnement et changement de palier), seconde série

**Verdict : aucune rupture de contrat constatée.** Le contrôle a été refait de façon indépendante sur `git diff main...HEAD` (HEAD a049621). Je n'ai lancé ni `pnpm test` ni le build. Je me suis appuyé sur `git`, la lecture du code, des migrations, des contrats et de l'ERD. Je n'ai pas lu les fichiers `.env*.local` ni l'environnement.

> Note de l'orchestrateur : rapport rendu par `contract-guardian` (sans droit d'écriture sur le dépôt) et recopié tel quel. Il remplace le rapport de la première série (PASS, 2026-10-15).

### 1. Contrats d'API
- **Contrats de la tranche 001 inchangés.** `git diff main...HEAD -- docs/02-architecture/api-contracts/organizations.ts` est vide. Aucun fichier de `apps/web/src/app/api/organizations/**` n'est modifié hormis l'ajout de `.../[organizationId]/subscription/route.ts` (fichier nouveau). Aucun test de 001 n'est modifié.
- **`_contract.ts`.** L'union des statuts gagne `503` : élargissement sans retrait, autorisé par D-070.
- **`subscriptions.ts`.** Deux ajouts seulement : `409 ALREADY_ON_TIER` sur `changeTier` (D-057, étendu D-071) et `503 SERVICE_UNAVAILABLE` sur `stripeWebhook` (D-070). Schémas d'entrée et de sortie, routes, méthodes et autres codes (401, 403, 404, 502, 400 `INVALID_SIGNATURE`) inchangés.
- **`GET` sous `/subscription`.** La réponse `{organizationId, tier, status, cancelAtPeriodEnd, currentPeriodEnd}` correspond à `getSubscriptionOutput` (`currentPeriodEnd` en ISO ou `null`). Codes : 401, 422, 404 (non membre et organisation inexistante : même réponse), 403 (rôle `member`).
- **`POST` sous `/subscription`.** Sorties `{action:"redirect_to_checkout", checkoutUrl}` et `{action:"pending", organizationId}`, conformes à `changeTierOutput`. Codes : 401, 422, 404, 403, 409, 502. `organizationId` du chemin fait autorité sur le corps ; un corps non-objet donne 422. Le 422 `VALIDATION_FAILED` n'est pas listé dans `errors[]` du contrat mais suit le comportement déjà en place en 001 : pas un nouveau code.
- **Normalisation en minuscules de `organizationId`.** Appliquée après validation par `Uuid`, qui accepte déjà les majuscules. Ni la forme des réponses ni les codes ne changent ; la valeur renvoyée est un sous-ensemble des valeurs valides du contrat.
- **`409 ALREADY_ON_TIER`.** Il couvre Pro sur Pro, Pro sur un Free avec abonnement Stripe rattaché (`incomplete`, D-071), Free sur Free, et Free sur un Pro dont l'annulation est déjà programmée. Aucun appel Stripe dans ces cas.
- **Webhook.** 400 `INVALID_SIGNATURE` avant tout parse, 200 `{received:true}` pour les types ignorés, 503 `SERVICE_UNAVAILABLE` si la file échoue ou dépasse 5 s. Les corps d'erreur ont la forme `{code, message}` des routes de 001.

### 2. Types partagés
- **`ApiError` / `ApiErrorCode` (`apps/web/src/lib/errors.ts`).** Le `status` passe de `401 | 403 | 404 | 422` à `400 | 401 | 403 | 404 | 409 | 422 | 502 | 503` ; les codes gagnent `ALREADY_ON_TIER`, `STRIPE_UNAVAILABLE`, `INVALID_SIGNATURE`, `SERVICE_UNAVAILABLE`. Élargissement sans retrait ; les constructeurs existants sont intacts ; type interne à `apps/web`.
- **`ServerEnv`.** Type nouveau (`env.ts` est ajouté par la tranche), sans `DATABASE_URL_BILLING`, lu par un accesseur dédié de la fonction Inngest. Aucun usage de 001 n'est affecté.
- **`ApplyStripeSubscriptionInput`.** Lié à la fonction de base de 0012 ; voir le schéma ci-dessous.

### 3. Schéma de base
- **Migrations existantes intactes.** `git diff --name-status main...HEAD -- packages/db/migrations` ne liste que des ajouts : `0011_billing_role.sql`, `0012_billing_event.sql`, `0013_subscription_sync_guard.sql`, `meta/0002_snapshot.json`, `meta/0003_snapshot.json`. Seul `meta/_journal.json` est modifié. 0001 à 0010 ne sont pas touchées.
- **`_journal.json`.** Deux entrées ajoutées (idx 2 `0012_billing_event`, idx 3 `0013_subscription_sync_guard`) ; les deux entrées de `main` sont inchangées. 0011 n'y figure pas, comme les migrations manuelles 0004 à 0010.
- **0012 non modifiée par 0013.** `git log main..HEAD` sur 0012 ne montre que le commit de création (3399cd1).
- **0013.**
  - `ADD COLUMN "stripe_synced_at" timestamptz` est nullable et sans `NOT NULL` : ajout compatible.
  - `CREATE OR REPLACE FUNCTION signet.apply_stripe_subscription(p_input jsonb) RETURNS text` garde la même signature et le même type de retour. `CREATE OR REPLACE` conserve propriétaire et droits (`EXECUTE` à `signet_billing`).
  - La clé d'entrée `stripe_read_at` est nouvelle, contrôlée par `SG003` ; la fonction (0012) n'avait aucun appelant livré dans une tranche antérieure.
  - Le résultat `stale` s'ajoute aux résultats retournés, sans retrait.
- **Cohérence avec Drizzle.** `organizations.ts` ajoute `stripeSyncedAt` (nullable), conforme à 0013. `billing.ts` (nouveau) correspond à `billing_event` de 0012 (contraintes `billing_event_type_chk`, `billing_event_shape`, longueur de `stripe_event_id`). `schema/index.ts` exporte `billing`.
- **Seul INSERT dans `subscription`.** Aucune migration de 002 n'insère dans `subscription`. Les seuls `INSERT INTO subscription` du dépôt sont dans `create_organization` (0003, remplacée en 0005). 0012 et 0013 n'insèrent que dans `billing_event`.
- **ERD à jour.** §1 (rôle `signet_billing`, codes `SG003` à `SG007`), table des fonctions `SECURITY DEFINER` (`apply_stripe_subscription`), §8.1 (`stripe_synced_at`), politiques de `subscription` et `billing_event`, table des migrations (0011, 0012, 0013), matrice RLS.
- **`billing_event`.** Table nouvelle ; `organization_id` sans clé étrangère, conformément à l'ERD §8.2.

### 4. Événements et files de messages
- L'événement Inngest `StripeSubscriptionEventData` (`stripeEventId`, `type`, `subscriptionId`, `created`) et sa fonction de traitement sont créés dans cette tranche : aucun consommateur antérieur.
- Le webhook Stripe est une route nouvelle ; aucun webhook existant n'est modifié.

### Observations (hors rupture)
- **O-1.** Le libellé du `trigger` du `409` dans `docs/02-architecture/api-contracts/subscriptions.ts` ne mentionne pas explicitement le cas D-071 « abonnement Stripe déjà rattaché à un Free » (`incomplete`). Le code est identique et autorisé, donc ce n'est pas une rupture, mais un client qui ne lit que le libellé ne sait pas que `POST pro` peut renvoyer 409 sur un Free. L'orchestrateur peut décider d'ajouter ce cas au libellé.
- **O-2.** La normalisation en minuscules fait que `organizationId` dans la réponse `pending` est la forme canonique et non celle envoyée en majuscules. C'est conforme à `Uuid`, mais un client qui compare en texte sensible à la casse doit en tenir compte.

### Synthèse
- Aucun champ, code, route, méthode, énumération ou colonne n'est supprimé, renommé ou changé de sens.
- Les trois modifications de contrat (409, 503 webhook, 503 dans `_contract.ts`) sont autorisées par l'humain (D-057, D-070, D-071).
- Aucun ADR de migration n'est requis au titre des contrats.

CONTRACTS: PASS
