# 002 — Abonnement et changement de palier

> **Statut : valide par l'humain le 2026-10-08 (D-057, `002-decisions-humaines.md`), active.** Premiere tranche qui touche a l'argent. Les questions Q-1 a Q-9 du brouillon sont tranchees (option recommandee retenue partout) ; les complements A1 a A6 de l'orchestrateur sont integres comme criteres AC14 a AC18 et AC3 (e). Decisions locales de Claude Code : D-058 a D-064.

## Capacite
En tant qu'owner, je consulte le palier d'abonnement de mon organisation et je demande a en changer (Free -> Pro par Stripe Checkout, Pro -> Free par annulation en fin de periode), afin de payer pour des liens illimites ou d'arreter de payer (US-08). Chaque changement confirme par Stripe laisse un evenement facturable horodate, rattache a l'organisation (US-08.3).

## Perimetre
- **Touche** :
  - table `billing_event` (ERD §8.2 : append-only, sans FK sur `organization_id`, index unique partiel `stripe_event_id`) et ses politiques RLS ;
  - une fonction `SECURITY DEFINER` d'application d'etat Stripe (`signet.apply_stripe_subscription`, nom indicatif), seule a ecrire `subscription` et `billing_event` en dehors de `create_organization` ;
  - le role `signet_billing` qui l'execute (Q-1) : `LOGIN`, `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, aucun droit de table, `EXECUTE` sur cette seule fonction ; ADR-0007 amende, ERD §1 et §8.1 reecrits ;
  - routes `GET` et `POST /api/organizations/:organizationId/subscription`, `POST /api/webhooks/stripe`, `/api/inngest` (point de service Inngest) ;
  - une fonction Inngest de traitement des evenements Stripe, seule detentrice de la connexion `signet_billing` (AC16) ;
  - ADR-0011 (regle d'audit-010 MINEUR-2), ADR-0015 (dependances et doublures de test), ADR-0016 (traitement du webhook et role `signet_billing`), ERD §1, §8 et matrice, contrat `subscriptions.ts` (ajout de `409 ALREADY_ON_TIER`, Q-3), `.env.example`, `.env.test.example`, workflow CI (valeurs de test inventees), regle de lint d'import (D-058), runbook Stripe et Inngest en local (Q-9, A6, mot de passe de `signet_billing`).
- **NE touche PAS** :
  - portail client Stripe (Customer Portal), moyens de paiement, factures et recus, TVA et adresses de facturation, coupons et codes promo, essais gratuits, prorata explicite, montants ou devises stockes en base (ERD §0 : Stripe fait foi) ;
  - reactivation d'un abonnement dont l'annulation est programmee (Q-4) : une demande `pro` sur un Pro, programme ou non, recoit `409` ;
  - historique des evenements facturables expose par l'API (aucune route de lecture de `billing_event` : le PRD n'en demande pas ; la table est lisible par l'owner en RLS pour une tranche future) ;
  - toute page ou interface (Q-6) : aucune page de connexion n'existe encore (tranche 001 = API seule) ; les URL de retour Checkout pointent sur `APP_URL` + un chemin fixe qui n'a pas besoin d'exister ;
  - quota de liens (tranche 005) : seule la propagation `subscription.tier -> organization_link_usage.link_quota`, deja en place (trigger `propagate_subscription_quota`), est verifiee ;
  - invitations et e-mails (tranches 003/006), meme si ADR-0006 y prevoit aussi Inngest : seule la fonction Stripe est creee ici ;
  - audit-010 MINEUR-1 (`REVOKE INSERT ON organization`) et INFO-4 : restent au backlog. INFO-1 (assertion de roles dans le sens inverse et `pg_db_role_setting`) est **inclus** dans la migration de roles de la tranche (D-064) ;
  - choix d'hebergement, en-tete IP de confiance (backlog, MINEUR-11), resynchronisation planifiee avec Stripe (cron Inngest), mot de passe des roles (fixe par l'humain).

