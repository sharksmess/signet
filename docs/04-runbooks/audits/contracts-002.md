## Rapport de controle des contrats, tranche 002 (abonnement et changement de palier)

**Verdict : aucune rupture de contrat constatee.** Les seuls changements de contrat sont les trois autorises par l'humain : `409 ALREADY_ON_TIER` (Q-3, D-057), `503 SERVICE_UNAVAILABLE` sur le webhook, et `503` dans le type des statuts de `_contract.ts` (D-070). Je n'ai lance ni `pnpm test` ni le build, et je n'ai pas lu l'environnement. Sources : `git diff main...HEAD`, le code et la documentation du depot.

### 1. Contrats d'API (`docs/02-architecture/api-contracts/`)
- `_contract.ts:22` : l'union des statuts passe de `... | 502` a `... | 502 | 503`. Cet ajout est additif et seul changement du fichier.
- `subscriptions.ts:77` : `changeTier` gagne `409 ALREADY_ON_TIER`. Les erreurs 401, 404, 403 et 502 sont inchangees. L'entree (`organizationId`, `tier`) et la sortie (`redirect_to_checkout` ou `pending`) sont inchangees. Ajouter un code d'erreur n'est pas une rupture ; ce cas ne retournait auparavant rien de defini.
- `subscriptions.ts:108` : le webhook gagne `503 SERVICE_UNAVAILABLE`. Le `400 INVALID_SIGNATURE`, l'entree (`rawBody`, `signature`), la sortie `{ received: true }` et la regle d'idempotence sont inchanges. Le 503 sert a faire renvoyer l'evenement par Stripe, qui le retente deja sur tout 5xx. Aucun consommateur existant n'est casse.
- `getSubscription` est inchange. `organizations.ts` n'apparait pas dans le diff. Aucun test de `tests/organizations/` n'est modifie (`git diff --stat` vide).
- Aucune route, methode, champ ou enumeration existants n'est supprime, renomme ou deplace.

### 2. Implementation conforme au contrat
- `apps/web/src/app/api/organizations/[organizationId]/subscription/route.ts`
  - Les erreurs sortent en `{ code, message }` avec le statut du contrat (lignes 7-9).
  - Le GET valide `params` avec `getSubscriptionContract.input` (ligne 19). Le POST valide `{ ...body, organizationId }` avec `changeTierContract.input` (ligne 41). L'`organizationId` du chemin fait autorite. Les entrees invalides donnent 422 `VALIDATION_FAILED`, comme en 001.
  - Les sorties sont `{ organizationId, tier, status, cancelAtPeriodEnd, currentPeriodEnd }` (`apps/web/src/lib/billing/subscriptions.ts:80-86`, date en ISO ou `null`) et `{ action: "redirect_to_checkout", checkoutUrl }` ou `{ action: "pending", organizationId }` (lignes 142 et 158).
  - Les codes renvoyes sont 401, 404 (non membre ou organisation inexistante), 403 (role `member`), 409 (lignes 112 et 118) et 502 (lignes 141, 144 et 160, sans detail Stripe).
  - Les conditions du 409 correspondent au texte du contrat : pro sur un Pro, free sur un Free, free sur un Pro dont l'annulation est deja programmee. Aucun appel Stripe n'est fait dans ces cas.
- `apps/web/src/app/api/webhooks/stripe/route.ts`
  - Signature invalide ou absente : 400 `INVALID_SIGNATURE` (lignes 62-70). La verification a lieu sur le corps brut, avant tout `JSON.parse`.
  - Evenement signe d'un type non traite, ou sans identifiant d'abonnement : 200 `{ received: true }` (lignes 72-81).
  - File d'attente refusee ou sans reponse en 5 s : 503 `SERVICE_UNAVAILABLE` (lignes 83-92).
  - Evenement mis en file : 200 `{ received: true }` (ligne 93). La deduplication se fait sur `event.id` (ligne 47). La route ne touche pas la base.
- `apps/web/src/app/api/inngest/route.ts` : point de service Inngest (GET, POST, PUT), absent du contrat `subscriptions.ts`. C'est une route nouvelle, donc additive, reservee a l'integration Inngest.
- `apps/web/src/lib/errors.ts` : `ApiErrorCode` et `ApiError.status` sont etendus (`ALREADY_ON_TIER`, `STRIPE_UNAVAILABLE`, `INVALID_SIGNATURE`, `SERVICE_UNAVAILABLE` ; statuts 400, 409, 502, 503). Les quatre codes et les quatre statuts de 001 sont conserves, ainsi que les fabriques existantes. Les routes `organizations/route.ts` et `organizations/[organizationId]/route.ts` importent ces types. Elargir une union de sortie n'est pas une rupture, car ce type est interne a l'application et les usages de 001 compilent sans changement.

