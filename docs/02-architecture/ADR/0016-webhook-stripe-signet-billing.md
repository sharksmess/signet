# ADR-0016 — Traitement du webhook Stripe, role `signet_billing` et fonction `apply_stripe_subscription`

- **Statut** : accepte pour le role et le circuit (D-057, Q-1, Q-2, A1 a A4) ; details de la fonction valides par l'humain le 2026-10-15 (D-067, D-068). Revue d'architecture exigee par ERD §1 (cinquieme fonction `SECURITY DEFINER` hors triggers).
- **Date** : 2026-10-15
- **Phase** : 3 — tranche 002
- **Decisions du registre** : D-057, D-058, D-060, D-061, D-062, D-065, D-067, D-068

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

## `signet.apply_stripe_subscription(p_input jsonb) RETURNS text` (migration 0012)

- Proprietaire `signet_definer`, `SECURITY DEFINER`, `SET search_path = pg_catalog, signet, public,
  pg_temp`, tables qualifiees, `REVOKE ALL FROM PUBLIC`, `EXECUTE` au seul `signet_billing`.
- **Entree : un objet `jsonb` (D-067), valide par la fonction elle-meme avant toute lecture** :
  onze cles exactement (toute cle inconnue refusee) ; textes non vides de 255 caracteres au plus ;
  booleens types ; cles nullables presentes ; dates au format ISO 8601 complet (le cast de Postgres
  accepterait `now` ou `infinity`) ; `event_type` et `stripe_status` dans leur liste fermee. Tout
  ecart leve `SG003`.
- **Contexte** (regle d'ADR-0011, AC6) : `app.organization_id` est efface en premiere instruction.
  L'organisation vient (1) de la ligne `subscription` deja rattachee a l'identifiant Stripe, lue par
  la politique `subscription_definer_stripe_lookup` (lecture seule, sur `app.stripe_subscription_id`
  pose puis efface par la fonction), sinon (2) de `metadata_organization_id`, lue sur l'abonnement
  relu chez Stripe avec la cle secrete et posee par notre serveur au Checkout apres controle du role
  owner. Une metadonnee contraire a la ligne deja rattachee leve `SG004`.
- **Verrou** : `SELECT ... FOR UPDATE` de la ligne `subscription` de l'organisation avant toute
  decision ; deux traitements concurrents s'ordonnent (AC8 c).
- **Coherence (Q-7)** : autre abonnement deja rattache, client Stripe different, prix qui n'est pas
  `STRIPE_PRICE_ID_PRO` (D-068), identifiant deja rattache a une autre organisation : `SG006`.
  Organisation non resolue (metadonnee absente, mal formee, organisation inexistante) : `SG005`.
- **Correspondance des statuts (Q-8)** : `active`/`trialing` -> Pro actif ; `past_due`/`unpaid`/
  `paused` -> Pro `past_due` ; `incomplete` -> palier inchange ; `canceled`/`incomplete_expired`, ou
  evenement `deleted` -> Free (abonnement et fin de periode a `NULL`, client conserve, D-062).
- **Journal (Q-5)** : `subscription_started` sur Free -> Pro, `subscription_canceled` sur Pro ->
  Free, rien d'autre. `actor_user_id` = `metadata.requested_by` s'il designe un utilisateur
  existant, sinon `NULL` (valeur d'audit, jamais d'autorisation, A4). Le rejeu du meme evenement
  Stripe est absorbe par l'index unique `billing_event_stripe_idx`.
- Retour : `subscription_started`, `subscription_canceled` ou `updated`.

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
- Reponse du webhook en `500` generique : `503 SERVICE_UNAVAILABLE` dit a Stripe de renvoyer. Ce
  code n'est pas au contrat `subscriptions.ts`, dont l'interface `_contract.ts` ne prevoit pas 503
  et que la tranche ne modifie que pour `409` (anti-regression) : point remonte a l'humain.

## Consequences

- Le serveur n'expose aucune ecriture du palier : une route compromise ne peut pas changer le
  palier d'une organisation (aucune connexion `signet_billing` hors de la fonction Inngest).
- Une connexion de plus a configurer et a superviser.
- L'environnement est valide au chargement du premier module de facturation
  (`lib/env.ts`), pas au demarrage du processus Next : un serveur mal configure demarre, mais
  toute route de facturation echoue. Voir le signal de reexamen.

## Signal de reexamen

- Une tranche ajoute un fichier `instrumentation.ts` (crochet de demarrage de Next) : y appeler
  `getServerEnv()` pour refuser le demarrage lui-meme.
- Stripe introduit un statut d'abonnement inconnu de la liste fermee : `SG003`, evenement non
  traite et journalise ; decision humaine pour la correspondance.
- Plusieurs prix Pro (mensuel, annuel) : `is_pro_price` doit devenir une liste.
