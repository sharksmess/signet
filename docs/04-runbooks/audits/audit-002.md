# Audit de sécurité — tranche 002 « abonnement et changement de palier »

- Date : 2026-10-15
- Branche : `slice/002-abonnement-palier`, HEAD `6de91b2`, arbre de travail propre (`git status` vide).
- Périmètre : `git diff main...HEAD` (57 fichiers, 22 commits).
  - Code audité : migrations `0011_billing_role.sql` et `0012_billing_event.sql` ; `apps/web/src/app/api/organizations/[organizationId]/subscription/route.ts`, `app/api/webhooks/stripe/route.ts`, `app/api/inngest/route.ts` ; `lib/billing/*`, `lib/inngest/*`, `lib/env.ts`, `lib/stripe.ts`, `lib/errors.ts`, `instrumentation.ts` ; `eslint.config.mjs`, `pnpm-workspace.yaml`, `.env*.example`, `.github/workflows/ci.yml` ; liste des tests `tests/billing/*`.
  - Relus pour le contexte : migrations 0001 à 0010 (fonctions definer existantes, `context_org`, `current_org`, `propagate_subscription_quota`), `lib/db.ts` (`withTenant`), contrat 002, ADR-0016, registre D-057 à D-070, audit-010.
- Exécution :
  - `pnpm test` n'a PAS été lancé par l'auditeur, parce que d'autres relecteurs utilisent en parallèle la même base de test. Résultat transmis par l'orchestrateur : 245/245 verts, `pnpm run check` vert.
  - Tout ce qui touche à la base vient de la lecture du SQL, pas d'une exécution.
  - Un seul comportement a été vérifié en local, avec `node` : le schéma `z.string().uuid()` (Zod 4, celui du contrat `Uuid`) accepte un UUID en majuscules.
- `pnpm audit --prod --audit-level=high` : « No known vulnerabilities found ».

> Note de l'orchestrateur : rapport rendu par `security-auditor` (sans droit d'écriture sur le dépôt) et recopié tel quel. CRITIQUE-1 vérifié par l'orchestrateur : `0012_billing_event.sql:303` compare en texte, et `z.string().uuid()` accepte un UUID en majuscules.

## Points vérifiés sans constat

