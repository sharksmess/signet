# 003 — Invitation d'un membre

> **Statut : valide par l'humain le 2026-10-20 (D-086), active.** Redige selon `docs/04-runbooks/consigne-tranche-003.md` (objectif A, D-083, D-084). Questions Q-1 a Q-4 tranchees selon l'option recommandee ; decisions proposees P-1 et P-3 acceptees ; complement de l'humain : ADR-0017 documente l'evenement emis puis la creation annulee. Decisions locales de Claude Code : D-087 a D-089.

## Capacite
En tant qu'owner, j'invite une personne par e-mail a rejoindre mon organisation : l'invitation est enregistree, liee a l'organisation, expire apres 7 jours, et l'invite recoit un e-mail contenant un lien d'acceptation unique (US-02.1, US-02.3). Un member ne peut pas inviter (US-02.2).

## Perimetre
- **Touche** :
  - table `invitation` (ERD §5, a l'identique : colonnes, `CHECK`, index `invitation_token_hash_idx`, `invitation_pending_idx`, `invitation_org_idx`, `invitation_expires_idx`), `ENABLE`/`FORCE RLS`, politiques `signet_app` (owner seul, D-086 P-3) et privileges ;
  - fonction `signet.create_invitation(...)`, **`SECURITY INVOKER`** (ERD §5 : pas de `SECURITY DEFINER`), purge de la ligne expiree puis insertion, dans la transaction de l'owner ;
  - route `POST /api/organizations/:organizationId/invitations` ;
  - scellement du jeton (AES-256-GCM, `node:crypto`, cle `INVITATION_TOKEN_KEY`, D-086 Q-1) ;
  - interface « expediteur d'e-mails », sa resolution en production (aucun fournisseur : echec bruyant au premier envoi) et sa doublure de test (fausse messagerie, D-083, D-087) ;
  - une fonction Inngest d'envoi de l'e-mail d'invitation, enregistree sur `/api/inngest` ;
  - ADR-0017 (envoi de l'invitation, D-089), ADR-0003 (statut : « complete par ADR-0017 »), ADR-0011 (tableau « source du contexte » : `create_invitation`, invoker), ERD §5, §10 (question ouverte 1 resolue par D-086) et matrice d'isolation, contrat `invitations.ts` (`409 ALREADY_MEMBER` et `503 SERVICE_UNAVAILABLE` ajoutes, D-086), `.env.example`, `.env.test.example`, workflow CI (valeurs inventees), backlog (fournisseur reel, limite d'envois, renvoi et revocation, purge periodique).
- **NE touche PAS** :
  - acceptation d'une invitation, `signet.lookup_invitation()`, `signet.accept_invitation()`, politiques `signet_definer` de `invitation`, `GRANT UPDATE` : **tranche 006** ;
  - ecrans (formulaire d'invitation, page d'acceptation, liste des invitations en attente) : **tranche 012**. La page cible du lien (`APP_URL` + `/invitations/accept`) n'a pas besoin d'exister (precedent : URL de retour Checkout de 002) ;
  - fournisseur d'e-mails reel, domaine d'envoi, SPF/DKIM, e-mail HTML : **backlog** (hors objectif A) ;
  - renvoi manuel d'une invitation, revocation, liste des invitations par l'API : **backlog** (aucune route de lecture) ;
  - limite d'envois par organisation ou par owner : **backlog**, prealable au fournisseur reel, avec audit-001 MINEUR-5 et audit-002 MINEUR-1 (D-086 Q-4) ;
  - purge periodique des invitations perimees (cron Inngest sur `invitation_expires_idx`) : **backlog** ; la seule purge de la tranche est celle de `create_invitation`, pour le couple (organisation, e-mail) reinvite ;
  - rotation de `INVITATION_TOKEN_KEY` (une rotation rend inouvrables les evenements en attente : envoi abandonne, journalise) : **backlog** ;
  - invitation d'un owner (impossible par `CHECK (role = 'member')`), transfert de propriete, retrait d'un membre (008) ;
  - `organization`, `member`, `subscription`, Stripe, quota, collections, liens.

## Perimetre de fichiers
Declare dans `.gates/scope-003.txt` (source de verite du hook) : documentation de la tranche (ERD, ADR-0003/0011/0017, contrat `invitations.ts`, registre, journal, consigne, fiche de preuves, FRICTION, backlog), migrations nouvelles et schema `invitations`, route `invitations`, point de service `inngest`, modules `apps/web/src/lib/invitations/*` et `apps/web/src/lib/email/*`, `lib/inngest/client.ts` et le fichier de la nouvelle fonction (`lib/inngest/send-invitation-email.ts`), `env.ts`, `errors.ts`, `.env.example`, `.env.test.example`, workflow CI, `tests/invitations/**`, `tests/helpers/db.ts` (remise a zero : `invitation`), `tests/helpers/invitations*.ts`. Les suites de 001, 002, 010, 011 et de l'usine sont hors perimetre (non-regression sans modification). `.env.test.local` est rempli par l'humain.

## Dependances
- Tranches devant etre closes avant celle-ci : 001 (close). 010 (patron RLS) et 002 (patron Inngest, doublures) sont closes.
- **Aucune dependance nouvelle** : chiffrement, empreinte et alea par `node:crypto` ; fausse messagerie ecrite dans le depot (`node:http`) ; `inngest` et `@inngest/test` deja presents (ADR-0015). Si l'implementation en revele une : arret, ADR et quarantaine pnpm.

## Commandes d'echafaudage prevues
`pnpm db:generate` pour la table `invitation` : cree un fichier dans `packages/db/migrations/` et `meta/` (renomme au numero suivant du dossier, `0014_*`, etiquette alignee dans `meta/_journal.json`, precedent ERD « Numerotation »). Verification apres coup par `git status --short`. Aucun `pnpm add`.

## Contrat de donnees
| Table | Colonnes ajoutees / modifiees | Contraintes et index |
|---|---|---|
| `invitation` (nouvelle) | `id, organization_id, email, role, token_hash, invited_by_user_id, created_at, expires_at, accepted_at, accepted_by_user_id` (ERD §5, a l'identique) | `CHECK (email = lower(email))`, longueur 254, forme de `app_user.email` ; `CHECK (role = 'member')` ; `CHECK (octet_length(token_hash) = 32)` ; `expires_at DEFAULT now() + 7 days`, `CHECK (expires_at > created_at)`, `CHECK (expires_at <= created_at + interval '7 days')` ; `invitation_acceptance_consistent` ; `UNIQUE invitation_token_hash_idx (token_hash)` ; `UNIQUE invitation_pending_idx (organization_id, email) WHERE accepted_at IS NULL` ; `invitation_org_idx` ; `invitation_expires_idx WHERE accepted_at IS NULL` ; FK `organization ON DELETE CASCADE`, `app_user ON DELETE RESTRICT` |

Une seule migration porte la table, sa RLS, ses politiques, ses privileges et la fonction (D-088 ; ERD « Ordre des migrations » : jamais de table ouverte entre deux migrations) : fichier genere par `pnpm db:generate`, complete a la main.

**Politiques** (`TO signet_app` seulement, D-086 P-3) : `SELECT`, `INSERT`, `DELETE` sur `organization_id = signet.current_org()` **et role owner** de l'utilisateur de session (texte de `subscription_owner_only`, une jointure sur `member`). Aucune politique `UPDATE` ni `signet_definer` (006). Privileges : `GRANT SELECT, INSERT, DELETE ON invitation TO signet_app` ; `DELETE` sert seulement a la purge de la ligne expiree dans `create_invitation`.

**`signet.create_invitation(p_organization_id uuid, p_email text, p_token_hash bytea) RETURNS invitation`** : `SECURITY INVOKER` (la RLS de l'appelant s'applique), `SET search_path = pg_catalog, signet, public, pg_temp`, tables qualifiees, `REVOKE ALL FROM PUBLIC`, `EXECUTE` a `signet_app` seul. `id` garde son `DEFAULT uuidv7()` ; `invited_by_user_id` = `signet.current_user_id()` (jamais un parametre). **Aucun parametre de date** : `created_at` et `expires_at` prennent leur valeur par defaut. Corps : `DELETE` de la ligne en attente expiree du couple, puis `INSERT` ; une violation de `invitation_pending_idx` remonte en `23505` (traduite en 409 par l'application).

## Contrat d'API
Source : `docs/02-architecture/api-contracts/invitations.ts`, `createInvitation`, amende par la tranche (D-086) : `409 ALREADY_MEMBER` (Q-2) et `503 SERVICE_UNAVAILABLE` (Q-3), avec passage de `contract-guardian`. Sortie inchangee ; `email` y est la forme normalisee.

| Route | Methode | Entree | Sorties | Role minimal | Idempotent sur |
|---|---|---|---|---|---|
| `/api/organizations/:organizationId/invitations` | POST | `organizationId` (UUID, chemin, fait autorite) + `{ email }` | `201 { id, organizationId, email, expiresAt }` | owner | non idempotente (contrat) : rejeu tant que l'invitation est en attente -> `409 INVITATION_ALREADY_PENDING` |
| `/api/inngest` | GET/POST/PUT | protocole Inngest (inchange, ADR-0016) | — | public (signature Inngest) | — |

Erreurs : `401 UNAUTHENTICATED` ; `404 ORGANIZATION_NOT_FOUND` (inexistante ou appelant non membre, reponses identiques) ; `403 INSUFFICIENT_ROLE` ; `422 VALIDATION_FAILED` ; `409 INVITATION_ALREADY_PENDING` ; `409 ALREADY_MEMBER` (adresse deja membre, owner compris) ; `503 SERVICE_UNAVAILABLE` (file indisponible, rien n'est cree).

Evenement mis en file : `signet/invitation.created`, `id` = identifiant de l'invitation (deduplication Inngest), donnees `{ invitationId, organizationId, email, organizationName, sealedToken }` — jamais le jeton en clair (D-086 Q-1). `sealedToken` = base64url de `iv (12 octets) || texte chiffre || etiquette (16 octets)`, AES-256-GCM, donnees authentifiees = `invitationId` ; un `iv` aleatoire par scellement.

## Criteres d'acceptation

Conventions : aucun appel reseau reel, aucun fournisseur reel ; « jeton » = le secret du lien (32 octets aleatoires, transmis encodes en base64url), « empreinte » = `sha256` des **32 octets du secret, avant encodage base64url** (D-090), jamais le haché du texte du lien. La fonction Inngest est executee dans le processus de test par `@inngest/test` (patron de 002, ADR-0016) ; la reponse `201` signifie « invitation persistee et envoi mis en file », jamais « e-mail remis » (ADR-0006).

- [x] AC1 — **Emission nominale (US-02.1)** : `POST { email }` par l'owner -> `201 { id, organizationId, email, expiresAt }`. En base, une ligne : `role = 'member'`, `invited_by_user_id` = l'owner, `accepted_at` et `accepted_by_user_id` `NULL`, `token_hash` de 32 octets, `expires_at - created_at = 7 jours` exactement, `expiresAt` de la reponse egal a `expires_at`. Le faux Inngest a recu **un** evenement `signet/invitation.created` dont l'`id` est celui de l'invitation.
- [x] AC2 — **E-mail et lien (US-02.3)** : la fonction executee avec l'evenement capture depose **un** message dans la fausse messagerie, adresse a l'e-mail normalise, texte brut, contenant le nom de l'organisation et un lien `APP_URL + /invitations/accept#token=<jeton>` (D-086 P-1). Le jeton est l'encodage base64url de 32 octets, et le `sha256` de ces 32 octets decodes (avant encodage, D-090) est egal a `token_hash` de la ligne ; le haché du texte base64url ne l'est pas. Deux invitations distinctes ont deux jetons distincts. Le message porte la cle d'idempotence = identifiant de l'invitation.
- [x] AC3 — **Le jeton ne fuit nulle part (ADR-0003)** : pour une invitation emise puis envoyee, le jeton (et sa forme hexadecimale ou base64 standard) est absent : de la reponse HTTP ; de toutes les colonnes de la ligne `invitation` (representation texte de chaque colonne) ; du corps brut de l'evenement recu par le faux Inngest ; de la valeur retournee par chaque pas Inngest (memorisee par Inngest) ; des journaux emis pendant l'emission et l'envoi (console du processus de test espionnee). Un `sealedToken` modifie (un octet), tronque, ou presente avec un autre `invitationId` (donnees authentifiees), ou ouvert avec une autre cle -> echec **non rejouable**, aucun message, journal sans jeton, sans `sealedToken` et sans cle.
- [x] AC4 — **Envoi decouple et rejouable (ADR-0006)** :
  - (a) fausse messagerie en echec (`500`) ou muette : l'invitation existe et reste valide ; le pas d'envoi echoue en erreur rejouable ; aucune ligne `invitation` supplementaire ;
  - (b) rejeu apres retour de la messagerie : **un** message, avec **le meme lien** que celui qu'aurait porte le premier envoi ; toujours une seule ligne ;
  - (c) la fonction executee une seconde fois apres un envoi reussi (pas memorise) n'envoie rien de plus ;
  - (d) double envoi residuel (la messagerie a accepte mais la reponse est perdue) : documente comme acceptable dans ADR-0017 — meme lien, meme cle d'idempotence transmise au fournisseur ; le test verifie que les deux messages portent le meme lien et la meme cle.
- [x] AC5 — **Isolation tenant (US-09)** :
  - (a) par l'API : l'owner de A appelle `POST` sur l'organisation B -> `404 ORGANIZATION_NOT_FOUND`, corps identique a celui d'un UUID inexistant ; aucune ligne, aucun evenement ;
  - (b) en base, sous `signet_app` avec `app.organization_id` = B et `app.user_id` = owner de A (contexte etranger force, modele d'AC2 de 010) : 0 ligne `invitation` de B visible ; `INSERT` direct et `signet.create_invitation(B, ...)` refuses (`42501` RLS) ; `DELETE` des lignes de B : 0 ligne ; les invitations de B sont intactes ;
  - (c) les invitations de A ne sont jamais visibles sous le contexte de l'owner de B.
- [x] AC6 — **Permission insuffisante (US-02.2)** : un member recoit `403 INSUFFICIENT_ROLE`, aucune ligne, aucun evenement. En base, sous `signet_app` avec le contexte de ce member, `invitation` de son organisation renvoie 0 ligne (une invitation y existe, creee par l'owner) et `create_invitation` est refusee (D-086 P-3). Sans session : `401 UNAUTHENTICATED`.
- [x] AC7 — **Validation et normalisation** : `email` absent, vide, non textuel, malforme, de plus de 254 caracteres ; corps non JSON ; `organizationId` non UUID -> `422 VALIDATION_FAILED`, rien n'est cree. `"  Alice@Example.COM  "` est enregistre et renvoye `alice@example.com` (espaces retires, minuscules) ; toute comparaison (doublon, membre deja present) porte sur la forme normalisee. Un champ inconnu du corps (`expiresAt`, `role`, `organizationId` contradictoire) n'a aucun effet.
- [x] AC8 — **Doublon en attente** : une invitation en attente et non expiree existe pour (A, e-mail) -> `409 INVITATION_ALREADY_PENDING`, y compris si l'e-mail differe par la casse ou les espaces ; la ligne existante est inchangee (meme `token_hash`, meme `expires_at`) ; aucun evenement. La meme adresse invitee par l'organisation B -> `201` (l'unicite est par organisation).
- [x] AC9 — **Expiration puis reinvitation** : l'invitation en attente de (A, e-mail) est rendue expiree (dates forcees sous la connexion d'administration) ; un nouveau `POST` -> `201`, l'ancienne ligne est supprimee, la nouvelle a un autre `id`, une autre empreinte, une expiration a 7 jours. Une invitation **acceptee** (forcee en base) pour cette adresse n'empeche pas l'emission (index partiel) — sauf si l'adresse est devenue membre, voir AC12.
- [x] AC10 — **Concurrence** : deux `POST` simultanes pour (A, e-mail), depuis deux connexions -> exactement un `201` et un `409 INVITATION_ALREADY_PENDING` ; une seule ligne ; un seul evenement. Meme resultat lorsqu'une invitation expiree du couple existe avant les deux appels (les deux purges se serialisent sur la ligne).
- [x] AC11 — **Expiration imposee par la base** : sous la connexion d'administration, une ligne avec `expires_at > created_at + 7 jours` ou `expires_at <= created_at` -> `23514`. `create_invitation` n'accepte aucun parametre de date (test de catalogue sur sa signature). Un `expiresAt` dans le corps de la requete est ignore (AC7).
- [x] AC12 — **Adresse deja membre (D-086 Q-2)** : l'adresse d'un membre de A (toute casse) -> `409 ALREADY_MEMBER` ; **l'owner qui s'invite lui-meme** -> `409 ALREADY_MEMBER` ; aucune ligne, aucun evenement. L'adresse d'un utilisateur membre de B seulement, invitee par A -> `201` (la reponse ne revele rien de B).
- [x] AC13 — **File indisponible a la creation (D-086 Q-3)** : faux Inngest en echec ou muet -> `503 SERVICE_UNAVAILABLE`, sans detail interne ; **aucune** ligne `invitation` (transaction annulee) ; un nouvel appel apres retour de la file -> `201` (pas de `409` fantome).
- [x] AC14 — **Aucun fournisseur reel (D-083, D-087)** : sans `EMAIL_CAPTURE_URL`, l'expediteur resolu est l'expediteur « non configure » : le premier envoi echoue en erreur **non rejouable** nommee (`EMAIL_PROVIDER_NOT_CONFIGURED`), journalisee en erreur avec l'identifiant de l'invitation seulement ; aucun chemin ne rend un succes. `EMAIL_CAPTURE_URL` n'est acceptee qu'avec `APP_ENV=test` (meme garde que `STRIPE_API_BASE_URL`, teste sur le schema).
- [x] AC15 — **Fonctions et catalogue (D-033, ADR-0011)** : la tranche n'ajoute **aucune** fonction `SECURITY DEFINER` (l'ensemble des fonctions `prosecdef` du schema `signet` est identique avant et apres la migration) ; `create_invitation` est `SECURITY INVOKER`, non executable par `PUBLIC`, `signet_auth`, `signet_billing`, `signet_owner` ; `invitation` a la RLS activee et forcee ; aucune politique `TO PUBLIC` ; les invariants de catalogue de 010 (`current_org(` absent des politiques `signet_definer`, `context_org(` absent des politiques `signet_app`) restent verts et couvrent `invitation`. Le test sous contexte etranger force de `create_invitation` est AC5 (b). Le module de la fonction d'envoi n'importe aucun module d'acces a la base (`lib/db.ts`, `lib/inngest/billing-db.ts`, pilote `pg`) : verifie par un test sur ses imports.
- [x] AC16 — **Environnement, cle et dependances (D-086 Q-1)** : `INVITATION_TOKEN_KEY` (32 octets en base64url) validee par le schema **au premier usage** ; absente ou mal formee -> refus nommant la variable, jamais sa valeur ; la cle n'apparait dans aucun journal ni message d'erreur (verifie en provoquant les echecs d'AC3). `EMAIL_CAPTURE_URL` optionnelle (AC14). `next build` ne lit pas ces variables (D-079 ; `tests/billing/build-env.test.ts` reste vert sans modification). Aucune dependance ajoutee (`package.json` et `pnpm-lock.yaml` inchanges).

## Doublures de test
Aucun appel reseau reel, aucune vraie cle, en local comme en CI (patron D-059).

- **Fausse messagerie** (`tests/invitations/fakes/fake-mailbox.ts`, D-087) : serveur `node:http` sur un port fixe (`fileParallelism: false`), demarre par les fichiers de test, qui enregistre chaque message (destinataire, sujet, texte, cle d'idempotence) ou repond `500` / ne repond pas sur demande (AC4). L'expediteur de production est raccorde par `EMAIL_CAPTURE_URL`. Ecarte : expediteur en memoire injecte dans la fonction (point d'injection de test dans le code de production, resolution de l'expediteur non testee).
- **Inngest** : faux point d'evenements de 002 (`tests/billing/fakes/fake-inngest.ts`, importe tel quel) pour l'emission et AC13 ; execution de la fonction par `@inngest/test` dans le processus de test, contre la fausse messagerie (AC2 a AC4, AC14).

## Variables d'environnement (noms seulement)
| Nom | Lu par | Test (CI et `.env.test.local`) | Developpement (`.env`) |
|---|---|---|---|
| `INVITATION_TOKEN_KEY` | route d'invitation (scelle), fonction d'envoi (ouvre) | valeur inventee, **identique** pour le serveur de test (`TEST_SERVER_ENV_INVITATION_TOKEN_KEY`) et pour le processus de test | valeur aleatoire generee par l'humain |
| `EMAIL_CAPTURE_URL` | expediteur d'e-mails | URL de la fausse messagerie ; **refusee hors `APP_ENV=test`** | absente (l'envoi echoue bruyamment, AC14) |
| `APP_URL` | lien de l'e-mail | deja present (002) | deja present |

En CI, valeurs inventees ecrites en clair dans le workflow. **Action humaine** : ajouter a `.env.test.local` les noms listes dans `.env.test.example` avec des valeurs inventees ; ajouter `INVITATION_TOKEN_KEY` a `.env` avant tout `pnpm dev`.

## Anti-regression
- Suites 001, 002, 010, 011 et `tests/_factory/*` vertes **sans modifier leurs assertions** ; `db-catalog.test.ts` vert (nouvelle table sous RLS forcee, aucune fonction definer nouvelle).
- `/api/inngest` sert la fonction Stripe **et** la nouvelle fonction ; les tests de 002 sur le point de service (AC15 de 002) restent verts.
- La regle d'isolation de la connexion `signet_billing` (AC16 de 002, `no-restricted-imports`) est inchangee : la nouvelle fonction n'importe pas `billing-db.ts` et n'ouvre aucune connexion a la base.
- `contract-guardian` : `invitations.ts` modifie uniquement par l'ajout de `409 ALREADY_MEMBER` et `503 SERVICE_UNAVAILABLE` (D-086) ; `acceptInvitation` (006) inchange.

## Notes d'implementation
- Ordre dans la route : session -> validation -> controle d'appartenance et de role (`withTenant`, filtre `organization_id` explicite) -> `ALREADY_MEMBER` (lecture de `member` jointe a `app_user`, `lower(email)`) -> generation du jeton, empreinte -> `create_invitation` -> scellement avec l'`id` retourne -> mise en file -> `COMMIT`. La mise en file a lieu **avant** le `COMMIT` (D-086 Q-3) : un echec annule tout (503).
- **Cas residuel (complement de l'humain, D-086), a documenter dans ADR-0017** : evenement accepte par la file puis `COMMIT` en echec (ou creation annulee apres la mise en file). La fonction envoie alors un e-mail dont le lien est **inerte** : son empreinte n'existe pas en base, l'acceptation (006) repondra « invitation inconnue » ; aucune invitation fantome, aucun acces, sans danger. L'adresse n'est pas bloquee (aucune ligne), l'owner peut reinviter.
- Le jeton n'existe en clair que dans la route (le temps de calculer l'empreinte et de le sceller) et dans le pas d'envoi (le temps de composer le message). Le pas d'envoi ne **retourne** jamais le jeton ni le message : Inngest memorise les valeurs de retour des pas.
- Echec d'ouverture du `sealedToken` (alteration, autre cle, autre identifiant) : `NonRetriableError`, journal avec l'identifiant de l'invitation et le nom de l'erreur seulement.
- Message en texte brut ; le nom de l'organisation (saisi par un owner) n'apparait que dans le corps, jamais dans le sujet ni un en-tete (pas d'injection d'en-tete) ; sujet fixe.
- `onFailure` de la fonction : journal en erreur avec l'identifiant de l'invitation et le nom de l'erreur, jamais l'e-mail, le jeton, le `sealedToken` ni la cle (patron `reportAbandonedEvent`, ADR-0016). Consequence assumee tant que le renvoi est au backlog : une invitation dont l'envoi est abandonne bloque la reinvitation de la meme adresse jusqu'a son expiration (7 jours).
- Erreurs metier typees (`Result`), pas de `throw` : `InsufficientRole`, `OrganizationNotFound`, `InvitationAlreadyPending`, `AlreadyMember`, `ServiceUnavailable`. L'expediteur non configure leve une erreur nommee (invariant de deploiement), traduite en `NonRetriableError`.
- Contexte de la fonction Inngest (ADR-0006) : elle n'ouvre aucune connexion a la base — tout ce qu'il lui faut est dans l'evenement — donc aucun contexte tenant a poser ; c'est une propriete testee (AC15).

## Decisions du gate d'ouverture
Humain, **D-086** : options recommandees retenues.
- **Q-1 — option B** : jeton aleatoire de 32 octets, empreinte seule en base, jeton scelle dans l'evenement (AES-256-GCM de `node:crypto`, donnees authentifiees = identifiant de l'invitation), cle `INVITATION_TOKEN_KEY` validee au premier usage, jamais journalisee, inventee en test. Ecartes : A (remplacement du jeton a l'envoi : ecriture en base sans utilisateur de session, D-033, et lien deja recu invalide par un rejeu) ; C (jeton derive par HMAC : non aleatoire, la cle seule fabrique un lien valide a partir d'un identifiant public).
- **Q-2** — `409 ALREADY_MEMBER`, owner compris. Ecartes : acceptation sans effet en 006 (e-mail inutile, adresse bloquee 7 jours) ; reutiliser `INVITATION_ALREADY_PENDING` (faux).
- **Q-3** — `503 SERVICE_UNAVAILABLE` sans rien creer, mise en file avant le `COMMIT`. Ecartes : `201` sans e-mail (adresse bloquee 7 jours faute de renvoi) ; table d'envoi en attente (« outbox »), disproportionnee pour un cas rare.
- **Q-4** — limite d'envois au backlog, prealable au fournisseur reel. Ecarte : limiteur dans la tranche (stockage partage a choisir).
- **P-1** — jeton dans le fragment (`#token=`) : jamais transmis au serveur, absent des journaux d'acces et de proxy ; la page de 006/012 le lit cote navigateur et le poste dans le corps. Ecartes : `?token=` (journaux d'acces, `Referer`) ; jeton dans le chemin avec journalisation desactivee (depend de l'hebergeur).
- **P-3** — invitations lisibles et modifiables par l'owner seul (RLS). Ecarte : `current_org()` seul (ERD §5 initial).
- **Complement** : ADR-0017 documente l'evenement emis puis la creation annulee (lien inerte, sans danger).

Claude Code (registre) :
- **D-087** — expediteur resolu par `EMAIL_CAPTURE_URL` (test seulement) ou expediteur « non configure » ; fausse messagerie HTTP dans le depot (ex-P-2) ;
- **D-088** — une seule migration `0014_*` pour table, RLS, politiques, privileges et `create_invitation` invoker (ex-P-4) ;
- **D-089** — numero reserve ADR-0017 ; ADR-0003 complete, non remplace (ex-P-5).
