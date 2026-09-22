# ADR-0005 — Facturation par palier pilotee par Stripe, journal d'evenements local

- **Statut** : accepte
- **Date** : 2026-09-22
- **Phase** : 2 — architecture

## Contexte

Le PRD exige un abonnement par palier (Free/Pro) facture a l'organisation, gere par l'owner, avec trois evenements facturables (souscription initiale, changement de palier, annulation), chacun horodate et rattache a l'organisation "pour servir de source de verite auditable" (US-08). `stack.json` fixe Stripe comme systeme de facturation, deja gele en phase 1 — cet ADR ne rouvre pas ce choix, il precise comment l'etat local et Stripe restent coherents, et qui fait autorite sur quoi.

Le risque specifique : deux sources d'etat (la base locale, Stripe) qui peuvent diverger si l'ecriture locale se fait de maniere optimiste au moment de l'appel API plutot qu'en reaction a la confirmation de Stripe.

## Options envisagees

### Option A — Ecriture locale optimiste au moment de l'appel API
L'application change le palier en base des que l'appel de creation/modification d'abonnement Stripe reussit (reponse synchrone). Simple, mais un paiement peut echouer apres coup (carte refusee en fin de cycle, dispute), et Stripe est alors la seule source qui le sait — la base locale reste sur un etat perime jusqu'a une resynchronisation qui n'a aucun declencheur.

### Option B — Etat local pilote exclusivement par les webhooks Stripe
L'appel initial de l'owner (changer de palier) declenche l'action cote Stripe (creation/modification de la subscription), mais l'ecriture de l'etat local et du journal d'evenements ne se fait qu'en reaction au webhook Stripe correspondant (`customer.subscription.created` / `.updated` / `.deleted`), traite de maniere idempotente (cle : l'identifiant d'evenement Stripe). Stripe est la source de verite sur l'etat de l'abonnement ; la base locale est une projection.

## Decision

Option B. Le critere qui tranche : le PRD demande une source de verite "auditable" — un evenement local ecrit avant confirmation du paiement ne serait pas audit-fiable, puisqu'il pourrait ne jamais se realiser cote Stripe. Seul le webhook confirme un fait accompli.

Consequence directe sur l'UX : une demande de changement de palier par l'owner n'est pas synchrone du point de vue de l'etat local — l'API repond "demande transmise", l'etat visible (palier courant) ne change qu'apres traitement du webhook. Le contrat d'API pour US-08 doit refleter cette asynchronie plutot que supposer un changement immediat.

## Consequences acceptees

- Toute route de changement de palier ne modifie jamais directement la colonne "palier courant" de l'organisation : elle appelle Stripe et attend le webhook pour ecrire l'etat et l'evenement du journal. Un test qui changerait de palier et verifierait l'etat immediatement apres l'appel API, sans passer par le webhook, teste le mauvais contrat.
- Le traitement du webhook doit etre idempotent : Stripe peut renvoyer le meme evenement plusieurs fois. La cle d'idempotence est l'identifiant d'evenement Stripe, pas le contenu de l'evenement.
- Le journal d'evenements factures est ecrit uniquement depuis le traitement webhook, jamais depuis la route appelee par l'owner — sinon deux chemins d'ecriture divergent silencieusement.
- Le secret de signature webhook Stripe est un secret comme un autre : jamais logge, jamais en dur (regle absolue de `CLAUDE.md`), verifie avant tout traitement du payload.
- Le webhook Stripe est un traitement asynchrone par nature : voir ADR-0006 pour son execution via la file d'attente.

## Signal de reexamen

Le produit a besoin d'un retour synchrone immediat apres un changement de palier (ex. deblocage immediat d'une fonctionnalite Pro sans attendre le webhook) — impliquerait un etat "en attente de confirmation" explicite plutot qu'une simple asynchronie invisible.
