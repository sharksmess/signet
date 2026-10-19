# Tranche 002 — decisions humaines du gate d'ouverture (2026-10-08)

Decision D-057 de `docs/DECISIONS.md`. Le contrat `002-abonnement-palier.md` (brouillon) a ete relu par l'orchestrateur (cowork) ; l'humain a repondu « accepter tout » : les neuf recommandations du contrat et les six complements ci-dessous.

## Questions ouvertes : option recommandee retenue
- **Q-1** : nouveau role `signet_billing` (`LOGIN`, memes `NO*` que les autres roles, aucun droit de table, `EXECUTE` sur la seule fonction d'application d'etat Stripe), via `DATABASE_URL_BILLING`. Amende ADR-0007 ; ERD §8.1 reecrit. Son mot de passe est fixe par l'humain, comme pour les autres roles : fournir la procedure, ne jamais le voir ni l'ecrire.
- **Q-2** : relecture de l'abonnement aupres de Stripe a chaque evenement ; l'evenement ne sert que de declencheur et de cle d'idempotence.
- **Q-3** : `409 ALREADY_ON_TIER` pour une demande du palier deja actif ; ajout au contrat `subscriptions.ts`.
- **Q-4** : reactivation d'une annulation programmee hors tranche.
- **Q-5** : `subscription_started` et `subscription_canceled` seulement ; ni l'annulation programmee ni `past_due` ne creent d'evenement ; `actor_user_id` = owner demandeur (`metadata.requested_by`) ou `NULL` quand Stripe agit seul.
- **Q-6** : aucune page dans cette tranche.
- **Q-7** : second abonnement actif ou client Stripe different : aucune ecriture, journalisation, reglage humain dans Stripe.
- **Q-8** : `active`/`trialing` -> `active` ; `past_due`/`unpaid`/`paused` -> `past_due` (reste Pro) ; `incomplete` -> palier inchange, `status='incomplete'` ; `incomplete_expired`/`canceled` (et `deleted`) -> Free.
- **Q-9** : Inngest en developpement local : rien d'impose, procedure dans un runbook.

## Complements (a integrer au contrat comme criteres d'acceptation testes)
- **A1 — Webhook et file** : si la transmission de l'evenement a Inngest echoue, la route webhook repond `5xx` (jamais `200`), pour que Stripe renvoie l'evenement ; aucune ecriture. Test avec le faux Inngest en echec.
- **A2 — Point de service Inngest** : le mode developpement d'Inngest n'est accepte qu'avec `APP_ENV=test` ou `development`, jamais en production ; en production, `INNGEST_SIGNING_KEY` absente -> le serveur refuse de demarrer (sans afficher de valeur) ; un appel non signe a `/api/inngest` hors mode developpement est refuse (`401`). Tests.
- **A3 — Isolement de la connexion `signet_billing`** : la fonction Inngest tourne dans le meme processus que les routes ; la connexion `DATABASE_URL_BILLING` n'est importable que par le module de la fonction Inngest. Preuve mecanique : regle de lint (`no-restricted-imports` ou equivalent) ou test qui echoue si une route ou un autre module l'importe.
- **A4 — Auteur de l'annulation** : la demande d'annulation de l'owner pose aussi `metadata.requested_by` sur l'abonnement Stripe ; le `subscription_canceled` de fin de periode porte cet owner. Si l'utilisateur n'existe plus, `actor_user_id = NULL`, sans erreur (FK `ON DELETE SET NULL`). Test.
- **A5 — 409 et annulation deja programmee** : Pro avec `cancelAtPeriodEnd = true` et demande `free` -> `409 ALREADY_ON_TIER`, aucun appel au faux Stripe. Test.
- **A6 — Reglage Stripe** : le runbook `docs/04-runbooks/stripe-*` indique de regler le compte Stripe sur « annuler l'abonnement » apres l'echec de toutes les tentatives de paiement, pour qu'un abonnement `unpaid` ne reste pas Pro indefiniment.

## Suite
Mettre a jour le contrat (statut, reponses, A1 a A6 en criteres) et, **avant activation**, le perimetre `.gates/scope-002.txt` si A1 a A6 l'exigent (par exemple `eslint.config.mjs` si A3 passe par une regle de lint), inscrire au registre les decisions locales de Claude Code (D-058 et suivantes), puis etape 5 de `/slice` (activation), un seul commit d'ouverture avec cette fiche, la consigne et la ligne 13 du journal, puis `test-writer`.
