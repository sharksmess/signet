---
name: signet-questions-ouvertes
description: Onze questions metier non tranchees a la sortie de la phase 2 Signet, et celles qui bloquent une tranche precise
metadata:
  type: project
---

A la livraison de l'ERD (2026-09-22), onze questions metier restent sans reponse produit. La liste
complete est en §10 de `docs/02-architecture/ERD.md` ; verifier la si elle a ete mise a jour depuis.

**Why:** le schema encode partout la lecture litterale du PRD ou le comportement le plus restrictif,
jamais une hypothese inventee. Chaque defaut est donc reversible — mais seulement tant que personne
n'a construit dessus.

**How to apply:** trois d'entre elles bloquent une tranche identifiee et doivent etre remontees
avant, pas pendant :
- **Retrogradation Pro → Free au-dessus de 50 liens** : la base la refuse (violation du CHECK).
  Bloque la tranche billing/Stripe downgrade.
- **Version de Postgres cible** : absente de `stack.json`. `uuidv7()` natif exige PG 18, sinon il
  faut une implementation PL/pgSQL dans la premiere migration. Bloque la migration 0001.
- **`billing_event` cascade a la suppression d'organisation**, ce qui contredit "source de verite
  auditable" (US-08.3). Si l'audit doit survivre, la table doit sortir du tenant — decision a
  prendre avant d'ecrire la table, pas apres.

Les autres (casse du nom de collection, invitation d'un owner, promotion member→owner, suppression
de compte utilisateur, unicite des invitations en attente) ont un defaut encode qui tient pour
le MVP.

Deux defauts encodes sont des choix de ma part, pas du PRD, et doivent etre confirmes : l'index
unique partiel "une seule invitation en attente par (org, email)" et l'unicite sensible a la casse
du nom de collection. Voir [[schema-invariants]].
