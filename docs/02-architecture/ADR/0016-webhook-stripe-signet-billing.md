# ADR-0016 — Traitement du webhook Stripe, role `signet_billing` et fonction `apply_stripe_subscription`

- **Statut** : accepte pour le role et le circuit (D-057, Q-1, Q-2, A1 a A4) ; details de la fonction valides par l'humain le 2026-10-15 (D-067, D-068). 503 au contrat et refus de demarrer par `instrumentation.ts` : D-070. Revue d'architecture exigee par ERD §1 (cinquieme fonction `SECURITY DEFINER` hors triggers).
- **Date** : 2026-10-15
- **Phase** : 3 — tranche 002
- **Decisions du registre** : D-057, D-058, D-060, D-061, D-062, D-065, D-067, D-068, D-069, D-070, D-071, D-072, D-076, D-077

## Contexte

US-08 : l'owner demande un changement de palier ; seul Stripe le confirme (ADR-0005). Le
changement doit modifier `subscription` et ecrire `billing_event` (US-08.3) **sans utilisateur de
session**, alors que toutes les politiques de `signet_app` exigent l'appartenance de l'utilisateur
de session (ADR-0011). L'evenement arrive sur une route publique, signee par Stripe.

## Circuit retenu

```
Stripe --(webhook signe)--> POST /api/webhooks/stripe
   verifie la signature sur le corps brut (tolerance 300 s), avant tout JSON.parse (AC7)
   ignore tout type hors customer.subscription.created|updated|deleted (D-060)
   inngest.send({ id: event.id, ... })   deduplication par l'id Stripe (AC8 a)
   file en echec ou muette 5 s -> 503, jamais 200 (A1, AC14, D-065 regle 3)
Inngest --> /api/inngest (signe par INNGEST_SIGNING_KEY hors mode developpement, A2, AC15)
   fonction process-stripe-event
     pas 1 « relire-abonnement » : subscriptions.retrieve (Q-2 : l'etat relu fait foi)
     pas 2 « appliquer-etat »    : sous signet_billing, signet.apply_stripe_subscription(jsonb)
     (deux pas : un echec du pas 2 est rejoue sans rappeler Stripe, D-061)
```

La route webhook ne lit ni n'ecrit la base. Seul le module de la fonction Inngest importe la
connexion `signet_billing` (`lib/inngest/billing-db.ts`), ce qu'impose `no-restricted-imports`
(AC16, D-058) : la fonction tourne dans le meme processus que les routes.

## `signet.apply_stripe_subscription(p_input jsonb) RETURNS text` (migration 0012, remplacee par 0013)

- Proprietaire `signet_definer`, `SECURITY DEFINER`, `SET search_path = pg_catalog, signet, public,
  pg_temp`, tables qualifiees, `REVOKE ALL FROM PUBLIC`, `EXECUTE` au seul `signet_billing`.
- **Entree : un objet `jsonb` (D-067), valide par la fonction elle-meme avant toute lecture** :
  douze cles exactement depuis 0013 (`stripe_read_at` ajoutee, D-071 ; toute cle inconnue refusee) ;
  textes non vides de 255 caracteres au plus ;
  booleens types ; cles nullables presentes ; dates au format ISO 8601 complet (le cast de Postgres
  accepterait `now` ou `infinity`) ; `event_type` et `stripe_status` dans leur liste fermee. Tout
  ecart leve `SG003`.
