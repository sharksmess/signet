# Audit de sécurité — tranche 002 « abonnement et changement de palier » (seconde série)

- Date : 2026-10-19
- Branche : `slice/002-abonnement-palier`, HEAD `a049621`.
- État de l'arbre de travail : seuls des fichiers de mémoire d'agents sont modifiés (`.claude/agent-memory/*`). Aucun code non commité.
- Périmètre :
  - `git diff main...HEAD` : 66 fichiers, 27 commits.
  - Les 5 commits de correction sont relus en détail : `git diff 6de91b2..HEAD`, soit 27 fichiers.
  - Le corps de `signet.apply_stripe_subscription` a été comparé mécaniquement entre 0012 et 0013.

> Note de l'orchestrateur : rapport rendu par `security-auditor` (sans droit d'écriture sur le dépôt) et recopié tel quel. Il remplace le rapport de la première série (`AUDIT: FAIL`, 2026-10-15, CRITIQUE-1), dont le suivi figure ci-dessous.

## Méthode

- **Lu ligne à ligne :**
  - les migrations `0011_billing_role.sql`, `0012_billing_event.sql` (grants, politiques, triggers, fonction) et `0013_subscription_sync_guard.sql` ;
  - `packages/db/src/schema/organizations.ts` ;
  - les routes `organizations/[organizationId]/subscription/route.ts`, `webhooks/stripe/route.ts` et `inngest/route.ts` ;
  - `instrumentation.ts`, `lib/env.ts`, `lib/stripe.ts` ;
  - `lib/billing/subscriptions.ts` et `lib/billing/contracts.ts` ;
  - `lib/inngest/client.ts`, `lib/inngest/billing-db.ts` et `lib/inngest/process-stripe-event.ts` ;
  - `eslint.config.mjs` (`billingIsolation()`) ;
  - les tests `tests/billing/review-corrections.test.ts` et `lint-isolation-forms.test.ts`.
- **Relu pour le contexte :**
  - le registre D-060 à D-071 et `002-decisions-humaines.md` ;
  - ADR-0016 (§ isolement, l. 125-135) et le backlog (entrées audit-002) ;
  - les rapports `audit-002.md` et `review-002.md` de la première série.
- **Tests :** je n'ai pas lancé `pnpm test`, parce que la base est partagée avec les autres relecteurs. Résultat transmis par l'orchestrateur : 274/274 en 24 fichiers, `pnpm run check` vert.
  - Ce qui touche à la base vient de la lecture du SQL, pas d'une exécution.
  - Pour chaque test d'anti-régression, j'ai vérifié à la lecture qu'il échoue avant correction et passe après (section dédiée plus bas).
- **Dépendances :** `pnpm audit --prod --audit-level=high` répond « No known vulnerabilities found ».
  - Ajouts : `stripe` 23.0.0, `inngest` 4.23.0 et `@inngest/test` 1.0.0 (dev). Versions épinglées, ADR-0015. Le postinstall de `protobufjs` est refusé.
  - Aucune dépendance n'a été ajoutée depuis la première série.
- Je n'ai lu ni `.env*.local` ni l'environnement.

## Verdict

Aucun constat CRITIQUE ni MAJEUR. CRITIQUE-1 de la première série est corrigé deux fois, en base et à l'entrée de l'API. Les deux corrections de sécurité issues de la relecture de code sont saines : la garde monotone et le passage en Free décidé par le statut relu. Il reste :
- un MINEUR reconduit, déjà inscrit au backlog ;
- trois INFO, sans scénario d'exploitation par un tiers.

## Suivi des constats de la première série

| Constat (audit-002, 1re série) | État | Preuve |
|---|---|---|
| CRITIQUE-1 : la casse de l'UUID donne le palier Pro à vie | **Corrigé** | Voir le détail ci-dessous. |
| MINEUR-1 : pas de limite de débit sur `POST .../subscription` | **Ouvert, au backlog** (D-071) | `000-backlog.md:69`. Reconduit ci-dessous en MINEUR-1. |
| INFO-1 : l'isolement de `signet_billing` est une garde de code | **Traité** | Voir le détail ci-dessous. Résidu en INFO-2. |
| INFO-2 : le type `deleted` primait sur le statut relu | **Corrigé** | Voir le détail ci-dessous. |
| INFO-3 : un double Checkout fait payer deux abonnements | **Au backlog**, en partie réduit | Voir le détail ci-dessous. |

**CRITIQUE-1, détail de la correction :**
- `0013_subscription_sync_guard.sql:159-163` compare en `uuid` : `CASE WHEN v_metadata_org ~ c_uuid_pattern THEN v_metadata_org::uuid <> v_org ELSE true END`. Une valeur qui n'est pas un UUID lève toujours SG004.
- `route.ts:179-181`, `:198` et `:222` normalisent l'identifiant en minuscules avant tout usage, donc avant l'envoi à Stripe.
- `process-stripe-event.ts:119` journalise désormais SG004 en `console.error`.
- Le diff mécanique 0012 → 0013 ne montre pas d'autre changement que ceux annoncés en tête de 0013.