### 3. Schema de base
- **Migrations existantes.** `git diff --name-status` ne montre que des ajouts : `0011_billing_role.sql`, `0012_billing_event.sql` et `meta/0002_snapshot.json`. Les migrations 0001 a 0010 sont inchangees. Je n'ai pas diffe 0011 contre un etat anterieur : elle est nouvelle dans cette branche.
- **`meta/_journal.json`.** Une entree est ajoutee (`idx` 2, tag `0012_billing_event`), et les deux entrees precedentes sont intactes. Le saut de numerotation par rapport a 0011 est documente dans `ERD.md` (section « Numerotation »). Il suit le meme principe que pour 0004 a 0010, qui sont ecrites a la main et ne figurent pas dans ce journal.
- **`0012_billing_event.sql`, partie generee** (lignes 1-24) conforme a l'ERD §8.2.
  - Colonnes : `id` en `uuid` avec `signet.uuidv7()`, `organization_id` `NOT NULL` **sans** cle etrangere, `type`, `from_tier`, `to_tier` et `stripe_event_id` nullable, `actor_user_id` en `ON DELETE SET NULL`, `occurred_at` et `recorded_at` `NOT NULL`.
  - Contraintes : trois `CHECK` d'enumeration, `billing_event_shape` identique a l'ERD, et `billing_event_stripe_event_length_chk` (ajout restrictif, nouvelle table).
  - Index : `billing_event_org_time_idx` (`occurred_at DESC`, `id DESC`) et l'index unique partiel `billing_event_stripe_idx`.
  - Le `NOT NULL` sans valeur par defaut est sans effet sur le contrat, car la table est nouvelle.
- **Partie ecrite a la main** (lignes 26-430).
  - RLS activee et forcee ; `GRANT SELECT` seul a `signet_app` ; `INSERT` seul a `signet_definer` ; trigger `billing_event_immutable` (`SG007`).
  - Le `REVOKE` va au-dela de l'ERD §8.2 (qui cite `UPDATE, DELETE`) : il couvre aussi `INSERT` et `TRUNCATE`. C'est un durcissement documente dans l'ERD.
  - `GRANT UPDATE ON subscription TO signet_definer` : nouveau droit pour un role interne, aucune colonne modifiee.
  - Politiques `subscription_definer_read`, `subscription_definer_update` et `subscription_definer_stripe_lookup` : nouvelles, additives.
  - `signet.apply_stripe_subscription(jsonb)` : fonction nouvelle, `EXECUTE` revoque a `PUBLIC` puis accorde a `signet_billing` seul.
- **Aucune colonne de `subscription` modifiee.** La migration ne contient aucun `ALTER TABLE` sur `subscription`, aucun `DROP`, ni aucun `CREATE OR REPLACE`. Elle contient un seul `UPDATE public.subscription` (ligne 368, dans la fonction nouvelle). `propagate_subscription_quota` et `quota_for_tier` n'apparaissent pas dans 0012, donc ils sont inchanges.
- **`create_organization` reste le seul `INSERT INTO subscription`.** Les deux seuls `INSERT` de 0012 portent sur `billing_event` (lignes 398 et 408).
- **`packages/db/src/schema/billing.ts`.** Il est coherent avec la migration : meme liste de colonnes, memes `CHECK`, memes index, partiel compris. `schema/index.ts` ajoute seulement `export * from "./billing"`.
- **ERD.** Les sections §1, §5, §6, §8.1, §8.2, §9 et « Migrations appliquees » sont mises a jour dans la meme branche. L'ERD documente la table, le role `signet_billing` et les codes `SG003` a `SG007`.

### 4. Evenements et files de messages
- L'evenement Inngest `STRIPE_SUBSCRIPTION_EVENT` et la fonction `process-stripe-event` sont nouveaux dans cette tranche. Il n'existe donc aucun consommateur anterieur dont la forme serait cassee. Le payload (`stripeEventId`, `type`, `subscriptionId`, `created`) est cree ici.
- Le webhook Stripe est une integration tierce existante par contrat. Sa forme d'entree (corps brut et en-tete `stripe-signature`) et ses sorties (200 `{ received: true }` et 400) sont inchangees.

### 5. Remarques non bloquantes
- Le contrat `subscriptions.ts` ne liste pas `422 VALIDATION_FAILED` dans `errors[]` de `getSubscription` et `changeTier`. Les routes le renvoient comme en 001, et l'union `status` de `_contract.ts` contient deja 422. C'est un ecart de documentation preexistant, ni une rupture ni un ajout de cette tranche.
- Compatibilite : aucune strategie (champ deprecie, double ecriture, versionnement) n'est necessaire, faute de rupture.
- Aucun ADR de migration n'est requis au titre des contrats.

CONTRACTS: PASS
