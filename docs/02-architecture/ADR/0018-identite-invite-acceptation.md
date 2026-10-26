# ADR-0018 — Identite de l'invite a l'acceptation : session obligatoire, adresse verifiee par la base

- **Statut** : accepte (gate d'ouverture de la tranche 006, D-102 : Q-1 option A, Q-2, P-2, P-3, P-4, P-5, P-7 ; D-103 ; decisions locales D-105 a D-108, validees par l'humain, D-110 ; `minRole` « authenticated », D-109)
- **Date** : 2026-10-26
- **Phase** : 3 — tranche 006
- **Complete** : [ADR-0003](0003-token-invitation-hache.md) (enonce de consommation : predicat d'adresse, utilisateur de session) ; [ADR-0017](0017-envoi-invitation-jeton-scelle.md) (lien a fragment, empreinte des octets) ; [ADR-0011](0011-rls-appartenance-utilisateur-session.md) (tableau « source du contexte » : deux fonctions)
- **Decisions du registre** : D-102, D-103, D-105, D-106, D-107, D-108, D-109, D-110

## Contexte

Le lien d'invitation (ADR-0003, ADR-0017) est un secret porteur de 256 bits, transmis par e-mail.
Quiconque le detient pouvait, selon le contrat initial `acceptInvitation` (route « publique »,
champ `password` facultatif), devenir `member` d'une organisation. Il restait a decider **qui**
devient membre quand le lien est presente : la personne connectee, quelle qu'elle soit ? un compte
cree dans la requete ? seulement le titulaire de l'adresse invitee ?

US-03.1 exige que l'acceptation « lie un compte existant » ou permette d'en creer un. Le PRD
(US-09, risque #2) fait de l'isolation entre organisations la propriete centrale du produit : un
lien transfere, intercepte ou colle dans le mauvais canal ne doit pas suffire a faire entrer
n'importe qui.

## Options envisagees (Q-1 du gate de 006)

### Option A — Session obligatoire, adresse du compte egale a l'adresse invitee, verifiee par la base

L'invite sans compte s'inscrit d'abord par la route existante (`POST /api/auth/sign-up/email`,
tranche 001), puis accepte connecte. La base compare l'adresse du compte de session a l'adresse
de l'invitation (insensible a la casse) dans l'enonce meme de consommation.

### Option A' — Session obligatoire, sans correspondance d'adresse

Plus simple, mais un lien transfere fait entrer n'importe quel compte connecte : le secret
redevient le seul facteur.

### Option B — Creation de compte dans la requete d'acceptation (contrat initial, `password`)

Le contrat n'a pas de champ `name` (exige par `app_user`) ; deux connexions (better-auth sous
`signet_auth`, acceptation sous `signet_app`) rendent l'operation non atomique : un compte
orphelin reste si l'acceptation echoue ; le limiteur de debit de l'inscription (ADR-0010) serait
contourne par une seconde porte d'entree.

### Option C — Acceptation sans compte, liaison ulterieure

Ne tient pas « lie un compte existant » (US-03.1) et laisse un etat intermediaire sans
proprietaire.

## Decision

**Option A** (D-102 Q-1), avec les modalites suivantes :

1. **Session obligatoire** : `minRole` du contrat passe de `public` a « utilisateur authentifie » ;
   sans session : `401 UNAUTHENTICATED`. Le champ `password` est retire ; un `password` fourni est
   ignore (aucun compte cree, aucune session ouverte).
2. **Rapprochement d'adresse porte par la base** (P-3) : `signet.accept_invitation(p_token_hash)`
   consomme par un seul enonce conditionnel
   `UPDATE invitation ... WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()
   AND email = (SELECT lower(email) FROM app_user WHERE id = current_user_id()) RETURNING ...`.
   `signet_definer` lit sa propre ligne `app_user` (`app_user_definer_self_read`, `id =
   current_user_id()`) et seulement les colonnes `(id, email)`. La route ne compare rien de
   decisif : si elle oubliait un controle, la base refuserait quand meme.
3. **Utilisateur = utilisateur de session** (P-2) : aucun parametre `user_id` ;
   `accepted_by_user_id` et le `member` cree portent `current_user_id()`, pose par le serveur
   depuis la session better-auth. La seule ecriture nouvelle de `signet_definer` sur `invitation`
   est cet `UPDATE` des deux colonnes d'acceptation (D-103).
4. **Refus d'adresse explicite** (Q-2) : une invitation en attente et valide adressee a une autre
   adresse rend `403 INVITATION_EMAIL_MISMATCH`, message fixe qui ne cite ni l'adresse invitee ni
   celle du compte ; rien n'est consomme, le bon compte peut accepter ensuite. Ecarte : `404`
   (l'invite ne comprend pas pourquoi son lien ne marche pas).
5. **Distinction apres echec seulement** : si la consommation ne rend aucune ligne,
   `lookup_invitation` (meme transaction, apres) distingue inconnue (`404`), expiree (`410`), deja
   utilisee (`409 INVITATION_ALREADY_USED`) et en attente (`403`). Elle exige elle aussi un
   utilisateur de session (P-4) et n'est exposee par aucune route.
6. **Deja membre** (P-5) : `SG008` leve par la fonction annule toute l'operation ; `409
   ALREADY_MEMBER`, invitation non consommee.

## Limite acceptee : adresses non verifiees

better-auth n'impose pas, dans Signet, la verification de l'adresse a l'inscription
(`email_verified` n'est pas exige ; verification et changement d'adresse sont au backlog). La
correspondance d'adresse prouve donc que le compte **declare** l'adresse invitee, pas qu'il la
**possede**. Consequence : une personne qui detient le lien (256 bits, transmis a l'adresse
invitee) et qui cree un compte a cette adresse avant le titulaire peut accepter.

Pourquoi c'est accepte pour l'objectif A :

- il faut deux conditions cumulees : posseder le lien (envoye a la boite du titulaire) **et**
  devancer le titulaire a l'inscription sous son adresse (l'index unique `app_user_email_lower_idx`
  empeche ensuite le titulaire de s'inscrire, ce qui rend l'usurpation visible) ;
- l'option A' ou B ne protege pas mieux : le lien seul suffirait ;
- la correction structurelle (exiger `email_verified` avant d'accepter) depend de la verification
  d'adresse par better-auth, au backlog, et d'un fournisseur d'e-mails reel (hors objectif A,
  D-083).

## Consequences

- Le parcours de l'invite sans compte est en deux etapes (inscription, puis acceptation) ; l'ecran
  qui les enchaine depuis le fragment `#token=` est la tranche 012.
- `lookup_invitation` exigeant une session, l'ecran ne peut pas afficher l'invitation avant
  connexion ; a rouvrir par 012 (P-4), et alors avec un limiteur de debit (P-6, backlog).
- Aucun limiteur propre a la route d'acceptation (P-6) : jeton de 256 bits, session exigee,
  inscription et connexion deja limitees.
- Les messages d'erreur sont fixes et identiques d'une invitation a l'autre (D-107) ; inconnu et
  malforme partagent le meme corps (AC3).

## Signal de reexamen

- Verification d'adresse activee dans better-auth : exiger `email_verified` dans
  `accept_invitation` (une ligne du predicat, `GRANT SELECT` de la colonne) et retirer la limite
  ci-dessus.
- Changement d'adresse d'un compte (backlog) : l'invitation reste liee a l'adresse a la date de
  l'acceptation ; verifier qu'un changement ne permet pas d'accepter une invitation adressee a
  une adresse que le compte n'a jamais possedee.
- Affichage de l'invitation avant connexion (012) : rouvrir P-4 et P-6 ensemble.