**INFO-1 de la première série, détail du traitement :**
- `DATABASE_URL_BILLING` est retirée de `ServerEnv` (`env.ts:78`, `:99-103`) et n'est lisible que par `billingDatabaseUrl()` (`env.ts:106-108`).
- Le lint refuse l'accesseur et `process.env.DATABASE_URL_BILLING` (point, crochets, déstructuration) hors `billing-db.ts`, ainsi que `import()` et `require()`. Il y a un test par forme.
- ADR-0016:131-135 écrit désormais « garde de code, pas une frontière ».

**INFO-2 de la première série :** `0013:206` ne passe en Free que sur un statut relu `canceled` ou `incomplete_expired`. Un `deleted` forgé en mode développement ne rétrograde plus rien. Le test « deleted relu actif » le couvre.

**INFO-3 de la première série :** le 409 posé tant qu'un abonnement est rattaché (`subscriptions.ts:116`) ferme le cas `incomplete`. Le double Checkout depuis un Free sans abonnement rattaché reste possible. C'est une décision humaine (Q-7), pas une faille.

Deux points de la relecture de code touchent aussi la sécurité :
- **review-002 BLOQUANT 1 (état périmé rejoué après `deleted`) : corrigé.**
  - `0013:185-187` renvoie `stale` si `v_read_at < stripe_synced_at`, sans écriture ni `billing_event`.
  - `0013:240` avance la colonne, et uniquement sur le chemin d'écriture, après les contrôles Q-7.
  - `stripe_read_at` est validé comme les autres dates : ISO strict et calendrier.
