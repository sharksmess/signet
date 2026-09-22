---
name: quota-decisions-rejetees
description: Options de quota Free et de jeton d'invitation ecartees en phase 2, avec la raison — pour ne pas les reproposer
metadata:
  type: project
---

Decisions ecartees lors de la modelisation (ADR-0002 et ADR-0003). Une decision rejetee sans
raison ecrite est reproposee trois semaines plus tard.

**Quota Free (50 liens/organisation)**
- `SELECT count(*)` puis `INSERT` cote applicatif — c'est litteralement le risque #3 nomme par le PRD.
- Trigger `BEFORE INSERT` faisant `count(*)` — **piege** : parait atomique, ne l'est pas. `count(*)`
  ne prend aucun verrou, les deux transactions concurrentes comptent 49 et passent. Pire que
  l'option applicative parce que ca eteint la vigilance.
- `SELECT ... FOR UPDATE` sur la ligne organisation — correct, mais la correction depend de la
  discipline de chaque appelant. Un job Inngest qui l'oublie rouvre le trou en silence.
- Rang unique par lien (`UNIQUE(organization_id, link_number)` + `CHECK <= 50`) — le calcul du rang
  a la meme course, les suppressions creent des trous, et le plafond devient une migration.
- **Retenu** : compteur materialise + `CHECK (link_count <= link_quota)` sur la **meme ligne**
  (un CHECK ne porte que sur une ligne — c'est pourquoi compteur et plafond ne peuvent pas etre
  repartis entre `organization` et `subscription`). La valeur 50 n'existe qu'une fois, dans
  `signet.quota_for_tier()`.

**Jeton d'invitation**
- Modele natif du plugin `organization` de better-auth : l'`id` de la ligne sert de secret d'URL,
  stocke en clair. Ecarte — une lecture de base (sauvegarde, export, journal) livre un lien
  fonctionnel, et la meme valeur cumule le role d'identifiant public et de secret.
- Jeton distinct stocke en clair — demi-mesure, meme exposition en lecture.
- JWT/HMAC sans etat — **incompatible avec US-03.3** : un jeton sans etat ne peut pas etre a usage
  unique sans revenir a une table.
- **Retenu** : SHA-256 du secret. Pas bcrypt/argon2 : ils protegent les secrets a faible entropie ;
  32 octets de CSPRNG ne sont pas forcables et un hachage lent interdirait l'indexation.
- **Cout accepte** : le flux d'invitation du plugin better-auth n'est pas utilise, il faut l'ecrire.

**Ecart connu non corrige** : `session.token` reste en clair, impose par better-auth. Nomme dans
l'ERD plutot qu'ignore. Ne pas le "corriger" sans mesurer le cout de patcher better-auth.

Voir [[schema-invariants]] et [[signet-questions-ouvertes]].