1. **Routes `GET/POST /api/organizations/:id/subscription`.**
   - Session vérifiée, puis `organizationId` validé par le contrat.
   - `userId` vient de `session.user.id`, jamais de la requête.
   - `readAsOwner` exécute `SELECT role FROM member WHERE organization_id = $1 AND user_id = $2` sous `signet_app`, avec la RLS (`current_org()` exige l'appartenance) en seconde barrière.
   - Non-membre ou organisation inexistante : même `404 ORGANIZATION_NOT_FOUND`. Member : `403`.
   - Le corps est fusionné en `{ ...body, organizationId }` : le chemin fait autorité, et `z.object` élimine les clés inconnues, donc pas d'affectation de masse.
   - Les erreurs Stripe sont réduites à `502` sans détail.
2. **Webhook Stripe.**
   - Le corps brut est lu par `request.text()`, la signature vérifiée par `constructEvent` (tolérance 300 s), et `400 INVALID_SIGNATURE` est renvoyé sans écho. Aucun `JSON.parse` avant la vérification.
   - Seuls les trois types `customer.subscription.*` partent en file. Clé de déduplication Inngest = `event.id`.
   - File en échec ou muette : `503` générique.
   - La route ne lit ni n'écrit la base. Seuls des identifiants Stripe apparaissent dans les journaux.
3. **Relecture chez Stripe (Q-2).** La fonction Inngest ne transmet du corps de l'événement que `id`, `type`, `subscriptionId` et `created`. L'état appliqué vient de `subscriptions.retrieve` avec la clé secrète.
4. **`/api/inngest`.** Signé hors mode développement. `env.ts` refuse `INNGEST_DEV` avec `APP_ENV=production` (valeur par défaut) et exige alors `INNGEST_SIGNING_KEY` et `INNGEST_EVENT_KEY`. `instrumentation.ts` arrête le processus si l'environnement est invalide, avec un message qui ne cite que des noms de variables.
5. **`signet.apply_stripe_subscription(jsonb)`.**
   - Propriétaire `signet_definer` (NOLOGIN, NOBYPASSRLS) ; `search_path` figé avec `pg_temp` en dernier ; tables qualifiées.
   - `REVOKE ALL FROM PUBLIC`, `EXECUTE` au seul `signet_billing`.
   - Contexte ambiant effacé en première instruction.
   - Entrée validée avant toute lecture : clés fermées, types, longueurs, ISO 8601 strict (refuse `now` et `infinity`), listes fermées.
   - Organisation dérivée de la ligne déjà rattachée, sinon de la métadonnée relue. Jamais de `NULL` au moment du `set_config`.
   - `FOR UPDATE` avant décision ; `ROW_COUNT = 1` vérifié ; `unique_violation` convertie en SG006 ; rejeu absorbé par `billing_event_stripe_idx`.
   - `requested_by` n'est qu'une valeur d'audit, jamais une autorisation.
6. **Politique `subscription_definer_stripe_lookup`.**
   - Restreinte à `signet_definer` et en lecture seule. `signet_app` peut poser `app.stripe_subscription_id`, mais aucune politique `signet_app` ne le lit.
   - Aucune autre fonction definer (`create_organization`, `organizations_for_user`, `current_org`, triggers) ne lit `subscription` sans filtrer sur l'organisation. Elles ne peuvent donc pas être détournées par ce réglage.
   - Le `GRANT UPDATE ON subscription TO signet_definer` n'est exploitable que par du code de fonction figé.
7. **`billing_event`.**
   - RLS activée et forcée. Lecture `signet_app` réservée à l'owner (`current_org()` plus rôle). INSERT `signet_definer` sur `context_org()`. `INSERT/UPDATE/DELETE/TRUNCATE` révoqués à `signet_app`.
   - Trigger `reject_mutation` (SG007). Son exception `pg_trigger_depth() > 1` est bornée au passage de `actor_user_id` à `NULL`, toutes les autres colonnes étant égales. `TRUNCATE` par le propriétaire est une limite documentée (ADR-0016).
8. **Rôle `signet_billing` (0011).** Création idempotente, attributs `NO*` réimposés. Lève sur toute appartenance dans les deux sens et sur tout `pg_db_role_setting`. Aucun mot de passe dans la migration. Seul privilège : `USAGE` sur `signet`, pas de droit de table.
9. **Secrets.**
   - Valeurs inventées dans `.env.example` (`A_REMPLACER`), `.env.test.example` et `ci.yml` (`ci_only_invente`).
   - Messages d'erreur d'environnement limités aux noms de variables.
   - Journaux `[facturation]` limités aux identifiants Stripe et aux codes SG.
10. **Dépendances.**
    - `stripe` 23.0.0, `inngest` 4.23.0, `@inngest/test` 1.0.0, versions épinglées, ADR-0015.
    - Postinstall de `protobufjs` refusé (`allowBuilds: false`). Audit propre.

## Constats

### CRITIQUE-1 : la casse de l'UUID dans l'URL donne le palier Pro à vie
- **Emplacement** :
  - `packages/db/migrations/0012_billing_event.sql:304` (`v_metadata_org IS DISTINCT FROM v_org::text`) ;
  - `apps/web/src/lib/billing/subscriptions.ts:135` (`metadata: { organization_id: params.organizationId, ... }`) ;
  - `docs/02-architecture/api-contracts/_contract.ts:36` (`Uuid = z.string().uuid()`, qui accepte les majuscules sans normaliser) ;
  - `apps/web/src/lib/inngest/process-stripe-event.ts:97-99` (refus SG004 rendu non rejouable).
- **Mécanisme** :
  - L'UUID du chemin est validé sans normalisation, puis écrit tel quel dans `subscription_data.metadata.organization_id` de Stripe.
  - Au premier rattachement, la fonction convertit la métadonnée en `uuid` : le rattachement réussit.
  - À tout événement suivant, la ligne est trouvée par `stripe_subscription_id`. La fonction compare alors la métadonnée **en texte** à `v_org::text`, que Postgres rend en minuscules. Les deux diffèrent, donc SG004 est levé.
  - La fonction Inngest traite SG004 comme définitif (D-068) : `NonRetriableError` et un simple `console.warn`.
- **Scénario d'exploitation** :
  1. Un utilisateur quelconque s'inscrit et crée l'organisation O, dont il est owner.
  2. Il appelle `POST /api/organizations/<UUID de O EN MAJUSCULES>/subscription {"tier":"pro"}`. Le contrat, `withTenant` et la RLS acceptent : `$1` et `current_setting` sont convertis en `uuid`. Il reçoit l'URL Checkout.
  3. Il paie une période. L'événement `customer.subscription.created` rattache l'abonnement : O passe Pro, `link_quota` à `NULL` (illimité), `subscription_started` journalisé.
  4. Il demande `{"tier":"free"}`, ou laisse simplement échouer le renouvellement de sa carte. Stripe émet `customer.subscription.updated`, puis `customer.subscription.deleted`.
  5. Chaque événement lève SG004 et n'est jamais rejoué. O reste `tier='pro'`, `status='active'`, quota illimité, indéfiniment. Aucun `subscription_canceled` n'est écrit, et le passage en `past_due` n'est jamais appliqué non plus.
- **Effet** : accès payant obtenu gratuitement par n'importe quel utilisateur, sans condition préalable. Stripe et la base divergent de façon permanente, et cette divergence n'apparaît que dans un avertissement de journal. Le même défaut casse aussi, par accident, les événements d'un client légitime qui appellerait l'API en majuscules. Aucun test de `tests/billing/*` n'emploie d'UUID en majuscules : la suite verte ne couvre pas ce cas.
- **Pourquoi CRITIQUE** : il n'y a ni fuite de données ni accès inter-tenant, mais la faille est exploitable telle quelle, en production, avec une perte de revenu directe et persistante.
- **Remédiation** :
  - Comparer en type `uuid` dans la fonction : valider la métadonnée par le motif, puis comparer `v_metadata_org::uuid` à `v_org`.
  - Ou bien normaliser l'identifiant à l'entrée de l'API (minuscules, ou forme canonique produite par la base) avant tout envoi à un tiers. Les deux défenses sont complémentaires.
  - Ajouter un test : Checkout demandé avec l'UUID en majuscules, puis `updated` et `deleted` traités, et l'organisation doit repasser en Free. Ce test échoue avant la correction et passe après.
  - Réexaminer si un SG004 doit rester silencieux. Il signale par construction une incohérence qui mérite une alerte, pas seulement un `warn`.

### MINEUR-1 : pas de limite de débit sur la demande de changement de palier
- **Emplacement** : `apps/web/src/app/api/organizations/[organizationId]/subscription/route.ts:28-51` ; `apps/web/src/lib/billing/subscriptions.ts:130` (`checkout.sessions.create` à chaque appel).
- **Scénario** :
  1. Un utilisateur crée des organisations sans plafond (audit-001 MINEUR-5, toujours ouvert).
  2. Il appelle en boucle `POST {"tier":"pro"}` sur une organisation Free. Le refus `409` ne vaut que pour un palier déjà Pro, donc chaque appel crée une session Checkout dans le compte Stripe, partagé par tous les tenants.
  3. Il atteint la limite de débit globale du compte Stripe. Les Checkout des autres owners échouent en `502`, et les relectures Inngest sont retardées par leurs relances. Chaque requête peut aussi occuper le serveur jusqu'à environ 20 s (10 s plus une relance).
- **Remédiation** : un limiteur par utilisateur et par organisation sur ce POST, avec un stockage partagé. Envisager de réutiliser une session Checkout encore ouverte pour la même organisation au lieu d'en créer une nouvelle.

### INFO-1 : l'isolement de `signet_billing` est une garde de code, pas une frontière
- **Emplacement** : `eslint.config.mjs` (règle `no-restricted-imports`), `apps/web/src/lib/env.ts:40`, ADR-0016 § Conséquences.
- **Constat** :
  - La règle n'interdit que l'import du module `billing-db`.
  - `getServerEnv().DATABASE_URL_BILLING` reste lisible par tout module qui importe `env.ts`, ce que font déjà les routes, via `subscriptions.ts`. Un `new Pool(...)` écrit ailleurs passerait le lint.
  - Avec cette connexion, la fonction definer fait confiance à son appelant pour `metadata_organization_id`, `is_pro_price` et `stripe_status`. Elle permettrait donc de passer n'importe quelle organisation en Pro.
  - Pas d'attaquant externe dans ce scénario. Mais la phrase d'ADR-0016, « une route compromise ne peut pas changer le palier », surestime la garantie.
- **Remédiation** : corriger la formulation de l'ADR. Envisager d'exposer `DATABASE_URL_BILLING` par un accesseur réservé à `billing-db.ts`, couvert par la même règle, plutôt que par le schéma commun.

### INFO-2 : l'événement `deleted` prime sur le statut relu
- **Emplacement** : `0012_billing_event.sql:341` (`v_event_type = 'customer.subscription.deleted' OR ...`).
- **Constat** :
  - Le type d'événement vient de la file, pas de la relecture.
  - En production, il est signé par Stripe et la file exige `INNGEST_EVENT_KEY` : pas d'exploitation possible.
  - En mode développement (`APP_ENV=development`, `INNGEST_DEV=1` dans `.env.example`), `/api/inngest` n'est pas signé. Un appel forgé `type=deleted` rétrograde une organisation Pro de la base de développement.
- **Remédiation** : facultative. Ne rétrograder sur `deleted` que si le statut relu est `canceled` ou `incomplete_expired`, ce qui alignerait sur Q-2 « l'état relu fait foi ».

### INFO-3 : un double Checkout fait payer deux abonnements, sans compensation
- **Emplacement** : `subscriptions.ts:111-113` ; comportement AC9 (f), décision Q-7.
- **Constat** :
  - Deux demandes Pro successives depuis une organisation Free créent deux sessions Checkout. Si les deux sont payées, le second abonnement est refusé en SG006 mais reste actif et facturé chez Stripe, sans annulation ni remboursement automatique.
  - Ce comportement relève d'une décision humaine, pas d'une faille exploitable.
- **Remédiation** : à porter au backlog : alerte, ou annulation automatique de l'abonnement orphelin.

AUDIT: FAIL
