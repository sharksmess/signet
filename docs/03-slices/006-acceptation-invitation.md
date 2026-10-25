# 006 — Acceptation d'une invitation

> **Statut : valide par l'humain le 2026-10-25 (D-102, D-103), active.** Redige selon `docs/04-runbooks/consigne-tranche-006.md` (objectif A, D-083, D-084 ; usine 1.6.4, D-101). Q-1 option A, Q-2 `403 INVITATION_EMAIL_MISMATCH`, Q-3 acceptee sous condition d'un test de catalogue (reformulee par D-103) ; decisions proposees P-1 a P-7 acceptees.

## Capacite
En tant qu'invite connecte avec le compte de l'adresse invitee, j'accepte une invitation en presentant le jeton recu par e-mail : je deviens `member` de l'organisation (US-03.1). Un lien expire (US-03.2) ou deja utilise (US-03.3) donne une erreur explicite et ne cree aucune appartenance.

## Perimetre
- **Touche** :
  - fonctions `signet.lookup_invitation(p_token_hash bytea)` et `signet.accept_invitation(p_token_hash bytea)`, `SECURITY DEFINER`, proprietaire `signet_definer` (deux points d'entree deja listes par l'ERD §1, pas de cinquieme fonction nouvelle) ;
  - politiques `signet_definer` sur `invitation` (deux lectures, un `UPDATE` borne a l'acceptation), `GRANT SELECT` et `GRANT UPDATE (accepted_at, accepted_by_user_id)` sur `invitation` a `signet_definer` ; `signet_app` inchange (`SELECT, INSERT, DELETE`) ;
  - politique `signet_definer` de lecture de sa propre ligne `app_user` (`id = current_user_id()`) et `GRANT SELECT (id, email) ON app_user TO signet_definer`, pour le rapprochement d'adresse en base (P-3) ;
  - route `POST /api/invitations/accept` ;
  - decodage du jeton et empreinte (`apps/web/src/lib/invitations/`, reutilise le module de 003) ;
  - contrat `invitations.ts` (`acceptInvitation`) amende (Q-1, Q-2), avec passage de `contract-guardian` ;
  - ADR-0018 (identite de l'invite a l'acceptation, P-7), ADR-0011 (tableau « source du contexte » : deux fonctions), ADR-0003 et ADR-0017 (renvoi vers 0018), ERD §1 (deux fonctions « ecrites », signature P-2), §2.1 (politique `app_user_definer_self_read`), §5 (politiques definer, `accept_invitation`), matrice d'isolation, backlog.
- **NE touche PAS** :
  - ecrans : page `/invitations/accept` qui lit le fragment `#token=`, formulaires d'inscription et de connexion, affichage de l'invitation avant connexion : **tranche 012** ;
  - creation de compte par la route d'acceptation (Q-1 option B ecartee) : l'inscription reste `POST /api/auth/sign-up/email` (better-auth, tranche 001) ;
  - verification d'adresse e-mail par better-auth (`email_verified`), changement d'adresse : **backlog** (limite ecrite dans ADR-0018) ;
  - choix de l'organisation active en session (`session.active_organization_id`) apres acceptation : **tranche 012** ;
  - renvoi et revocation d'une invitation, liste des invitations en attente, purge periodique : **backlog** (D-086) ;
  - retrait d'un membre, dernier owner : **tranche 008** ;
  - fournisseur d'e-mails reel, limite d'envois : **backlog** ;
  - emission (`create_invitation`, route `POST /api/organizations/:id/invitations`, fonction d'envoi Inngest) : **inchangee** (003) ;
  - limiteur de debit propre a la route d'acceptation : **backlog** (P-6) ;
  - suppression de compte : hors perimetre du MVP (ERD §10, FK d'auteur en `RESTRICT`) ;
  - `organization`, `subscription`, Stripe, quota, collections, liens.

## Perimetre de fichiers
Declare dans `.gates/scope-006.txt` (source de verite du hook) : documentation de la tranche (contrat, journal, consigne, fiche de preuves, ERD, ADR-0003/0011/0017/0018, contrat `invitations.ts`, registre, journal de projet 19, FRICTION, backlog), migrations nouvelles et `meta/`, route `apps/web/src/app/api/invitations/accept/*`, modules `apps/web/src/lib/invitations/*`, `errors.ts`, `tests/invitation-acceptance/**`, `tests/helpers/invitations*.ts`, et **un fichier de test de 003** : `tests/invitations/database.test.ts` (Q-3, voir Anti-regression). Les autres suites (001, 002, 003, 010, 011, usine) sont hors perimetre : non-regression sans modification.

## Dependances
- Tranches devant etre closes avant celle-ci : 003 (close, PR #29). 001, 010, 002 closes.
- **Aucune dependance nouvelle** : decodage base64url et `sha256` par `node:crypto` / `Buffer` ; session par better-auth deja present.

## Commandes d'echafaudage prevues
Aucune table ni colonne nouvelle : la migration ne contient que des fonctions, politiques et privileges. `pnpm db:generate` ne produit alors rien ; la migration est creee par `pnpm --filter @signet/db exec drizzle-kit generate --custom --name accept_invitation` (fichier vide numerote, a completer), renomme au numero suivant (`0015_*`) et etiquette alignee dans `meta/_journal.json` (precedent ERD « Numerotation »). Verification apres coup par `git status --short`. Aucun `pnpm add`.

## Contrat de donnees
| Table | Colonnes ajoutees / modifiees | Contraintes et index |
|---|---|---|
| `invitation` | aucune | aucune ; nouvelles politiques `signet_definer` ; `GRANT SELECT` et `GRANT UPDATE (accepted_at, accepted_by_user_id)` a `signet_definer` (ni `INSERT`, ni `DELETE`, ni `TRUNCATE`, ni `UPDATE` d'une autre colonne) |
| `member` | aucune | aucune ; insertion par `accept_invitation` via `member_definer_context` (existante, 0009) |
| `app_user` | aucune | nouvelle politique `app_user_definer_self_read` (`SELECT`, `id = current_user_id()`), `GRANT SELECT (id, email)` a `signet_definer` |

Une seule migration `0015_*` (P-1).

**Politiques nouvelles (`TO signet_definer` seulement ; jamais `current_org()`, invariant ADR-0011 R1)**. Postgres exige qu'un `UPDATE ... WHERE` voie la ligne par une politique `SELECT` et `lookup_invitation` est une lecture : la seule **ecriture** nouvelle est l'`UPDATE` borne a l'acceptation (D-103).

| Politique | Table | Commande | Predicat |
|---|---|---|---|
| `invitation_definer_token_lookup` | `invitation` | `SELECT` | `token_hash = decode(nullif(current_setting('app.invitation_token_hash', true), ''), 'hex')` — reglage transitoire pose puis efface par la fonction (patron `subscription_definer_stripe_lookup`, 0012) |
| `invitation_definer_context_read` | `invitation` | `SELECT` | `organization_id = signet.context_org()` |
| `invitation_definer_accept` | `invitation` | `UPDATE` | `USING (organization_id = signet.context_org() AND accepted_at IS NULL)` ; `WITH CHECK (organization_id = signet.context_org() AND accepted_at IS NOT NULL AND accepted_by_user_id = signet.current_user_id())` |
| `app_user_definer_self_read` | `app_user` | `SELECT` | `id = signet.current_user_id()` |

**`signet.lookup_invitation(p_token_hash bytea) RETURNS TABLE (organization_name text, email text, state text)`** :
- premiere instruction : garde d'identite `SG002` si `current_user_id()` est `NULL` (P-4) ; puis efface `app.organization_id` (le contexte ambiant, choisi par l'appelant, est ignore) ;
- `octet_length(p_token_hash) <> 32` ou `NULL` -> aucune ligne ;
- pose `app.invitation_token_hash`, lit la ligne par empreinte, efface le reglage ; aucune ligne -> aucune ligne retournee ;
- pose `app.organization_id` depuis `invitation.organization_id` (valeur de confiance), lit `organization.name` (`organization_definer_context`) ;
- `state` derive (ERD §5) : `pending` | `expired` | `accepted` ; ne revele **que** `organization_name`, `email`, `state` (ni identifiants, ni dates, ni inviteur) ;
- `STABLE`, `SET search_path = pg_catalog, signet, public, pg_temp`, `SET TimeZone = 'UTC'`, tables qualifiees, `REVOKE ALL FROM PUBLIC`, `EXECUTE` a `signet_app` seul.

**`signet.accept_invitation(p_token_hash bytea) RETURNS TABLE (organization_id uuid)`** (P-2 : pas de parametre `user_id`, l'utilisateur est `current_user_id()`, comme `invited_by_user_id` de `create_invitation`) :
- premiere instruction : garde `SG002` si `current_user_id()` est `NULL` ; efface `app.organization_id` ;
- empreinte de longueur differente de 32 -> aucune ligne ;
- retrouve l'organisation de la ligne par empreinte (reglage transitoire, `invitation_definer_token_lookup`), pose `app.organization_id` depuis cette ligne, puis consomme en **un seul enonce conditionnel** (ERD §5), qui re-filtre sur l'empreinte et sur tous les predicats de validite :
  ```sql
  UPDATE public.invitation i
     SET accepted_at = now(), accepted_by_user_id = signet.current_user_id()
   WHERE i.token_hash = p_token_hash
     AND i.accepted_at IS NULL
     AND i.expires_at > now()
     AND i.email = (SELECT lower(u.email) FROM public.app_user u WHERE u.id = signet.current_user_id())
  RETURNING i.organization_id;
  ```
  la lecture prealable ne sert qu'a poser le contexte : elle ne decide rien, toute la decision est dans l'`UPDATE` (pas de fenetre entre verification et ecriture) ;
- aucune ligne -> la fonction retourne zero ligne, sans rien ecrire ;
- une ligne -> `INSERT INTO public.member (organization_id, user_id, role) VALUES (<org>, current_user_id(), 'member')` dans la meme transaction ; `23505` sur `member_org_user_idx` (deja membre) -> la fonction leve `SG008` et **toute** l'operation est annulee : l'invitation reste non consommee (P-5) ;
- `ROW_COUNT` de l'`UPDATE` : 0 ou 1 (index unique sur l'empreinte) ; de l'`INSERT` : leve si `<> 1` ;
- `VOLATILE`, `SET search_path = ...`, `SET TimeZone = 'UTC'` (D-091 : l'`UPDATE` reevalue le `CHECK` de 7 jours), `REVOKE ALL FROM PUBLIC`, `EXECUTE` a `signet_app` seul.

## Contrat d'API
Source : `docs/02-architecture/api-contracts/invitations.ts`, `acceptInvitation`, **amende par la tranche** (D-102 : Q-1, Q-2) avec passage de `contract-guardian`. La route n'est pas encore implementee : l'amendement ne casse aucun client.

| Route | Methode | Entree | Sorties | Role minimal | Idempotent sur |
|---|---|---|---|---|---|
| `/api/invitations/accept` | POST | session better-auth (cookie) + corps `{ token }` ; `password` **retire** du contrat | `200 { organizationId, role: "member" }` | **utilisateur authentifie** (`minRole: "authenticated"`, au lieu de `public`) | non idempotente : usage unique (rejeu -> `409 INVITATION_ALREADY_USED`) |

Erreurs (dans cet ordre d'evaluation) :
- `401 UNAUTHENTICATED` — aucune session valide, ou compte disparu entre la session et l'acceptation (`SG002` / `23503`) ;
- `422 VALIDATION_FAILED` — corps non JSON, `token` absent ou non textuel, champ `token` de plus de 256 caracteres ;
- `404 INVITATION_NOT_FOUND` — jeton inconnu **ou** malforme (pas du base64url, ou decode en autre chose que 32 octets) : corps **identique** dans les deux cas, aucune requete en base pour un jeton malforme ;
- `410 INVITATION_EXPIRED` — empreinte trouvee, non acceptee, `expires_at <= now()` ;
- `409 INVITATION_ALREADY_USED` — empreinte trouvee, `accepted_at` renseigne (y compris le perdant d'une acceptation concurrente) ;
- `403 INVITATION_EMAIL_MISMATCH` — invitation en attente et valide, adressee a une autre adresse que celle du compte connecte ; **message fixe, sans l'adresse** (D-102 Q-2) ;
- `409 ALREADY_MEMBER` — le compte connecte est deja membre de l'organisation (`SG008`) ; invitation non consommee (P-5).

Ordre dans la route : session -> validation Zod -> decodage strict (base64url sans remplissage, 43 caracteres, 32 octets) -> empreinte `sha256(octets)` (D-090) -> transaction `withUserOnly(session.user.id)` : `accept_invitation` ; si zero ligne, `lookup_invitation` dans la meme transaction pour distinguer `404` / `410` / `409` / `403` -> `COMMIT`. La lecture de distinction a lieu **apres** l'echec de la consommation, jamais avant.

## Criteres d'acceptation

Conventions : « jeton » = le secret du lien (32 octets aleatoires, transmis en base64url) ; « empreinte » = `sha256` des **32 octets decodes** (D-090). Les invitations sont emises par la vraie route de 003 et le jeton est relu dans la fausse messagerie (bout en bout), sauf mention « forcee en base » (connexion d'administration). Valeurs inventees a faible entropie, visiblement fausses (usine 1.6.3).

- [ ] AC1 — **Acceptation nominale de bout en bout (US-03.1, D-090)** : l'owner de A emet une invitation par `POST /api/organizations/:A/invitations` ; la fonction d'envoi depose le message dans la fausse messagerie ; le jeton est extrait du lien `#token=` ; l'invite s'inscrit (better-auth, meme adresse en casse differente) et appelle `POST /api/invitations/accept { token }` -> `200 { organizationId: A, role: "member" }`. En base : une ligne `member (A, invite, 'member')` ; l'invitation a `accepted_at` renseigne et `accepted_by_user_id` = l'invite. L'invite est ensuite reconnu comme membre de A par l'API : `PATCH /api/organizations/:A` lui repond `403 INSUFFICIENT_ROLE` (membre sans le role owner), et non plus `404 ORGANIZATION_NOT_FOUND` (non membre) comme avant l'acceptation. Le haché du **texte** base64url du jeton n'est pas l'empreinte stockee (le test prouve que la route hache les octets).
- [ ] AC2 — **Compte existant (US-03.1 « lie un compte existant »)** : un utilisateur deja inscrit, owner de sa propre organisation B, accepte une invitation de A adressee a son adresse -> `200` ; il est `member` de A et reste `owner` de B (deux lignes `member`, `member_single_owner_idx` intact) ; `organizations_for_user` renvoie A et B.
- [ ] AC3 — **Jeton inconnu ou malforme -> 404 identique (ne rien reveler)** : jeton bien forme jamais emis ; chaine vide apres `trim` ; 42 et 44 caracteres ; caracteres hors alphabet base64url (`+`, `/`, `=`, espace) ; base64url decodant 31 ou 33 octets ; texte base64url d'une empreinte stockee (l'empreinte presentee comme jeton) -> `404 INVITATION_NOT_FOUND`, **corps strictement identique** (octet pour octet) pour tous ces cas ; aucune ligne modifiee. Un jeton malforme ne declenche aucun appel a `accept_invitation` (compteur `pg_stat_user_functions` ou equivalent).
- [ ] AC4 — **Expire -> 410, calcul en UTC (US-03.2, D-091)** : invitation dont `expires_at` est force dans le passe (1 seconde) -> `410 INVITATION_EXPIRED`, aucune appartenance, `accepted_at` reste `NULL`. Expiration une seconde dans le futur -> `200`. **Changement d'heure** : une invitation creee le samedi precedant le passage a l'heure d'hiver (Europe/Paris, dernier dimanche d'octobre) et acceptee pendant sa validite, la session Postgres de l'appelant reglee sur `TimeZone = 'Europe/Paris'`, est acceptee sans `23514` ; et une invitation dont `expires_at = created_at + 7 jours` exactement (168 h) est encore acceptable a 167 h 59 et expiree a 168 h, sous le meme fuseau. Catalogue : `accept_invitation` et `lookup_invitation` portent `TimeZone=UTC` dans `proconfig`.
- [ ] AC5 — **Isolation tenant (US-09)** :
  - (a) par l'API : une invitation de A acceptee par l'invite le rend membre de **A seulement** ; aucune ligne `member` ni lecture dans B ; la reponse ne contient aucune donnee de A autre que `organizationId` ;
  - (b) `accept_invitation` sous **contexte etranger force** (en base, sous `signet_app`, `app.organization_id` = B, `app.user_id` = l'invite, jeton d'une invitation de A) : le `member` est cree dans **A** (le contexte ambiant est ignore, celui de la ligne d'invitation fait foi), rien dans B ; avec le jeton d'une invitation de B adressee a quelqu'un d'autre, rien n'est consomme ;
  - (c) `lookup_invitation` sous contexte etranger force : ne renvoie que `organization_name`, `email`, `state` de l'invitation designee par l'empreinte (jamais de ligne de l'organisation du contexte) ; sans empreinte valide, zero ligne ; la liste exacte des colonnes de retour est verifiee au catalogue ;
  - (d) sous `signet_app` avec n'importe quel contexte, `UPDATE invitation` direct est refuse (pas de privilege) et `invitation` de A reste invisible a l'invite devenu member (politiques owner de 003 inchangees).
- [ ] AC6 — **Consommation atomique et concurrence (US-03.3)** : deux `POST /api/invitations/accept` simultanes avec le meme jeton, par le meme invite, depuis deux connexions -> exactement un `200` et un `409 INVITATION_ALREADY_USED` ; une seule ligne `member` ; un seul `accepted_at`. Meme resultat en base avec deux transactions ouvertes appelant `accept_invitation` (la seconde attend le `COMMIT` de la premiere). Rejeu sequentiel du jeton apres succes -> `409 INVITATION_ALREADY_USED`, aucune ligne de plus.
- [ ] AC7 — **Identite de l'invite (D-102 Q-1, Q-2)** : sans session -> `401 UNAUTHENTICATED`, l'invitation reste en attente ; session d'un compte dont l'adresse differe de l'adresse invitee -> `403 INVITATION_EMAIL_MISMATCH`, message fixe qui ne contient ni l'adresse invitee ni celle du compte, aucune appartenance, invitation toujours en attente et acceptable ensuite par le bon compte ; comparaison insensible a la casse (`Alice@Example.TEST` accepte une invitation `alice@example.test`). Le refus d'adresse est porte **par la base** : `accept_invitation` ne consomme rien sous un compte d'une autre adresse, teste directement en base. Le corps de la requete n'accepte plus `password` : un `password` fourni n'a aucun effet (aucun compte cree, aucune connexion).
- [ ] AC8 — **Deja membre (P-5)** : un compte deja membre de A (ligne `member` forcee en base pour l'adresse invitee) accepte -> `409 ALREADY_MEMBER` ; l'invitation reste non consommee (`accepted_at NULL`) ; aucune ligne `member` de plus. L'owner de A qui presente une invitation de A adressee a sa propre adresse (forcee en base) -> meme reponse.
- [ ] AC9 — **Compte disparu** : l'invite se connecte, puis son compte est supprime sous la connexion d'administration avant l'appel -> `401 UNAUTHENTICATED` (session supprimee en cascade), invitation intacte. En base, `accept_invitation` avec un `app.user_id` sans ligne `app_user` ne consomme rien et ne cree aucun `member`. L'inviteur ne peut pas etre supprime tant que l'invitation existe (`RESTRICT`, ERD §5) : constate, pas modifie.
- [ ] AC10 — **Pas d'enumeration** : les reponses `404` (inconnu, malforme) sont identiques ; `410`, `409` et `403` ne sont observables qu'avec un jeton valide de 256 bits ; aucun message d'erreur ne contient l'adresse invitee, le nom de l'organisation, un identifiant interne ou un code SQL ; `lookup_invitation` n'est exposee par aucune route. Les messages sont fixes (test sur la liste exacte des corps d'erreur).
- [ ] AC11 — **Le jeton ne fuit nulle part (ADR-0003, ADR-0017)** : pendant chaque scenario d'AC1 a AC9, le jeton (et ses formes hexadecimale et base64 standard) est absent : des reponses HTTP, des journaux du processus de test et du serveur de test (console espionnee / sortie capturee), des messages d'erreur, de toutes les colonnes des lignes `invitation` et `member`. Le jeton n'est accepte que dans le **corps** : la route n'a aucun segment dynamique (aucun dossier `[...]` sous `api/invitations/accept`), et un jeton passe en `?token=` est ignore (`422`, corps sans `token`).
- [ ] AC12 — **Fonctions et catalogue (D-033, ADR-0011)** : l'ensemble des fonctions `prosecdef` du schema `signet` est exactement celui d'avant la migration plus `lookup_invitation(bytea)` et `accept_invitation(bytea)` ; les deux appartiennent a `signet_definer`, figent `search_path` (`pg_temp` en dernier) et `TimeZone=UTC`, ne sont executables ni par `PUBLIC`, ni par `signet_auth`, `signet_billing`, `signet_owner` ; les deux levent `SG002` sans `app.user_id` ; les nouvelles politiques sont `TO signet_definer` seulement et n'appellent pas `current_org(` ; les invariants de catalogue de 010 restent verts sans modification ; les privileges de `signet_app` sur `invitation` restent `SELECT, INSERT, DELETE`.
- [ ] AC13 — **Seule ecriture nouvelle : un UPDATE borne a l'acceptation (condition de Q-3, D-103)** : test de catalogue sur `invitation` pour `signet_definer` :
  - (a) privileges de table : `SELECT` seulement au niveau table ; `UPDATE` accorde sur **exactement** les colonnes `accepted_at` et `accepted_by_user_id` (`has_column_privilege` vrai pour elles, faux pour chacune des autres colonnes) ; ni `INSERT`, ni `DELETE`, ni `TRUNCATE` ;
  - (b) politiques applicables a `signet_definer` : exactement trois, `invitation_definer_token_lookup` et `invitation_definer_context_read` en `SELECT` (`polcmd = 'r'`), `invitation_definer_accept` en `UPDATE` (`polcmd = 'w'`) ; aucune politique `ALL`, `INSERT` ni `DELETE` ;
  - (c) `invitation_definer_accept` : `USING` contient `context_org()` et `accepted_at IS NULL` ; `WITH CHECK` contient `context_org()`, `accepted_at IS NOT NULL` et `accepted_by_user_id = signet.current_user_id()` ;
  - (d) comportement, sous un role de test autorise a `SET ROLE signet_definer` ou par une fonction de test equivalente creee sous la connexion d'administration : un `UPDATE` d'une ligne deja acceptee, d'une autre colonne (`email`, `expires_at`, `organization_id`), ou qui pose `accepted_by_user_id` a un autre utilisateur que `current_user_id()` est refuse. Si ce volet ne peut pas etre teste sans modifier les roles (ADR-0007 : aucune appartenance), il est remplace par les volets (a) a (c) et la limite est ecrite dans le journal de tranche.
- [ ] AC14 — **Dependances et environnement** : aucune dependance ajoutee (verification **ponctuelle**, ecrite dans la fiche de preuves, aucun test qui compare a `main` en permanence, usine 1.6.4 / D-099) ; aucune variable d'environnement nouvelle (la route ne lit pas `INVITATION_TOKEN_KEY`).

## Doublures de test
Aucun appel reseau reel. Reprises de 003, importees telles quelles : fausse messagerie (`tests/invitations/fakes/fake-mailbox.ts`), faux Inngest (`tests/billing/fakes/fake-inngest.ts`), execution de la fonction d'envoi par `@inngest/test` pour obtenir le jeton reel (AC1, AC2, AC6). Inscription et connexion par les routes better-auth reelles (limiteur coupe en `APP_ENV=test`, ADR-0010).

## Anti-regression
- Suites 001, 002, 010, 011, `tests/_factory/*` et 003 vertes **sans modifier leurs assertions**, a **une exception acceptee (D-102 Q-3, regle D-065 n°2)** : `tests/invitations/database.test.ts`, test « AC15 : invitation a la RLS activee ET forcee, aucune politique TO PUBLIC, aucune politique signet_definer, aucun UPDATE ». Il affirme que toutes les politiques de `invitation` sont `TO signet_app` et que les commandes sont `SELECT, INSERT, DELETE` : 003 l'a ecrit comme etat de fin de 003 (son message dit « UPDATE : tranche 006 »). Modification : restreindre ces assertions aux politiques applicables a `signet_app` (memes verifications, inchangees, y compris l'absence de politique `TO PUBLIC` sur toute la table) ; les politiques `signet_definer` sont verifiees par AC13. Le test des privileges de `signet_app` reste inchange et doit rester vert.
- `contract-guardian` : `invitations.ts` modifie uniquement dans `acceptInvitation` (D-102) ; `createInvitation` inchange.
- Emission (003) : aucun fichier de la route d'emission ni de la fonction d'envoi n'est modifie ; si un utilitaire de `lib/invitations/token.ts` est extrait (decodage), ses usages de 003 restent couverts par les tests de 003 inchanges.

## Notes d'implementation
- Decodage strict : `^[A-Za-z0-9_-]{43}$` puis `Buffer.from(token, "base64url")`, longueur 32 exigee ; AC3 couvre les entrees que `Buffer.from` tolere (caracteres ignores, remplissage). Comparaison en base par egalite d'empreinte (aucune comparaison de secret en clair).
- Le jeton n'existe en clair que dans le gestionnaire de la route, le temps de le decoder : jamais journalise, jamais dans un message d'erreur, jamais passe a Postgres (seule l'empreinte l'est). Les erreurs `pg` inattendues sont journalisees par leur `code` seulement.
- Erreurs metier typees (`Result`) : `InvitationNotFound`, `InvitationExpired`, `InvitationAlreadyUsed`, `InvitationEmailMismatch`, `AlreadyMember` ; `throw` seulement pour l'inattendu.
- Traduction des codes : `SG002` et `23503` -> `401` ; `SG008` -> `409 ALREADY_MEMBER` ; tout autre code -> `500` generique sans detail.
- Point de sauvegarde autour de `accept_invitation` (patron D-092) pour que `SG008` n'annule pas la lecture de distinction et que `withUserOnly` valide une transaction qui n'a rien ecrit.
- Rien n'est ecrit dans `session` (organisation active) : l'invite choisira l'organisation dans l'ecran (012).

## Decisions du gate d'ouverture
Humain, **D-102** (recommandations de claude-code et de l'orchestrateur retenues) :
- **Q-1 — option A** : session better-auth obligatoire ; l'invite sans compte s'inscrit d'abord par la route d'inscription existante ; adresse du compte egale a l'adresse invitee (insensible a la casse), verifiee par la base ; `password` retire du contrat ; limite des adresses non verifiees ecrite dans ADR-0018. Ecartes : A' (session sans correspondance d'adresse : un lien transfere fait entrer n'importe quel compte) ; B (creation de compte dans la requete : pas de champ `name`, deux connexions donc compte orphelin si l'acceptation echoue, contournement du limiteur d'inscription) ; C (ne tient pas « lie un compte existant »).
- **Q-2** — `403 INVITATION_EMAIL_MISMATCH`, message fixe sans l'adresse. Ecarte : `404 INVITATION_NOT_FOUND` (l'invite ne comprend pas le refus).
- **Q-3** — acceptee : test AC15 de 003 restreint aux politiques de `signet_app` (regle D-065 n°2), a condition d'un test prouvant que la seule ecriture nouvelle de `signet_definer` sur `invitation` est un `UPDATE` borne a l'acceptation (AC13). Ecarte : modification par l'humain (precedent D-099), plus lente pour le meme diff.
- **P-1 a P-7** acceptees :
  - **P-1** — une seule migration `0015_*`, creee par `drizzle-kit generate --custom`. Ecarte : deux migrations.
  - **P-2** — `accept_invitation(p_token_hash)` sans parametre `user_id` (`current_user_id()`), ERD §1 amende. Ecarte : signature `(token_hash, user_id)` avec garde d'egalite.
  - **P-3** — rapprochement d'adresse porte par la base (`app_user_definer_self_read`, `SELECT (id, email)`). Ecarte : comparaison dans la route seule.
  - **P-4** — `lookup_invitation` exige un utilisateur de session (`SG002`) ; a rouvrir par 012 si l'invitation doit s'afficher avant connexion. Ecarte : lookup anonyme des maintenant.
  - **P-5** — deja membre : `409 ALREADY_MEMBER`, invitation non consommee. Ecartes : `200` sans effet ; consommation sans `member`.
  - **P-6** — pas de limiteur sur la route d'acceptation (jeton de 256 bits, session exigee, inscription et connexion deja limitees) ; au backlog, obligatoire si P-4 est rouvert. Ecarte : etendre le limiteur memoire de better-auth a une route Next.
  - **P-7** — ADR-0018 « Identite de l'invite a l'acceptation ».

Humain, **D-103** : la condition de Q-3 (« la seule politique nouvelle de `signet_definer` est un `UPDATE` ») est impossible a la lettre, Postgres exigeant une politique `SELECT` pour qu'un `UPDATE ... WHERE` voie la ligne, et `lookup_invitation` etant une lecture. Reformulee : la seule **ecriture** nouvelle est l'`UPDATE` des deux colonnes d'acceptation, les autres politiques nouvelles sont des lectures (AC13).
