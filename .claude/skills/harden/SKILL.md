---
name: harden
description: Phase 4. Durcissement transversal : audit de securite complet, couverture de tests, performance, observabilite. A lancer quand un lot de tranches est clos, avant une mise en production.
disable-model-invocation: true
---

Phase 4. Durcissement transversal — ce que les tranches individuelles ne peuvent pas voir parce que chacune ne regarde que son propre perimetre.

Lance ces axes en parallele via des sous-agents, chacun rendant un rapport court dans `docs/04-runbooks/`.

## Axe 1 — Securite globale
`security-auditor` sur l'ensemble du code, pas sur un diff. Ajoute a sa grille habituelle les angles morts inter-tranches :
- Une route ajoutee par la tranche 3 contourne-t-elle une regle posee par la tranche 7 ?
- Le journal d'audit couvre-t-il toutes les actions sensibles, ou seulement celles auxquelles on a pense sur le moment ?
- Les chemins d'erreur revelent-ils l'existence de ressources d'autres tenants ?

## Axe 2 — Couverture reelle
La couverture en pourcentage est un mauvais indicateur : elle mesure les lignes executees, pas les comportements verifies. Cherche plutot :
- Les chemins d'erreur jamais testes.
- Les cas de concurrence : deux requetes simultanees sur la meme ressource.
- Les scenarios E2E critiques : inscription, paiement, invitation, suppression de compte.
- Les webhooks rejoues.

## Axe 3 — Performance
- Requetes N+1 sur les listes.
- Requetes sans index sur les colonnes de filtre et de tri.
- Absence de pagination sur les collections potentiellement grandes.
- Traitement synchrone de ce qui devrait etre en file d'attente : envoi d'emails, generation de documents, appels a des tiers.

## Axe 4 — Observabilite
Tu ne peux pas exploiter ce que tu ne vois pas :
- Erreurs remontees avec le contexte tenant et utilisateur, sans donnee personnelle.
- Traces sur les chemins critiques.
- Une alerte pour chacun des trois risques identifies dans le PRD.
- Un runbook par mode de defaillance previsible : base saturee, webhook Stripe en echec, file bloquee.

## Axe 5 — Conformite au PRD
Reprends les criteres d'acceptation du PRD un par un et verifie qu'un test les couvre. Ceux qui n'en ont pas sont soit obsoletes (a retirer du PRD explicitement), soit oublies (a transformer en tranche).

## Cloture
Consolide un rapport unique avec les constats classes par gravite et le travail restant. Le gate `.gates/04-hardening.approved` est humain.