- **review-002 BLOQUANT 2 (auteur de l'annulation) : corrigé.**
  - `canceled_by` est posé à l'annulation (`subscriptions.ts:160`) et lu seulement pour un statut qui mène à Free (`process-stripe-event.ts:54-55`).
  - Ce n'est qu'une valeur d'audit : elle n'est jamais utilisée comme autorisation, et la FK avec repli `NULL` est inchangée.

### Les tests d'anti-régression distinguent-ils les deux états ?

| Test (`tests/billing/review-corrections.test.ts`) | Avant correction | Après correction |
|---|---|---|
| CRITIQUE-1 : Checkout demandé en majuscules | Échoue : la métadonnée part en majuscules | Passe : elle part en minuscules |
| CRITIQUE-1 : `updated` puis `deleted` avec une métadonnée en majuscules | Échoue : SG004 bloque `expectProcessed` | Passe : l'organisation repasse en Free et `subscription_canceled` est écrit |
| BLOQUANT 1 : rejeu d'un état mémorisé « active » après un `deleted` complet | Échoue : l'organisation est rattachée à nouveau en Pro avec un faux `subscription_started` | Passe : résultat `stale`, l'organisation reste Free, quota 50 |
| review 3 : `deleted` relu `active` | Échoue : 0012 forçait Free | Passe : l'organisation reste Pro |
| review 4 : 409 sur un Free avec un abonnement `incomplete` rattaché | Échoue : un Checkout était créé | Passe : 409, aucun appel à Stripe |

Ces tests ne valident donc pas la correction par construction : chacun échouerait si la correction était retirée.

## Points vérifiés sans constat

1. **Isolation tenant, routes.**
   - `userId` vient de la session, et `organizationId` du chemin, validé puis canonisé.
   - `readAsOwner` filtre `member` sur l'organisation et l'utilisateur, sous `signet_app`, avec `subscription_owner_only` (appartenance de l'utilisateur de session, 0009) en seconde barrière.
   - Une organisation inexistante ou étrangère reçoit le même 404. Un member reçoit 403.
   - Corps fusionné `{ ...body, organizationId }` : le chemin fait autorité, et `z.object` élimine les clés inconnues, donc pas d'affectation de masse.
2. **Fonction `SECURITY DEFINER` (0013) :**
   - propriétaire `signet_definer`, `search_path` figé avec `pg_temp` en dernier, `REVOKE ALL FROM PUBLIC` et `EXECUTE` au seul `signet_billing` (`0013:293-295`) ;
   - contexte ambiant effacé en première instruction, entrée fermée et validée avant toute lecture ;
   - organisation dérivée d'une valeur de confiance, jamais `NULL` au moment du `set_config` ;
   - `FOR UPDATE`, `ROW_COUNT = 1` vérifié, `unique_violation` convertie en SG006, rejeu absorbé.
   - La nouvelle colonne est couverte par le `GRANT UPDATE ON subscription TO signet_definer` existant. `signet_app` reste sans INSERT, UPDATE ni DELETE sur `subscription` (0003:194).
3. **Politiques et `billing_event` :** inchangés depuis la première série. Ce sont les politiques `subscription_definer_read`, `_update` et `_stripe_lookup` (lecture seule) et l'ajout seul (append-only) de `billing_event` : REVOKE, trigger SG007, lecture réservée à l'owner.
4. **Webhook :**
   - corps brut, puis `constructEvent` avec une tolérance de 300 s, avant tout parse ;
   - `400` sans écho, `503` générique si la file échoue ;
   - déduplication par `event.id` ;
   - la route n'accède jamais à la base.
5. **`/api/inngest` et démarrage :**
   - les appels sont signés hors mode développement ;
   - `INNGEST_DEV` est refusé avec `APP_ENV=production`, qui est la valeur par défaut ;
   - hors mode développement, `INNGEST_SIGNING_KEY` et `INNGEST_EVENT_KEY` sont exigées (testé) ;
   - `instrumentation.ts` arrête le processus, avec un message qui ne cite que des noms de variables.
6. **Métadonnées Stripe :** `organization_id` sert seulement à rattacher un abonnement inconnu, puis la ligne en base fait foi. `requested_by` et `canceled_by` ne sont que des valeurs d'audit, validées par motif UUID. Aucune ne sert à autoriser quoi que ce soit.
7. **Secrets :**
   - les journaux `[facturation]` ne contiennent que des identifiants Stripe et des codes SG ;
   - les messages d'environnement ne citent que des noms de variables ;
   - les erreurs Stripe sont réduites à `502` sans détail.

## Constats

### CRITIQUE
Aucun.

### MAJEUR
Aucun.

### MINEUR-1 (reconduit) : pas de limite de débit sur la demande de changement de palier
- **Emplacement :**
  - `apps/web/src/app/api/organizations/[organizationId]/subscription/route.ts:204-227` ;
  - `apps/web/src/lib/billing/subscriptions.ts:134` (`checkout.sessions.create` à chaque appel).
- **Scénario :**
  1. Un utilisateur crée des organisations sans plafond (audit-001 MINEUR-5).
  2. Sur chacune, encore Free et sans abonnement rattaché, il répète `POST {"tier":"pro"}`. Chaque appel crée une session Checkout dans le compte Stripe commun à tous les tenants.
  3. Il épuise la limite de débit du compte. Les Checkout et les relectures Inngest des autres tenants échouent en `502` ou sont relancés. Chaque requête peut aussi occuper le serveur environ 20 s.
- **Remédiation :** un limiteur par utilisateur et par organisation, à stockage partagé, ou la réutilisation d'une session Checkout encore ouverte. C'est inscrit au backlog (`000-backlog.md:69`, D-071).

### INFO-1 (nouveau) : la garde monotone repose sur l'horloge du serveur applicatif, pas sur l'ordre côté Stripe
- **Emplacement :**
  - `apps/web/src/lib/inngest/process-stripe-event.ts:96-99` (`readAt = new Date()` après la réponse de Stripe) ;
  - `:84-85` (pas de clé de `concurrency`) ;
  - `0013_subscription_sync_guard.sql:185-187`.
- **Constat :**
  1. Fenêtre de concurrence. Deux exécutions du même abonnement peuvent être en vol en même temps. Si l'instantané le plus ancien revient le dernier (latence réseau), son `readAt` est postérieur et il gagne. La fenêtre se compte en millisecondes, à la latence de Stripe près.
  2. Dérive d'horloge. Une instance dont l'horloge avance ferait passer pour `stale` les états légitimes relus ensuite par les autres instances. Ces états ne seraient signalés qu'en `console.info`.
  - **Pourquoi aucun attaquant ne peut s'en servir :** il faudrait un événement concurrent au moment de la suppression. Or le propriétaire ne peut plus en provoquer : après l'annulation programmée, `POST free` et `POST pro` répondent tous deux 409, et il n'y a pas de portail client dans la tranche. Le cas couvert par la décision D-071, le rejeu mémorisé après une panne, est bien fermé.
- **Remédiation (facultative) :**
  - sérialiser par abonnement (`concurrency` à 1 sur `event.data.subscriptionId`), ce qui supprime la fenêtre concurrente ;
  - journaliser `stale` au niveau avertissement, pour qu'une dérive d'horloge soit visible.

### INFO-2 (reliquat d'INFO-1 de la première série) : l'isolement de `signet_billing` reste une garde de lint
- **Emplacement :** `eslint.config.mjs` (`billingIsolation()`), `apps/web/src/lib/env.ts:106-108`.
- **Constat :** les formes nommées sont couvertes et testées. Des accès indirects ne sont pas détectés, par exemple `Object.entries(process.env)` ou `{ ...process.env }`. ADR-0016:131-135 le reconnaît désormais explicitement. Il n'y a pas d'attaquant externe : le risque est du code de l'équipe, que la revue doit attraper.
- **Remédiation :** aucune exigée. La formulation de l'ADR est maintenant exacte.

### INFO-3 (reliquat d'INFO-3 de la première série) : un double Checkout depuis un Free sans abonnement rattaché
- **Emplacement :** `apps/web/src/lib/billing/subscriptions.ts:113-117`.
- **Constat :** deux sessions Checkout ouvertes avant le premier rattachement, puis payées toutes les deux, laissent un abonnement orphelin facturé, refusé en SG006. C'est une décision humaine (Q-7), inscrite au backlog (`000-backlog.md:70`). Ce n'est pas une faille exploitable contre un tiers.
- **Remédiation :** celle du backlog : une alerte, ou l'annulation automatique de l'abonnement orphelin.

AUDIT: PASS
