# ADR-0006 — Traitement asynchrone via Inngest : webhooks Stripe et e-mails d'invitation

- **Statut** : accepte
- **Date** : 2026-09-22
- **Phase** : 2 — architecture

## Contexte

`stack.json` fixe Inngest comme file d'attente, gelee en phase 1. Cet ADR precise ses deux seuls usages justifies par le PRD, pour eviter qu'une file d'attente deja disponible ne serve de solution par defaut a des problemes qui n'en ont pas besoin (le PRD nomme explicitement la derive de perimetre comme risque #1).

Deux points du PRD impliquent un traitement differe du chemin de requete HTTP synchrone :
1. Le webhook Stripe (ADR-0005) doit etre traite de maniere fiable et idempotente, avec retry en cas d'echec transitoire (base indisponible un instant, erreur reseau) — un webhook Stripe non acquitte est represente par Stripe lui-meme (retries automatiques cote Stripe), mais le traitement interne (ecriture de l'etat + du journal) doit pouvoir etre rejoue sans dupliquer l'effet.
2. L'envoi de l'e-mail d'invitation (US-02.3) est un appel a un service tiers (fournisseur d'e-mail) : le faire de maniere synchrone dans la route d'invitation coupleraient la disponibilite de cette route a celle du fournisseur d'e-mail, et un echec d'envoi ne devrait pas faire echouer la creation de l'invitation elle-meme (l'invitation existe et est valide meme si l'e-mail met du temps a arriver ou doit etre retente).

## Options envisagees

### Option A — Tout synchrone dans la route
Le webhook Stripe et l'envoi d'e-mail s'executent dans le handler HTTP qui les declenche. Le plus simple, mais fait dependre la reponse HTTP (et pour le webhook, l'acquittement attendu par Stripe sous quelques secondes) de la latence d'un service tiers, et ne fournit aucun retry structure en cas d'echec transitoire.

### Option B — Inngest pour les deux traitements
Le handler webhook Stripe verifie la signature puis delegue le traitement (idempotent, cle = identifiant d'evenement Stripe) a une fonction Inngest, et repond immediatement. La creation d'invitation ecrit la ligne en base de maniere synchrone (c'est la donnee qui fait foi), puis declenche une fonction Inngest pour l'envoi de l'e-mail, avec retry automatique en cas d'echec du fournisseur.

## Decision

Option B, strictement limitee a ces deux usages. Aucune autre action du PRD ne justifie un traitement asynchrone (creation de collection, ajout de lien, consultation, retrait de membre sont des operations locales a la base, synchrones par nature). Toute nouvelle proposition d'usage d'Inngest en dehors de ces deux cas doit etre justifiee par un signal explicite du PRD, pas par la disponibilite de l'outil.

## Consequences acceptees

- La route qui recoit le webhook Stripe doit repondre a Stripe apres avoir seulement verifie la signature et enfile le traitement — pas apres avoir fini d'ecrire l'etat local. L'ecriture reelle (et donc la visibilite du nouveau palier pour l'owner) est retardee du temps de traitement de la fonction Inngest, generalement de l'ordre de la seconde.
- La creation d'une invitation (ligne en base, token) et l'envoi de l'e-mail sont deux operations decouplees : un test d'acceptation sur US-02 doit distinguer "l'invitation existe et est valide" de "l'e-mail a ete envoye" — la seconde peut echouer et etre retentee sans invalider la premiere.
- Toute fonction Inngest qui ecrit en base doit poser son propre contexte tenant (`SET LOCAL`, ADR-0001) : elle ne herite d'aucune session HTTP, le piege "c'est un job donc pas de filtre tenant" (regle absolue de `CLAUDE.md`) s'applique ici en particulier.
- Le contrat d'idempotence du traitement webhook (cle = identifiant d'evenement Stripe) doit etre documente dans le contrat d'API correspondant pour que `contract-guardian` puisse verifier qu'aucune tranche future ne le retire silencieusement.

## Signal de reexamen

Une troisieme operation du PRD s'avere avoir besoin d'un traitement differe (peu probable vu le perimetre du MVP) ; ou la latence introduite par le passage en file pour le webhook devient visible negativement dans l'UX de changement de palier.
