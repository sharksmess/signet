# ADR-0003 — Stockage du jeton d'invitation : empreinte SHA-256, jamais le secret

- **Statut** : accepte
- **Date** : 2026-09-22
- **Phase** : 2 — architecture

## Contexte

US-02.3 exige que l'invite recoive « un e-mail contenant un lien d'acceptation unique », et
US-03 que ce lien soit a usage unique et expire apres 7 jours. Le lien d'acceptation est donc
un **secret porteur** : quiconque le detient obtient l'acces a une organisation en tant que
member, c'est-a-dire la lecture de toutes ses collections et de tous ses liens.

C'est la seule donnee du systeme qui soit a la fois un secret d'authentification et une valeur
transmise par un canal non maitrise (e-mail, historique de navigateur, journaux de proxy).

Le plugin `organization` de better-auth, retenu dans `stack.json`, resout ce besoin en placant
**l'identifiant de la ligne `invitation` dans l'URL** et en le comparant tel quel en base. Le
secret d'URL et la valeur stockee sont alors la meme chaine. Cette decision precede la
modelisation de la table : elle determine ses colonnes et le fait qu'on utilise ou non le modele
du plugin.

Elle est structurante pour une seconde raison : le PRD (US-09, risque #2) fait de l'isolation
entre organisations la propriete centrale du produit. Un jeton d'invitation rejouable est un
contournement complet de cette isolation, par la porte d'entree plutot que par une requete mal
filtree. Le reste du schema protege contre l'oubli de filtre ; il serait incoherent de laisser
ouvert le chemin le plus direct.

## Options envisagees

### Option A — Modele du plugin better-auth : identifiant de l'invitation comme secret d'URL

Zero code specifique, flux d'invitation fourni.

Le defaut n'est pas la devinabilite (un UUID reste hors de portee du forcage brut), mais la
**rejouabilite apres lecture**. Toute exposition de la ligne produit un lien immediatement
utilisable : sauvegarde de base non chiffree, capture d'ecran d'un outil d'administration,
export CSV pour un debogage, journal d'une requete lente contenant la valeur, ou injection SQL
en lecture seule. Le modele de menace « lecture de la base » est precisement celui contre lequel
on protege les mots de passe ; il n'y a pas de raison de traiter differemment un jeton qui
accorde un acces.

Second defaut, plus insidieux : l'identifiant sert simultanement de cle primaire (utilisee dans
des journaux, des URL d'administration, des messages d'erreur) **et** de secret. Ces deux roles
ont des regles de manipulation opposees. Les confondre garantit qu'une valeur secrete finira dans
un endroit non secret.

### Option B — Jeton aleatoire distinct, stocke en clair dans une colonne dediee

Separe les deux roles : l'`id` reste un identifiant public, le jeton devient une colonne a part.
Corrige le second defaut de A, pas le premier : la lecture de la base donne toujours un lien
fonctionnel. Demi-mesure, ecartee.

### Option C — Jeton aleatoire, seule son empreinte SHA-256 est stockee

Le serveur genere 32 octets aleatoires cryptographiques, transmet leur encodage base64url dans
l'URL, et ne stocke que `sha256(secret)` dans `invitation.token_hash`. La verification recalcule
l'empreinte et cherche `WHERE token_hash = ?`. Le secret en clair n'existe qu'en memoire, le
temps de composer l'e-mail.

Une lecture complete de la base ne fournit alors aucun lien utilisable : il faudrait inverser
SHA-256 sur une entree de 256 bits d'entropie.

SHA-256 simple suffit ici, sans bcrypt ni argon2 : ces derniers protegent des secrets **a faible
entropie** (mots de passe humains) contre le forcage hors ligne. Un jeton de 256 bits aleatoires
n'est pas forcable, et un hachage lent rendrait la comparaison couteuse tout en interdisant
l'indexation directe.

### Option D — Jeton signe sans etat (JWT / HMAC), aucune ligne en base

Le lien porte `{organization_id, email, expiration}` signe par le serveur. Aucun stockage, aucune
requete de validation.

