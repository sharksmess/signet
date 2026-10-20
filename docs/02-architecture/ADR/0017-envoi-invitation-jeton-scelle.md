# ADR-0017 — Envoi de l'invitation : jeton scelle dans l'evenement, lien a fragment, expediteur et doublure

- **Statut** : accepte (gate d'ouverture de la tranche 003, D-086 : Q-1 option B, Q-3, P-1 ; decisions locales D-087, D-088, D-089, D-090, D-091)
- **Date** : 2026-10-20
- **Phase** : 3 — tranche 003
- **Complete** : [ADR-0003](0003-token-invitation-hache.md) (stockage de l'empreinte, inchange) ; s'appuie sur ADR-0006 (Inngest) et ADR-0016 (circuit d'une fonction Inngest)
- **Decisions du registre** : D-086, D-087, D-088, D-089, D-090, D-091

## Contexte

ADR-0003 fixe le stockage : 32 octets aleatoires, seule leur empreinte SHA-256 est en base, le secret
n'existe en clair « que le temps de composer l'e-mail ». ADR-0006 decouple l'envoi de la creation :
l'e-mail part d'une fonction Inngest, executee apres la reponse `201`. Les deux exigences se
heurtent : la fonction qui compose l'e-mail ne s'execute pas dans la requete qui a genere le secret,
et la base ne le connait pas. Il faut donc decider comment le secret va de la route a la fonction,
sans etre ecrit en clair nulle part (base, file d'attente, valeurs memorisees par Inngest, journaux).

Il faut aussi decider : la forme du lien, l'expediteur (aucun fournisseur reel dans l'objectif A,
D-083), le comportement quand la file est indisponible a la creation, et ce qui arrive aux cas de
bord (double envoi, evenement emis puis creation annulee).

## Decision

### 1. Transport du secret : scellement dans l'evenement (D-086 Q-1, option B)

La route genere le secret (`randomBytes(32)`), calcule l'empreinte, appelle
`signet.create_invitation`, puis **scelle** le secret avec l'identifiant retourne :

```
sealedToken = base64url( iv (12 octets aleatoires) || AES-256-GCM(secret) || etiquette (16 octets) )
donnees authentifiees = invitationId (UTF-8)
cle = INVITATION_TOKEN_KEY (32 octets, base64url), node:crypto, aucune dependance
```

L'evenement `signet/invitation.created` (`id` = identifiant de l'invitation, deduplication Inngest)
porte exactement `{ invitationId, organizationId, email, organizationName, sealedToken }`. La
fonction d'envoi ouvre le `sealedToken` **dans son pas d'envoi**, compose le message et le remet a
l'expediteur ; le pas ne retourne qu'une issue sans secret (`{ kind: "sent" }`), parce qu'Inngest
memorise les valeurs de retour des pas.

Proprietes :
- une lecture de la file (tableau de bord Inngest, journaux d'evenements) ne donne pas le lien ;
- un `sealedToken` altere, tronque, presente avec un autre `invitationId` ou ouvert avec une autre cle
  ne s'ouvre pas : `NonRetriableError`, aucun envoi, journal avec l'identifiant seulement (AC3) ;
- un iv aleatoire par scellement : deux scellements du meme secret different.

Options ecartees :
- **A — remplacer le jeton a l'envoi** (la fonction genere un nouveau secret et ecrit son empreinte) :
  ecriture en base sans utilisateur de session (D-033 : chemin `signet_definer` supplementaire), et
  un rejeu de l'envoi invaliderait un lien deja recu.
- **C — jeton derive par HMAC de l'identifiant** : non aleatoire ; la cle seule suffit a fabriquer
  un lien valide pour n'importe quel identifiant public. Une fuite de cle devient une fuite de tous
  les liens passes et futurs, alors qu'avec B elle ne compromet que les evenements captures.

**Empreinte (D-090)** : `token_hash = sha256(32 octets du secret)`, avant encodage base64url. La
tranche 006 decodera le jeton recu, refusera tout ce qui ne fait pas 32 octets, puis hachera les
octets.

**Cle** : validee au premier usage (scellement, ouverture), pas au demarrage : l'environnement de
production de 002 reste valide sans elle (AC16). Refus = message qui nomme la variable, jamais la
valeur ; la cle n'est jamais journalisee. Cote fonction, ce refus est rejouable (un redeploiement
avec la bonne cle reprend l'envoi).

### 2. Lien : jeton dans le fragment (D-086 P-1)

`APP_URL + /invitations/accept#token=<jeton>`. Le fragment n'est jamais transmis au serveur : il
est absent des journaux d'acces, de proxy et de l'en-tete `Referer`. La page d'acceptation
(006/012) le lit cote navigateur et le poste dans le **corps** de `POST /api/invitations/accept`
(contrat `acceptInvitation`). Remplace le « point de vigilance » d'ADR-0003 (secret dans un chemin
non journalise), qui dependait de l'hebergeur. Ecartes : `?token=` (journaux d'acces, `Referer`) ;
jeton dans le chemin avec journalisation desactivee (depend de la configuration de l'hebergeur).

Message en texte brut ; sujet fixe, sans le nom de l'organisation (saisi par un owner : pas
d'injection d'en-tete) ; caracteres de controle du nom remplaces dans le corps.

### 3. Expediteur et doublure (D-087)

Interface `EmailSender.send(message, idempotencyKey)`, resolue par l'environnement :
- `EMAIL_CAPTURE_URL` (acceptee seulement avec `APP_ENV=test`, meme garde que
  `STRIPE_API_BASE_URL`) : expediteur HTTP vers la fausse messagerie du depot
  (`tests/invitations/fakes/fake-mailbox.ts`, `node:http`) : `POST`, en-tete `Idempotency-Key`,
  corps `{ to, subject, text }`, succes = 2xx, requete bornee a 8 s (une messagerie muette donne une
  erreur rejouable, jamais une suspension) ;
- sinon : expediteur « non configure », dont le premier envoi leve `EMAIL_PROVIDER_NOT_CONFIGURED`,
  traduite en `NonRetriableError`. Aucun chemin ne rend un succes sans fournisseur. Le fournisseur
  reel est au backlog.

Ecarte : expediteur en memoire injecte dans la fonction par les tests (point d'injection de test
dans le code de production ; la resolution de l'expediteur ne serait pas testee).

La fonction n'ouvre **aucune** connexion a la base : tout est dans l'evenement (ADR-0006 : aucun
contexte tenant a poser). Propriete verifiee par un test sur ses imports, transitifs (AC15).

### 4. File indisponible a la creation : 503 avant le COMMIT (D-086 Q-3)

La mise en file a lieu **dans** la transaction de l'owner, apres `create_invitation`, sous un point
de sauvegarde. Si la file refuse l'evenement ou ne repond pas en 5 s, l'emission est annulee
(`ROLLBACK TO SAVEPOINT`) et la route repond `503 SERVICE_UNAVAILABLE`, sans detail : aucune ligne,
l'adresse n'est pas bloquee, un nouvel appel est possible aussitot. Ecartes : `201` sans e-mail
(adresse bloquee 7 jours faute de renvoi) ; table d'envois en attente (« outbox »), disproportionnee
pour un cas rare.

### 5. Cas residuels, acceptes

**Double envoi residuel.** La messagerie accepte le message mais la reponse est perdue (coupure,
delai) : le pas d'envoi echoue, Inngest le rejoue, la messagerie recoit le message deux fois. Ce
double envoi est **acceptable** : les deux messages portent **le meme lien** (le rejeu rouvre le
meme `sealedToken`, donc le meme secret) et **la meme cle d'idempotence** (`Idempotency-Key` =
identifiant de l'invitation), transmise au fournisseur ; un fournisseur qui respecte l'idempotence
ne remet qu'un message. Au pire l'invite recoit deux e-mails identiques ; aucun second lien valide
n'existe. Verifie par AC4 (d).

**Evenement emis puis creation annulee** (exige par l'humain, D-086). La file accepte l'evenement,
puis le `COMMIT` echoue ; ou la file l'accepte apres le delai de 5 s, alors que la route a deja
annule l'emission. La fonction envoie alors un e-mail dont le lien est **inerte** : son empreinte
n'existe pas en base, l'acceptation (006) repondra « invitation inconnue ». Aucune invitation
fantome, aucun acces : **sans danger**. L'adresse n'est pas bloquee (aucune ligne) et l'owner peut
reinviter ; l'invite peut recevoir un e-mail inutile.

**Envoi abandonne.** Apres les relances d'Inngest (ou sur un refus non rejouable), `onFailure`
journalise en erreur l'identifiant de l'invitation et le nom de l'erreur, jamais l'adresse, le
jeton, le `sealedToken` ni la cle (patron `reportAbandonedEvent`, ADR-0016). Tant que le renvoi est
au backlog, l'adresse reste bloquee jusqu'a l'expiration (7 jours).

### 6. Base (D-088, D-091)

Une seule migration `0014_invitation.sql` : table (ERD §5), RLS activee et forcee, politiques
`TO signet_app` owner seul (D-086 P-3, texte de `subscription_owner_only`) en `SELECT`, `INSERT`,
`DELETE`, privileges `SELECT, INSERT, DELETE`, et `signet.create_invitation(p_organization_id,
p_email, p_token_hash)` en **`SECURITY INVOKER`** (aucune fonction definer nouvelle), qui fige
`TimeZone = 'UTC'` pour que les 7 jours fassent toujours 168 heures (D-091).

## Consequences

- `INVITATION_TOKEN_KEY` est un secret de production de plus (`.env.example`). **Rotation** : une
  nouvelle cle rend inouvrables les evenements en attente (envoi abandonne, journalise) ; procedure
  de rotation a double cle au backlog.
- Une fuite de la cle ET des evenements captures donne les liens des invitations encore en attente
  (7 jours au plus). Une fuite de la cle seule ne donne rien (option B, pas C).
- Le secret transite en clair dans l'e-mail (limite structurelle d'ADR-0003, inchangee).
- La transaction de l'owner reste ouverte pendant la mise en file (5 s au plus) ; une emission
  concurrente pour le meme couple attend ce delai avant son `409`.

## Signal de reexamen

- Arrivee d'un fournisseur reel : verifier qu'il respecte `Idempotency-Key` ; sinon, reevaluer le
  double envoi residuel. Prevoir alors la limite d'envois (backlog, prealable).
- Renvoi d'une invitation (backlog) : il devra emettre un nouvel evenement scelle, jamais relire un
  secret qui n'existe plus.
- Rotation de cle outillee : ajouter un identifiant de cle au `sealedToken`.
