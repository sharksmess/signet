# Backlog des tranches — Signet

Ordre de dependance technique d'abord, risque decroissant en departage a profondeur egale (la tranche la plus risquee en premier, tant qu'il reste du temps pour se tromper). Chaque tranche couvre une capacite utilisateur complete du PRD (base + API + UI) ; l'isolation tenant (US-09) n'est pas une tranche a part — c'est le critere d'acceptation AC5, obligatoire dans chaque tranche ci-dessous qui touche une donnee d'organisation.

| # | Tranche | User story(ies) | Depend de | Pourquoi cet ordre |
|---|---|---|---|---|
| 001 | Creation d'organisation et compte owner | US-01 | aucune | Fondation : toute autre tranche suppose une organisation et un utilisateur authentifie. |
| 002 | Abonnement et changement de palier | US-08 | 001 | Depend seulement de l'organisation. Placee tot malgre son risque (integration Stripe, argent, source de verite auditable — ADR-0005) car la tranche 005 (quota) a besoin de connaitre le palier courant de l'organisation pour decider d'un refus a 50 liens : c'est une dependance technique reelle, pas seulement un choix de risque. |
| 003 | Invitation d'un membre | US-02 | 001 | Depend seulement de l'organisation et du role owner. Risque moderat (securite du token d'invitation, fiabilite de l'envoi d'e-mail — ADR-0006), inferieur a celui de la facturation. |
| 004 | Creation d'une collection | US-05 | 001 | Depend seulement de l'organisation. CRUD simple, risque le plus bas de sa couche de dependance : placee en dernier parmi les tranches ne dependant que de 001. |
| 005 | Ajout d'un lien avec quota Free | US-06 | 002, 004 | Depend d'une collection existante (004) et du palier courant (002). **Risque le plus eleve du backlog** : le PRD nomme explicitement (risque #3) la verification de quota non atomique comme le piege le plus probable de cette tranche — a traiter avec le plus de marge possible. |
| 006 | Acceptation d'une invitation | US-03 | 003 | Depend d'une invitation existante (003). Risque securite (validation de token, expiration, rejeu) reel mais suit un patron plus standard que la tranche 005. |
| 007 | Suppression d'une collection (cascade) | US-10 | 004, 005 | Depend d'une collection et de liens a supprimer en cascade dans la meme operation, pour verifier reellement la cascade. Operation irreversible (pas de soft delete) : risque de perte de donnee si la cascade est mal bornee. |
| 008 | Retrait d'un membre | US-04 | 006 | Depend d'un membre reel obtenu par acceptation d'invitation (006), pour tester le retrait sur un membre effectif plutot que sur une donnee de fixture. Contient l'invariant "dernier owner protege" (US-04.3). |
| 009 | Consultation des collections et des liens | US-07 | 004, 005 | Depend de collections et de liens existants pour verifier le tri et l'isolation en lecture sur des donnees reelles. Risque le plus bas du backlog : lecture seule, patron d'isolation deja eprouve par les tranches precedentes. |

## Notes

- Aucune tranche ne couvre l'edition de lien/collection ni la suppression d'un lien isole : hors-perimetre explicite du PRD (US-10 ne couvre que la suppression d'une collection entiere).
- Toute tranche qui ferait apparaitre une fonctionnalite listee en hors-perimetre (recherche, tags, import Slack, etc.) est un signal du risque #1 du PRD (derive de perimetre) et doit etre refusee ou renvoyee en backlog explicite, pas glissee dans une tranche existante.
- Le detail complet de chaque tranche (perimetre fichiers, contrat de donnees, contrat d'API, criteres d'acceptation AC1-AC5, anti-regression) est ecrit au moment de son ouverture, au format `templates/SLICE.md`, dans `docs/03-slices/<id>-<nom>.md`.