## Perimetre de fichiers
Declare dans `.gates/scope-002.txt` (source de verite du hook) : documentation de la tranche (ERD, ADR-0007/0011/0015/0016, contrat `subscriptions.ts`, registre, journal, runbooks `stripe-*`), migrations nouvelles et schema `billing`, routes `subscription`, `webhooks/stripe`, `inngest`, modules `apps/web/src/lib/{billing,inngest}/*`, `stripe.ts`, `env.ts`, `db.ts`, `errors.ts`, `eslint.config.mjs` (AC16), manifestes et lockfile, `.env.example`, `.env.test.example`, workflow CI, `tests/billing/**`, `tests/helpers/db.ts`, `tests/helpers/billing*.ts`. Les tests de 001, 010 et 011 sont hors perimetre (non-regression sans modification). `.env.test.local` et `.env` sont remplis par l'humain.

## Dependances
- Tranches devant etre closes avant celle-ci : 001 (close), 010 (close, patron RLS), 011 (close, Next 16). Toutes closes.

## Commandes d'echafaudage prevues
`pnpm add` de `stripe` et `inngest` (dans `apps/web`) et de `@inngest/test` (devDependency racine) : modifient `apps/web/package.json`, `package.json`, `pnpm-lock.yaml`. `pnpm db:generate` pour `billing_event` : cree un fichier dans `packages/db/migrations/` et `meta/`. Verification apres coup par `git status --short`.

