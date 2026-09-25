---
name: audit-verifier-les-tests-pas-que-le-correctif
description: Sur ce projet, verifier qu'un test d'anti-regression aurait echoue AVANT le correctif — plusieurs tests fournis assertent l'inverse du comportement corrige
metadata:
  type: feedback
---

Quand un correctif est livre avec des tests d'anti-regression, ne pas se contenter
de lire le correctif : derouler chaque test ligne par ligne contre le code
**apres** correctif ET **avant** correctif. Un test qui ne distingue pas les deux
etats ne protege rien.

**Why:** tranche 001 de Signet, 2e audit (2026-09-25). Le correctif MAJEUR-2 faisait
poser le contexte tenant *par la fonction elle-meme*
(`propagate_subscription_quota`). Le test livre assertait qu'un `UPDATE` sans
contexte ambiant devait desormais **lever** — alors que le correctif fait
precisement qu'il **reussit**. Le test ne pouvait passer ni avant ni apres. La
meme erreur de raisonnement etait reprise dans le message de la tranche.

**How to apply:** pour chaque test d'anti-regression, ecrire explicitement les deux
verdicts (avant / apres) avant de conclure. Chercher un point d'appui dans le
depot pour valider un mecanisme Postgres plutot que de raisonner dans le vide :
ici `tests/organizations/creation.test.ts` (`link_quota = 50` apres creation)
prouvait que le trigger de propagation trouve bien sa ligne quand le contexte est
pose, et le test 0004 sous `asBypassRls` prouvait que `set_config(..., true)`
fonctionne dans une transaction implicite.

Sans Postgres/psql/docker dans l'environnement, le dire explicitement plutot que
de presenter un raisonnement comme une execution. Voir [[audit-scope-worktree]].