- **Contexte** (regle d'ADR-0011, AC6) : `app.organization_id` est efface en premiere instruction.
  L'organisation vient (1) de la ligne `subscription` deja rattachee a l'identifiant Stripe, lue par
  la politique `subscription_definer_stripe_lookup` (lecture seule, sur `app.stripe_subscription_id`
  pose puis efface par la fonction), sinon (2) de `metadata_organization_id`, lue sur l'abonnement
  relu chez Stripe avec la cle secrete et posee par notre serveur au Checkout apres controle du role
  owner. Une metadonnee contraire a la ligne deja rattachee leve `SG004` ; la comparaison se fait
  en type `uuid` depuis 0013 (audit-002 CRITIQUE-1 : en texte, un UUID en majuscules dans l'URL
  bloquait tous les evenements suivants), et les routes normalisent l'identifiant en minuscules
  avant tout envoi a Stripe.
- **Verrou** : l'organisation est d'abord resolue (lecture sans verrou de la ligne rattachee), puis
  la ligne `subscription` de cette organisation est verrouillee (`SELECT ... FOR UPDATE`) avant
  toute decision sur l'etat ; deux traitements concurrents s'ordonnent (AC8 c). Le verrou ordonne
  les ecritures, pas l'age des etats appliques : c'est le role de la garde monotone.
- **Garde monotone (D-071, review-002 BLOQUANT 1)** : la fonction Inngest transmet l'instant de la
  relecture Stripe (`stripe_read_at`, pris apres la reponse). La fonction ignore, sans ecriture ni
  erreur (resultat `stale`), un etat relu avant le dernier etat applique
  (`subscription.stripe_synced_at`, colonne de 0013). Cas couvert : `updated` relu « actif » dont
  l'ecriture echoue, `deleted` traite entre-temps, puis rejeu par Inngest du pas memorise. Revient
  partiellement sur Q-2 (« aucune colonne nouvelle ») ; la garde porte sur l'instant de RELECTURE
  (milliseconde), pas sur `event.created` (seconde) ecarte par Q-2.
  **Limites restantes (D-072, review-002 et audit-002 de la seconde serie)** :
  - la marque est l'instant ou l'instance a **recu** la reponse de Stripe, pas l'instant de l'etat
    chez Stripe (Stripe n'en fournit pas) ; deux relectures tres proches peuvent etre ordonnees a
    l'inverse de l'etat qu'elles portent, a la latence reseau pres ;
  - la marque est lue sur l'**horloge de la base** (`clock_timestamp()` sous `signet_billing`),
    juste apres la reponse de Stripe, dans le pas de relecture (D-077) : une seule horloge pour
    toutes les instances, l'avance ou le retard d'un serveur ne change plus l'ordre. Historique :
    D-072 bornait une marque d'instance a 5 minutes dans le futur (refus definitif), D-076 avait
    rendu ce refus rejouable (`SG008`) ; la quatrieme relecture de code a montre que ce rejeu
    pouvait reappliquer un etat « actif » apres une resiliation plus recente. La marque de la base
    rend la borne et `SG008` inutiles : retires. Un `stale` est journalise ;
  - deux executions concurrentes du meme abonnement ne sont pas ordonnees par la garde mais par la
    limite de concurrence Inngest `{ key: event.data.subscriptionId, limit: 1 }` (D-072). Inngest
    limite les **pas en cours**, pas les executions en attente de relance : le rejeu d'un pas
    memorise apres une panne reste le cas de la garde, qui le couvre.
  Ecarte : une marque fournie par Stripe (aucune n'existe sur l'objet abonnement) ; un numero de
  sequence par abonnement tenu par Stripe (meme raison).
- **Coherence (Q-7)** : autre abonnement deja rattache, client Stripe different, prix qui n'est pas
  `STRIPE_PRICE_ID_PRO` (D-068), identifiant deja rattache a une autre organisation : `SG006`.
  Organisation non resolue (metadonnee absente, mal formee, organisation inexistante) : `SG005`.
- **Correspondance des statuts (Q-8)** : `active`/`trialing` -> Pro actif ; `past_due`/`unpaid`/
  `paused` -> Pro `past_due` ; `incomplete` -> palier inchange ; `canceled`/`incomplete_expired` ->
  Free (abonnement et fin de periode a `NULL`, client conserve, D-062). Depuis 0013 (D-071), le
  type d'evenement `deleted` n'intervient plus : Stripe relit un abonnement supprime en `canceled`,
  et un `deleted` forge (mode developpement non signe, audit-002 INFO-2) ne retrograde rien.
- **Journal (Q-5)** : `subscription_started` sur Free -> Pro, `subscription_canceled` sur Pro ->
  Free, rien d'autre. `actor_user_id` = `metadata_requested_by` de l'entree s'il designe un
  utilisateur existant, sinon `NULL` (valeur d'audit, jamais d'autorisation, A4). La fonction
  Inngest y place l'auteur de la transition (D-071, review-002 BLOQUANT 2) : `canceled_by` (pose
  par la demande d'annulation de l'owner) quand le statut relu mene a Free, `requested_by` (pose au
  Checkout) sinon. Une resiliation par Stripe seul n'a pas de `canceled_by` : auteur `NULL`. Le
  rejeu du meme evenement Stripe est absorbe par l'index unique `billing_event_stripe_idx`.
- Retour : `subscription_started`, `subscription_canceled`, `updated` ou `stale` (garde monotone).

### Codes d'erreur (D-067, D-068)

| Code | Cas | Traitement par la fonction Inngest |
|---|---|---|
| `SG003` | entree invalide | journalise, `NonRetriableError` |
| `SG004` | metadonnee contraire a la ligne deja rattachee | journalise, `NonRetriableError` |
| `SG005` | organisation non resolue | journalise, `NonRetriableError` |
| `SG006` | incoherence Stripe (Q-7) | journalise, `NonRetriableError` |
| `SG007` | mutation de `billing_event` (trigger) | sans objet |
| autre | base indisponible, privilege retire | rejoue par Inngest |

Les cas « sans effet » levent plutot que de rendre un statut : regle 3 de
`.claude/rules/drizzle-postgres.md` (« echouer bruyamment ») et annulation garantie de toute
ecriture. Condition de l'humain (D-068) : ils ne sont jamais rejoues.

### Evenement abandonne (D-077)

Une erreur rejouable qui persiste (Stripe ou base indisponibles longtemps) epuise les relances
d'Inngest : 3 par pas, defaut du SDK `inngest` 4.23.0 (non modifie). L'etat relu n'est alors pas
applique. La fonction declare `onFailure` : `reportAbandonedEvent` journalise en **erreur**
l'identifiant de l'evenement Stripe, l'abonnement, l'execution Inngest et le nom de l'erreur, avec
la mention « a reprendre a la main » ; jamais le corps de l'evenement ni le message complet d'une
erreur (AC9 a). Le crochet est aussi appele apres un refus non rejouable (SG003 a SG006) : ces
refus produisent donc deux lignes, la raison (`logRejection`) puis l'abandon. Reprise : renvoyer
l'evenement depuis le tableau de bord Stripe, ou rejouer l'execution depuis Inngest.

## `billing_event` append-only

`REVOKE INSERT, UPDATE, DELETE, TRUNCATE` a `signet_app` ; trigger `billing_event_immutable`
(`signet.reject_mutation()`, `SG007`) pour le proprietaire et le superutilisateur. Exception
unique : l'action referentielle `ON DELETE SET NULL` d'`actor_user_id` (seule colonne modifiee,
vers `NULL`, depuis un trigger systeme : `pg_trigger_depth() > 1`), sans laquelle la suppression
d'un compte echouerait (ERD §8.2).

**Limite acceptee** : `TRUNCATE` n'est pas couvert par un trigger. Seuls le proprietaire et le
superutilisateur peuvent l'executer, et la remise a zero de la base de test en a besoin
(`TRUNCATE app_user ... CASCADE` atteint `billing_event` par la cle etrangere). Un trigger
`BEFORE TRUNCATE` a ete essaye et retire pour cette raison.

## Options ecartees

- Executer la fonction sous `signet_app` ou `signet_owner` (Q-1, ADR-0007 amende).
- Appliquer l'instantane du corps du webhook avec une garde de date (Q-2).
- Passer l'organisation en argument : valeur choisie par l'appelant (AC6 c).
- Arguments types plutot qu'un `jsonb` (D-067).
- Un seul pas Inngest pour la relecture et l'ecriture (D-061).
- Traiter aussi `checkout.session.completed` (D-060).
- Reponse du webhook en `500` generique : confondue avec un bug. Retenu : `503 SERVICE_UNAVAILABLE`,
  qui dit a Stripe de renvoyer, ajoute au contrat `subscriptions.ts` et au type des statuts de
  `_contract.ts` (decision humaine D-070). Ecarte : le laisser hors contrat comme reponse
  d'infrastructure.

## Consequences

- Aucune route n'accede a la connexion `signet_billing` (AC16, renforce par D-071) :
  - `billing-db` n'est importable que par `./billing-db` depuis `process-stripe-event.ts` (toute
    autre forme, extension ou chemin relatif refusee ; `import()` et `require()` refuses partout) ;
  - `DATABASE_URL_BILLING` est validee au demarrage mais retiree de `ServerEnv` ; seul
    `billing-db.ts` la lit, par l'accesseur `billingDatabaseUrl()` de `env.ts`, dont l'import est
    refuse ailleurs ; `process.env.DATABASE_URL_BILLING` est refuse dans toute l'application ;
  - preuve : un test par forme (`tests/billing/lint-isolation-forms.test.ts`).
  Cela reste une **garde de code, pas une frontiere** (audit-002 INFO-1) : du code ecrit pour la
  contourner (lecture indirecte de l'environnement, cle calculee, `import()` d'une chaine calculee)
  n'est pas detectable par le lint,
  et avec cette connexion la fonction definer croit son appelant sur la metadonnee, le prix et le
  statut. La barriere contre une route compromise est la revue et le lint, pas la base.
- Une connexion de plus a configurer et a superviser.
- L'environnement est valide au demarrage du processus (`apps/web/src/instrumentation.ts`, D-070) :
  un environnement de facturation invalide arrete `next start` en erreur, en nommant les variables
  sans leurs valeurs (`tests/billing/startup.test.ts`). L'arret passe par `process.exit` car Next
  16.3.8 ne fait que journaliser une erreur levee par `register()` et continue d'ecouter. Il vit
  dans `lib/env.ts`, importe seulement sous le runtime Node (pas d'API Node dans le bundle Edge).
  `getServerEnv()` reste appele par chaque module de facturation (meme validation, mise en cache).

## Signal de reexamen

- Stripe introduit un statut d'abonnement inconnu de la liste fermee : `SG003`, evenement non
  traite et journalise ; decision humaine pour la correspondance.
- Plusieurs prix Pro (mensuel, annuel) : `is_pro_price` doit devenir une liste.