## Contrat de donnees
| Table | Colonnes ajoutees / modifiees | Contraintes et index |
|---|---|---|
| `billing_event` (nouvelle) | `id, organization_id, type, from_tier, to_tier, actor_user_id, stripe_event_id, occurred_at, recorded_at` (ERD §8.2, a l'identique) | `billing_event_shape` ; `billing_event_org_time_idx (organization_id, occurred_at DESC, id DESC)` ; `UNIQUE billing_event_stripe_idx (stripe_event_id) WHERE NOT NULL` ; `actor_user_id REFERENCES app_user(id) ON DELETE SET NULL` ; pas de FK sur `organization_id` ; `ENABLE`/`FORCE RLS` ; `REVOKE UPDATE, DELETE` a `signet_app` ; trigger `billing_event_immutable` (`signet.reject_mutation()`) |
| `subscription` | aucune colonne nouvelle (Q-2 : relecture Stripe, pas de garde de date) | inchangee ; nouvelle politique d'ecriture `TO signet_definer` sur `context_org()` (`UPDATE`), `GRANT UPDATE` a `signet_definer` |

Politiques `billing_event` : `signet_app` en `SELECT` seulement, texte de `subscription_owner_only` (owner via `member`) ; `signet_definer` en `INSERT` sur `organization_id = signet.context_org()`. Aucune politique `signet_definer` n'appelle `current_org()` (invariant ADR-0011, test de catalogue existant etendu a la nouvelle table). `signet_billing` n'a aucune politique et aucun droit de table : il n'agit que par la fonction.

Fonction `SECURITY DEFINER` (entree nouvelle de la liste fermee ERD §1, revue d'architecture = ADR-0016) : proprietaire `signet_definer`, `REVOKE ALL FROM PUBLIC`, `SET search_path = pg_catalog, signet, public, pg_temp`, noms qualifies, `EXECUTE` accorde au seul role `signet_billing`, jamais a `signet_app`, `signet_auth` ni `signet_owner`.

**Source de la valeur de confiance du traitement webhook** (exigence 1 de la consigne) : le traitement n'a pas d'utilisateur. L'organisation est derivee, dans cet ordre :
1. de la ligne `subscription` existante dont `stripe_subscription_id` est celui de l'evenement (index unique `subscription_stripe_sub_idx`) : valeur deja en base, ecrite par un traitement anterieur ;
2. a defaut (premier rattachement), de `metadata.organization_id` de l'abonnement **relu aupres de l'API Stripe** avec la cle secrete (pas du corps du webhook). Cette metadonnee a ete posee par notre serveur a la creation de la session Checkout, apres verification de la session better-auth et du role owner.

Le contexte (`set_config('app.organization_id', ...)`) est pose depuis cette valeur en premiere instruction ; tout parametre contradictoire (abonnement deja rattache a une autre organisation) leve. Ce que l'appelant ne peut pas choisir : le droit d'appeler la fonction, reserve a `signet_billing`, dont seule la fonction Inngest detient la connexion (AC16), et qui ne traite que des evenements dont la signature a ete verifiee. Le contexte ambiant (`app.organization_id`, `app.user_id` deja poses) est ignore.

## Contrat d'API
Source : `docs/02-architecture/api-contracts/subscriptions.ts`, amende par la tranche pour Q-3 seulement (`409 ALREADY_ON_TIER` sur `POST`), avec passage de `contract-guardian`.

| Route | Methode | Entree | Sorties | Role minimal | Idempotent sur |
|---|---|---|---|---|---|
| `/api/organizations/:organizationId/subscription` | GET | `organizationId` (UUID) | `{ organizationId, tier, status, cancelAtPeriodEnd, currentPeriodEnd }` | owner | lecture seule |
| `/api/organizations/:organizationId/subscription` | POST | `{ tier }` + `organizationId` | `{ action: "redirect_to_checkout", checkoutUrl }` (Free -> Pro) ou `{ action: "pending", organizationId }` (Pro -> Free) | owner | non idempotente (contrat) ; cle `Idempotency-Key` Stripe non exigee |
| `/api/webhooks/stripe` | POST | corps brut + en-tete `Stripe-Signature` | `{ received: true }` | public (signature) | `event.id` Stripe |
| `/api/inngest` | GET/POST/PUT | protocole Inngest, signe par `INNGEST_SIGNING_KEY` hors mode developpement | protocole Inngest | public (signature Inngest) | — |

Erreurs : `401 UNAUTHENTICATED`, `404 ORGANIZATION_NOT_FOUND`, `403 INSUFFICIENT_ROLE`, `409 ALREADY_ON_TIER` (palier deja actif, ou annulation deja programmee), `422 VALIDATION_FAILED` (corps invalide, `organizationId` non UUID, `tier` hors enum), `502 STRIPE_UNAVAILABLE` (POST) ; `400 INVALID_SIGNATURE` et `5xx` si la file d'attente est indisponible (webhook, AC14) ; `401` sur `/api/inngest` non signe hors mode developpement (AC15).

Evenements Stripe traites : `customer.subscription.created`, `.updated`, `.deleted` (D-060). Tout autre type signe est acquitte (200) et ignore, sans mise en file.

## Criteres d'acceptation

Convention de test : aucun appel reseau reel, aucune vraie cle (voir « Doublures de test »). Aucun test ne verifie le nouveau palier juste apres l'appel de l'owner : l'etat change seulement apres le traitement de l'evenement (ADR-0005).

- [ ] **AC1 — Consultation (US-08.1)** : l'owner d'une organisation neuve obtient `GET` -> `200 { tier: "free", status: "active", cancelAtPeriodEnd: false, currentPeriodEnd: null }`. Apres traitement d'un abonnement Pro actif, `GET` renvoie `tier: "pro"`, `status: "active"` et la fin de periode fournie par le faux Stripe.
- [ ] **AC2 — Free -> Pro (US-08.1, US-08.3)** :
  - (a) `POST { tier: "pro" }` par l'owner d'une organisation Free -> `200 { action: "redirect_to_checkout", checkoutUrl }` ; le faux Stripe a recu **une** creation de session Checkout `mode=subscription`, avec le prix `STRIPE_PRICE_ID_PRO`, `client_reference_id` egal a l'organisation, `subscription_data.metadata.organization_id` egal a l'organisation et `subscription_data.metadata.requested_by` egal a l'owner, les URL de retour derivees de `APP_URL`, et le `customer` deja enregistre s'il existe (D-062) ;
  - (b) **immediatement apres**, `GET` renvoie toujours `free` et `billing_event` est vide pour l'organisation (ADR-0005) ;
  - (c) un evenement signe `customer.subscription.created` (abonnement actif au prix Pro) est poste au webhook -> `200 { received: true }`, puis la fonction Inngest est executee : `subscription` passe a `tier='pro'`, `status='active'`, `stripe_customer_id`, `stripe_subscription_id`, `current_period_end` renseignes ; `organization_link_usage.link_quota` devient `NULL` ; **un** `billing_event` `subscription_started` (`from_tier NULL`, `to_tier 'pro'`, `stripe_event_id` = id de l'evenement, `occurred_at` = `created` de l'evenement, `actor_user_id` = owner demandeur lu dans `metadata.requested_by`).
- [ ] **AC3 — Pro -> Free, annulation en fin de periode (US-08.1, US-08.3)** :
  - (a) `POST { tier: "free" }` par l'owner d'une organisation Pro -> `200 { action: "pending", organizationId }` ; le faux Stripe a recu une modification de l'abonnement avec `cancel_at_period_end=true` **et** `metadata.requested_by` = cet owner (A4), pas de suppression immediate ; juste apres, `GET` renvoie toujours `pro` ;
  - (b) evenement `customer.subscription.updated` (annulation programmee) traite : `tier='pro'`, `cancelAtPeriodEnd: true`, **aucun** `billing_event` (Q-5) ;
  - (c) evenement `customer.subscription.deleted` traite : `tier='free'`, `status='active'`, `stripe_subscription_id`, `current_period_end` a `NULL`, `cancel_at_period_end=false`, `stripe_customer_id` **conserve** (D-062), `link_quota = 50` ; un `billing_event` `subscription_canceled` (`from_tier 'pro'`, `to_tier NULL`, `actor_user_id` = owner qui a demande l'annulation, lu dans `metadata.requested_by` de l'abonnement relu) ;
  - (d) retrogradation au-dessus du quota : une organisation dont `link_count` est force a 75 (fixture sous connexion d'administration) passe en Free sans erreur, `link_count` inchange (ERD §8.1) ;
  - (e) **auteur disparu (A4)** : si l'utilisateur de `metadata.requested_by` n'existe plus (ou n'est pas un UUID), le `subscription_canceled` est ecrit avec `actor_user_id = NULL`, sans erreur ; une resiliation par Stripe seul (impaye, sans `requested_by`) porte aussi `NULL`.
- [ ] **AC4 — Permission insuffisante (US-08.2)** : un member (non owner) recoit `403 INSUFFICIENT_ROLE` sur `GET` et sur `POST`, aucun appel au faux Stripe, rien ne change en base. En base, sous `signet_app` avec le contexte de ce member, `subscription` et `billing_event` de son organisation renvoient 0 ligne.
- [ ] **AC5 — Isolation tenant (US-09)** :
  - (a) par l'API : l'owner de A qui appelle `GET` et `POST` sur l'organisation B recoit `404 ORGANIZATION_NOT_FOUND`, reponse identique a un UUID inexistant ; aucun appel au faux Stripe ; rien ne change en base ;
  - (b) en base, sous `signet_app` avec `app.organization_id` = B et `app.user_id` = owner de A : 0 ligne de `subscription` et de `billing_event` de B, toute ecriture refusee ;
  - (c) par le webhook : un evenement pour l'abonnement Stripe de A ne modifie jamais la ligne de B, meme si sa `metadata.organization_id` designe B (voir AC6 c).
- [ ] **AC6 — Fonctions definer sous contexte etranger force (D-033, audit-010 MINEUR-2)** :
  - (a) ADR-0011 recoit la regle : « toute fonction `SECURITY DEFINER` executable par `signet_app` pose son contexte depuis une valeur de confiance ou filtre sur `current_user_id()` en premiere instruction », etendue a tout role applicatif qui peut l'executer, avec le tableau « source du contexte » complete pour chaque fonction de la tranche ;
  - (b) `signet_app` ne peut pas executer la fonction d'application d'etat Stripe (`42501`), et aucun `GRANT` ne la rend executable par `PUBLIC`, `signet_app`, `signet_auth` ou `signet_owner` (test de catalogue) ; `signet_billing` n'a aucun privilege de table ni d'autre `EXECUTE` que cette fonction (et les primitives qu'elle exige, le cas echeant, justifiees dans ADR-0016) ;
  - (c) sous `signet_billing`, avec un contexte etranger pose avant l'appel (`app.organization_id` = B, `app.user_id` = owner de B) : appliquer l'etat d'un abonnement rattache a A modifie A seulement ; B est inchangee ; un abonnement deja rattache a A presente avec une `metadata.organization_id` = B leve, sans aucune ecriture ;
  - (d) un test par fonction definer **nouvelle ou modifiee** par la tranche, sur le modele d'AC2 de 010 ; les invariants de catalogue de 010 (proprietaire `signet_definer` de toute fonction `prosecdef`, `current_org(` absent des politiques `signet_definer`, `context_org(` absent des politiques `signet_app`) restent verts et couvrent `billing_event` ;
  - (e) role `signet_billing` : attributs `NO*` et `LOGIN` verifies en catalogue, aucune appartenance dans un sens ni dans l'autre (`pg_auth_members.member` et `.roleid`), aucun reglage dans `pg_db_role_setting` pour les cinq roles `signet_*` (INFO-1, D-064).
- [ ] **AC7 — Signature du webhook** : signature absente, mal formee, calculee avec un autre secret, ou horodatage hors tolerance (plus de 300 s) -> `400 INVALID_SIGNATURE`, **avant tout traitement** : aucun evenement envoye au faux Inngest, aucune ecriture. Le corps n'est jamais parse avant verification. La reponse ne contient ni le secret, ni la signature attendue, ni le corps.
- [ ] **AC8 — Idempotence** :
  - (a) meme evenement poste deux fois au webhook -> deux `200` ; un seul evenement transmis a Inngest **ou** deux transmissions portant le meme identifiant de deduplication (`id` = `event.id` Stripe) ;
  - (b) la fonction Inngest executee deux fois **en sequence** pour le meme evenement -> un seul `billing_event`, etat final identique a une execution unique ;
  - (c) la meme fonction executee deux fois **en parallele** pour le meme evenement -> un seul `billing_event`, aucune erreur remontee (la violation d'unicite ou le verrou de ligne est absorbe) ;
  - (d) deux evenements **distincts** decrivant la meme transition (`created` puis `updated` du meme abonnement actif) -> un seul `subscription_started` ;
  - (e) rejeu d'un pas (`step`) apres un echec simule de l'ecriture : la fonction est rejouable sans doubler l'effet et sans rappeler Stripe pour le pas deja reussi (D-061 ; preuve par `@inngest/test`).
- [ ] **AC9 — Cas limites du traitement** :
  - (a) evenement pour un abonnement inconnu dont la `metadata.organization_id` est absente, mal formee ou designe une organisation inexistante -> traite sans effet, sans `billing_event`, sans nouvelle tentative (erreur non rejouable), journal serveur sans secret ni corps complet ;
  - (b) client Stripe different de celui deja enregistre pour l'organisation -> aucune ecriture, journalise (Q-7) ;
  - (c) evenements **dans le desordre** (`deleted` traite avant `updated`, ou `updated` avant `created`) -> l'etat final est celui que le faux Stripe renvoie a la relecture (Q-2), jamais un etat perime ; un `updated` traite apres la suppression ne refait pas passer l'organisation en Pro ;
  - (d) `past_due` : un abonnement Pro passe `past_due` -> `tier='pro'`, `status='past_due'`, aucun `billing_event` ; le quota reste illimite ;
  - (e) correspondance des statuts (Q-8), un test par ligne : `active`/`trialing` -> `status='active'` ; `past_due`/`unpaid`/`paused` -> `status='past_due'`, `tier='pro'` ; `incomplete` -> palier inchange, `status='incomplete'` ; `incomplete_expired`/`canceled` et `deleted` -> Free ;
  - (f) second abonnement Stripe actif pour une organisation deja Pro (double clic sur Checkout) -> aucune ecriture, journalise, l'abonnement en place reste rattache (Q-7) ;
  - (g) Pro sans `stripe_subscription_id` impossible : un `UPDATE subscription SET tier='pro', stripe_subscription_id=NULL` sous la connexion d'administration echoue sur `subscription_pro_is_backed_chk` (`23514`) ; la fonction d'application leve plutot que d'ecrire un tel etat.
- [ ] **AC10 — Stripe indisponible** : le faux Stripe repond `500` ou ne repond pas dans le delai -> `POST` renvoie `502 STRIPE_UNAVAILABLE`, aucun etat local modifie, aucun `billing_event`, aucune cle ni detail Stripe dans la reponse.
- [ ] **AC11 — Validation et authentification** : `organizationId` non UUID, `tier` absent ou hors `free|pro`, corps non JSON -> `422 VALIDATION_FAILED` ; sans session -> `401 UNAUTHENTICATED` sur `GET` et `POST`.
- [ ] **AC12 — Append-only** : `UPDATE` et `DELETE` sur `billing_event` refuses sous `signet_app` (privilege) et sous la connexion proprietaire (trigger) ; la suppression d'une organisation laisse ses `billing_event` en place (aucune FK).
- [ ] **AC13 — Dependances et environnement** : `stripe`, `inngest` et `@inngest/test` epingles a la derniere version stable du registre, hors quarantaine pnpm (aucune exclusion `minimumReleaseAgeExclude`), ADR-0015, `pnpm audit --prod --audit-level=high` propre ; chaque variable d'environnement lue est validee par un schema au demarrage (absente ou mal formee -> le serveur refuse de demarrer, sans afficher sa valeur) ; `STRIPE_API_BASE_URL` n'est acceptee qu'avec `APP_ENV=test` (meme garde que `AUTH_RATE_LIMIT`, ADR-0010).
- [ ] **AC14 — Webhook et file (A1)** : si la transmission de l'evenement a Inngest echoue (faux Inngest qui repond `500` ou ne repond pas), la route webhook repond `5xx`, jamais `200`, pour que Stripe renvoie l'evenement ; aucune ecriture en base ; la reponse ne contient aucun detail interne.
- [ ] **AC15 — Point de service Inngest (A2)** : le mode developpement d'Inngest n'est accepte qu'avec `APP_ENV=test` ou `APP_ENV=development` ; avec toute autre valeur (production), le schema d'environnement refuse le mode developpement et exige `INNGEST_SIGNING_KEY` (absente -> refus de demarrer, sans afficher de valeur ; teste sur le schema). Hors mode developpement, un appel non signe ou mal signe a `/api/inngest` recoit `401` et n'execute rien.
- [ ] **AC16 — Isolement de la connexion `signet_billing` (A3)** : la connexion `DATABASE_URL_BILLING` vit dans un module dedie (`apps/web/src/lib/inngest/billing-db.ts`, hors de `db.ts`), importable par le seul module de la fonction Inngest. Preuve mecanique (D-058) : regle `no-restricted-imports` dans `eslint.config.mjs` qui refuse cet import partout ailleurs, et test qui lint un fichier de route fictif l'important et attend l'erreur, et lint le module de la fonction et n'en attend aucune. `pnpm run check` vert.
- [ ] **AC17 — 409 (Q-3, A5)** : `POST { tier: "free" }` sur une organisation Free, `POST { tier: "pro" }` sur une organisation Pro (annulation programmee ou non), et `POST { tier: "free" }` sur un Pro dont `cancelAtPeriodEnd = true` -> `409 ALREADY_ON_TIER`, aucun appel au faux Stripe, rien ne change en base.
- [ ] **AC18 — Runbook (Q-9, A6, Q-1)** : `docs/04-runbooks/stripe-facturation-locale.md` documente : le reglage du compte Stripe « annuler l'abonnement » apres l'echec de toutes les tentatives de paiement (pour qu'un `unpaid` ne reste pas Pro indefiniment) ; les trois valeurs Stripe du mode test et le lancement facultatif d'Inngest en local ; la procedure par laquelle l'humain fixe le mot de passe de `signet_billing` (commande a lancer lui-meme, jamais vue ni ecrite par un agent). Verifie par `code-reviewer`, pas par un test.

## Doublures de test
Aucun appel reseau reel, aucune vraie cle, en local comme en CI (D-059).

- **Webhook** : les tests signent eux-memes les evenements avec `node:crypto` (HMAC-SHA256 de `t.corps`, en-tete `t=...,v1=...`, schema documente de Stripe), avec un secret de test invente partage par le serveur de test et la suite (`TEST_SERVER_ENV_STRIPE_WEBHOOK_SECRET` / `TEST_STRIPE_WEBHOOK_SECRET`, meme valeur). Ecarte : `stripe.webhooks.generateTestHeaderString` du SDK, qui ferait verifier le SDK par lui-meme (une erreur de configuration commune aux deux cotes passerait).
- **Appels sortants vers Stripe** : un **faux Stripe ecrit dans le depot** (`tests/billing/fakes/fake-stripe.ts`, serveur `node:http` demarre par les fichiers de test sur un port fixe ; `fileParallelism: false` rend le port fixe sur), auquel le serveur Next de test est raccorde par `STRIPE_API_BASE_URL` (option `host`/`port`/`protocol` du SDK). Il enregistre les requetes recues (assertions sur les parametres) et rend des reponses programmees par chaque test, y compris `500` et un delai pour AC10. Pourquoi : le serveur teste est un processus separe (globalSetup), donc une interception en memoire (msw, nock) ne le voit pas ; `stripe-mock` (binaire Go officiel ou image Docker) rend des reponses statiques non pilotables par test, n'est pas disponible dans le poste Windows (risque Smart App Control, D-056) et ajouterait un service a la CI. Aucune dependance nouvelle.
- **Inngest** : deux moities, chacune testee sans service externe.
  - Envoi : le serveur de test, en mode developpement d'Inngest (accepte seulement avec `APP_ENV=test` ou `development`, AC15), envoie ses evenements a un **faux point d'entree d'evenements** (`tests/billing/fakes/fake-inngest.ts`), qui les enregistre ou repond en echec sur demande (AC14). AC7 et AC8 (a) s'y verifient.
  - Execution : la fonction Inngest est executee **dans le processus de test** par `@inngest/test` (`InngestTestEngine`, paquet officiel), contre la base de test reelle et le faux Stripe, avec l'evenement capture. Le rejeu (AC8 b, e) s'y prouve en executant deux fois et en simulant l'echec d'un pas. Ecarte : le serveur de developpement Inngest (`inngest-cli`, binaire telecharge a l'execution : reseau, Smart App Control, service de plus en CI) ; execution synchrone dans la route quand `APP_ENV=test` (testerait un chemin qui n'existe pas en production).
  - AC15 (`401` hors mode developpement) : teste sur le gestionnaire du point de service instancie dans le processus de test avec une cle de signature inventee, le serveur de test tournant, lui, en mode developpement.

## Dependances nouvelles (indicatif, a revalider au moment de `pnpm add`)
| Paquet | Usage | Version du registre au 2026-10-08 | Publiee | Licence |
|---|---|---|---|---|
| `stripe` | appels sortants, verification de signature | 23.0.0 | 2026-10-01 | MIT |
| `inngest` | file d'attente (`stack.json`, ADR-0006) | 4.22.0 | 2026-10-06 | Apache-2.0 |
| `@inngest/test` (dev) | execution de la fonction en test | 1.0.0 | 2026-03-25 | Apache-2.0 |

Point de vigilance pour ADR-0015 : `inngest` 4.22.0 tire `zod` 3 (le projet est en `zod` 4, deux copies coexisteront) et un jeu de paquets OpenTelemetry ; `pnpm audit --prod` est a passer avant de conclure.

## Variables d'environnement (noms seulement)
| Nom | Lu par | Test (CI et `.env.test.local`) | Developpement (`.env`) — rempli par l'humain |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | serveur, fonction Inngest | valeur inventee (`sk_test_` + texte quelconque) : seul le faux Stripe la recoit | cle secrete du compte Stripe **en mode test** |
| `STRIPE_WEBHOOK_SECRET` | route webhook | valeur inventee (`whsec_` + texte), identique a `TEST_STRIPE_WEBHOOK_SECRET` | secret donne par `stripe listen` ou par le point de terminaison du tableau de bord (mode test) |
| `STRIPE_PRICE_ID_PRO` | route POST, fonction Inngest | valeur inventee (`price_` + texte) | identifiant du prix Pro cree dans Stripe (mode test) |
| `STRIPE_API_BASE_URL` | client Stripe | URL du faux Stripe ; **refusee hors `APP_ENV=test`** | absente |
| `APP_URL` | URL de retour Checkout | `http://localhost:3100` | `http://localhost:3100` |
| `INNGEST_DEV` (ou equivalent du SDK) | client et point de service Inngest | URL du faux Inngest ; **acceptee seulement avec `APP_ENV=test` ou `development`** | facultative (runbook, Q-9) |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | client et point de service Inngest | absentes (mode developpement) | absentes en local ; **`INNGEST_SIGNING_KEY` obligatoire hors mode developpement** (AC15) |
| `DATABASE_URL_BILLING` | fonction Inngest seule (AC16) | URL du role `signet_billing`, sans mot de passe en CI (`PGPASSWORD`) ; `TEST_ROLE_PASSWORDS` complete | URL locale ; mot de passe fixe par l'humain (runbook) |
| `TEST_STRIPE_WEBHOOK_SECRET`, `TEST_DATABASE_URL_BILLING` | suite de tests | memes valeurs que celles du serveur | — |

En CI, toutes ces valeurs sont inventees et ecrites en clair dans le workflow (comme `BETTER_AUTH_SECRET` aujourd'hui) : la CI n'a et n'aura aucun secret Stripe. L'humain doit ajouter a `.env.test.local` les memes noms avec des valeurs inventees (liste fournie dans `.env.test.example`), fixer le mot de passe de `signet_billing` (runbook), et ajouter a `.env` les trois valeurs Stripe du mode test seulement s'il veut essayer le parcours reel a la main (non requis par la tranche).

## Anti-regression
- Suites 001, 010, 011 vertes **sans modifier leurs assertions** ; `tests/_factory/db-catalog.test.ts` vert (nouvelle table sous RLS forcee, nouvelle fonction definer, nouveau role) ; `tests/stack-upgrade/lint-scope.test.ts` vert malgre la regle d'import ajoutee.
- `create_organization` reste le seul chemin d'`INSERT` dans `subscription` ; la nouvelle fonction ne fait que `UPDATE` de `subscription` et `INSERT` dans `billing_event`.
- `propagate_subscription_quota` inchangee ; `quota_for_tier` reste l'unique endroit ou 50 existe.
- review-010 SUGGESTION-1 : si la tranche change la creation de `subscription`, ajouter la precondition d'existence aux tests AC3 de 010 (non prevu).
- `contract-guardian` : `subscriptions.ts` modifie uniquement par l'ajout de `409 ALREADY_ON_TIER` (Q-3, D-057).

## Notes d'implementation
- Migrations nouvelles uniquement (0001 a 0010 immuables) : role `signet_billing` dans une migration de roles separee (precedent ADR-0011 h), avec l'extension INFO-1 (D-064) ; table `billing_event` par `pnpm db:generate`, puis politiques, trigger, fonction et grants dans une migration SQL ecrite a la main.
- Le corps brut du webhook est lu une seule fois (`request.text()`) et verifie avant tout `JSON.parse`. La route webhook ne lit pas la base.
- La relecture Stripe (`subscriptions.retrieve`) et l'ecriture en base sont deux pas Inngest distincts (D-061) : un echec de la base rejoue l'ecriture sans rappeler Stripe.
- `metadata.requested_by` est une valeur d'audit, jamais une source d'autorisation ; elle est validee (UUID) avant usage, et une valeur invalide donne `actor_user_id = NULL` (AC3 e).
- Erreurs metier typees (pas de `throw`) : `StripeUnavailable`, `InsufficientRole`, `OrganizationNotFound`, `AlreadyOnTier`, evenement sans effet.

## Decisions du gate d'ouverture
Humain, D-057 (`002-decisions-humaines.md`) : Q-1 a Q-9 selon l'option recommandee du brouillon ; complements A1 a A6 integres (AC14, AC15, AC16, AC3 e et AC2 a, AC17, AC18). Options ecartees (D-057 y renvoie) :
- Q-1 : faire executer la fonction par `signet_app` (toute route, par erreur de variable, pourrait changer le palier de n'importe quelle organisation : ce que D-033 interdit) ; par `signet_owner` (proprietaire des tables, peut desactiver la RLS).
- Q-2 : appliquer l'instantane du corps de l'evenement avec une garde de date (`event.created` a la seconde : deux evenements de la meme seconde ne s'ordonnent pas ; colonne nouvelle).
- Q-3 : `200 { action: "pending" }` sans appel Stripe (pas de changement de contrat, mais reponse trompeuse).
- Q-4 : annuler l'annulation programmee (`cancel_at_period_end=false`).
- Q-5 : evenement facturable sur l'annulation programmee ou sur `past_due` (rien n'a encore change de palier).
- Q-6 : page minimale non stylee (exige d'abord une page de connexion, hors perimetre).
- Q-7 : rattacher l'abonnement le plus recent (perd la trace du premier, double facturation silencieuse).
- Q-8 : `unpaid` -> Free (Stripe n'a pas encore resilie ; A6 regle Stripe pour qu'il le fasse).
- Q-9 : imposer le serveur de developpement Inngest en local.

Claude Code (registre) :
- **D-058** — preuve d'AC16 par regle de lint `no-restricted-imports` + test de la regle, connexion dans un module dedie ;
- **D-059** — doublures de test (signature `node:crypto`, faux Stripe HTTP dans le depot, faux point d'evenements Inngest + `@inngest/test`) ;
- **D-060** — seuls les trois evenements `customer.subscription.*` sont mis en file ;
- **D-061** — relecture Stripe et ecriture en base en deux pas Inngest ;
- **D-062** — `stripe_customer_id` conserve apres annulation et reutilise au Checkout suivant ;
- **D-063** — numeros reserves : ADR-0015 (dependances, doublures), ADR-0016 (traitement du webhook, role `signet_billing`, fonction definer) ;
- **D-064** — migration de roles separee, qui inclut audit-010 INFO-1.