Ecartee sur un point rhedibitoire : **un jeton sans etat ne peut pas etre a usage unique**.
US-03.3 exige qu'un lien deja utilise retourne une erreur explicite et ne cree aucune association
supplementaire. Verifier qu'un jeton signe n'a pas deja servi impose une liste de consommation,
c'est-a-dire de revenir a une table — avec en plus l'impossibilite de revoquer une invitation
avant son expiration.

## Decision

**Option C.** `invitation.token_hash bytea NOT NULL` contenant `sha256(secret)`, avec
`CHECK (octet_length(token_hash) = 32)` et un index unique. Le secret d'URL est genere par un
CSPRNG (32 octets), transmis en base64url, et n'est jamais persiste ni journalise.
`invitation.id` reste un UUIDv7 purement identifiant, sans valeur d'authentification.

Le critere qui tranche : le schema entier est construit pour que l'isolation survive a une erreur
(RLS par-dessus le filtre applicatif, cle etrangere composite, quota en contrainte). Un secret
d'acces stocke en clair serait la seule piece du systeme dont la securite repose sur le fait que
rien de mauvais n'arrive jamais.

La consommation a usage unique est portee par un enonce unique, sans lecture prealable :

```sql
UPDATE invitation
   SET accepted_at = now(), accepted_by_user_id = $2
 WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()
RETURNING organization_id, email;
```

Zero ligne retournee signifie « jeton inconnu, expire ou deja consomme » — les trois cas de
US-03.2 et US-03.3. Aucune fenetre entre verification et ecriture, meme raisonnement que
l'ADR-0002 applique a une autre ressource.

## Consequences acceptees

- **Le flux d'invitation du plugin `organization` de better-auth n'est pas utilise.** Il faut
  ecrire l'emission, la validation et l'acceptation : environ une centaine de lignes, plus la
  fonction `signet.accept_invitation()`. C'est le prix direct de cette decision et il est
  entierement paye en phase d'implementation. Le plugin reste utilise pour le reste
  (organisations, membres, organisation active en session).
- **Un jeton perdu est irrecuperable.** Le serveur ne peut pas reafficher le lien : il ne le
  connait plus. Le seul recours est de supprimer l'invitation en attente et d'en emettre une
  nouvelle. C'est le comportement correct, mais il doit etre prevu dans l'interface owner,
  sinon il sera vecu comme un bug.
- **Aucune recherche partielle sur le jeton** (prefixe, autocompletion, support technique).
  Le lookup est une egalite exacte sur l'empreinte, rien d'autre.
- **Le secret transite en clair dans l'e-mail**, ce que rien ne peut empecher. L'expiration a
  7 jours (imposee par un `CHECK` en base, pas par une constante applicative) et l'usage unique
  bornent la fenetre. C'est la limite structurelle de l'invitation par e-mail, assumee.
- **Le jeton ne doit jamais apparaitre dans un journal**, y compris via une URL complete
  journalisee par un reverse proxy ou un outil d'observabilite. Le lien d'acceptation doit donc
  porter le secret dans le **chemin** d'une route dont la journalisation d'URL est desactivee,
  ou etre echange contre un cookie de session des la premiere requete. Point de vigilance pour
  l'auditeur de securite, pas seulement pour le schema.
- **La meme approche n'est pas appliquee a `session.token`**, impose en clair par better-auth.
  Ecart connu et documente dans l'ERD, non corrige : le corriger exigerait de modifier
  l'implementation de better-auth, ce qui couterait plus que le risque evite pour un banc d'essai.
  La coherence est preferee au perfectionnisme, mais l'ecart est nomme plutot qu'ignore.

## Signal de reexamen

- better-auth fait evoluer son plugin `organization` pour hacher lui-meme le jeton d'invitation :
  la table specifique perd sa raison d'etre et le code specifique devrait etre retire.
- Une invitation ouvre un jour un acces plus large que `member` (invitation d'owner, invitation
  avec droits de facturation) : la duree de 7 jours et le simple SHA-256 devraient alors etre
  reevalues au regard d'une valeur de cible plus elevee.
- Un besoin de revocation explicite d'invitation apparait au PRD : il faudrait alors une colonne
  `revoked_at` et revoir l'index unique partiel des invitations en attente.
