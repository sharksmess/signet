# 012 — Ecrans

> **Statut : ouverte le 2026-10-28**, contrat valide par l'humain (D-144), selon `docs/04-runbooks/consigne-tranche-012.md` (objectif A, D-083, D-130, D-136, D-137). Premiere tranche d'interface, menee avec l'humain (pas en mode autonome). La PR n'est fusionnee qu'apres la visite guidee, resultat consigne par l'humain (AC17).

## Capacite
En tant qu'utilisateur, je m'inscris (avec mon organisation) ou me connecte, je vois mes organisations et en cree une, j'ouvre la page d'une organisation (collections, membres ; palier et invitation si je suis owner), j'ouvre une collection pour lire et ajouter des liens, et j'accepte une invitation depuis le lien recu par e-mail — dans un navigateur, en francais, sans jamais voir une donnee d'une organisation dont je ne suis pas membre (US-01 a US-03, US-05 a US-09).

## Perimetre
- **Touche** :
  - pages Next (App Router, composants serveur par defaut) sous `apps/web/src/app/` : accueil, connexion, inscription, mes organisations, organisation, collection, acceptation d'invitation, page introuvable, gabarit commun ;
  - composants d'interface et fonctions pures d'affichage sous `apps/web/src/ui/` (formulaires clients, texte visible, lien sur, table des messages fixes, construction des requetes, lecture de session pour les pages) ;
  - contrat `docs/02-architecture/api-contracts/organizations.ts` : **etiquette seulement** (D-143) : `minRole` de `createOrganization` et `listMyOrganizations` de `"public"` a `"authenticated"`, commentaire « toute session valide » aligne ; aucun autre changement ;
  - tests `tests/screens/**`, `tests/helpers/screens*.ts` ;
  - `docs/04-runbooks/recette-012.md` (visite guidee), backlog, registre, journal de projet 24, index du journal.
- **NE touche PAS** :
  - **aucun travail serveur nouveau** (consigne point 1, D-144 Q-2) : aucune route d'API creee ou modifiee (`apps/web/src/app/api/**` intact), aucun module de `apps/web/src/lib/**` modifie, aucune migration, aucune fonction `SECURITY DEFINER`, aucun privilege, aucune politique, aucune variable d'environnement, **aucune Server Action**, aucun `middleware`/`proxy` ; si l'un de ces points devient necessaire : **arret** et question a l'humain ;
  - **aucune dependance nouvelle** (D-137 point 2) : React, Next et `better-auth` installes ; pas de client `better-auth/react` non plus (appels `fetch` directs) ; aucune bibliotheque de style, aucun robot de navigateur (Playwright au backlog, D-137 point 1) ;
  - contrats d'API autres que l'etiquette D-143 ;
  - changement de palier (vrais paiements hors objectif A), retrait d'un membre (008), suppression d'une collection (007), renommage d'organisation (aucun ecran demande par D-137), organisation active en session (`session.active_organization_id`, backlog de 006), lecture d'invitation sans session (P-4 reste ferme, donc P-6 n'est pas declenche), liste des invitations en attente, renvoi d'invitation, pagination, compteur de liens restants (aucune lecture ne l'expose), champ « nom » de l'utilisateur (D-144 Q-1), controle de l'origine des routes d'ecriture (backlog, D-144 Q-2), mise en page soignee (consigne point 10) ;
  - gardes d'environnement (`EMAIL_CAPTURE_URL`, `STRIPE_API_BASE_URL`, `AUTH_RATE_LIMIT` restent reserves a `APP_ENV=test`) ; aucun fournisseur d'e-mail.

## Perimetre de fichiers
Declare dans `.gates/scope-012.txt` (source de verite du hook) : documentation de la tranche, `docs/02-architecture/api-contracts/organizations.ts` (D-143), `apps/web/src/app/*.tsx`, `apps/web/src/app/*.css`, `apps/web/src/app/connexion/*`, `apps/web/src/app/inscription/*`, `apps/web/src/app/organisations/**`, `apps/web/src/app/invitations/**` (ne couvre pas `app/api/invitations/**`), `apps/web/src/ui/**`, `tests/screens/**`, `tests/helpers/screens*.ts`. Aucun fichier de `apps/web/src/app/api/`, de `apps/web/src/lib/`, de `packages/`, aucun test des tranches precedentes.

## Dependances
- Tranches devant etre closes avant celle-ci : 001 a 006, 009 et 013 (closes et fusionnees, derniere : PR #38, commit c2a557d).
- **Aucune dependance nouvelle.**

## Commandes d'echafaudage prevues
Aucune : pas de `create-next-app`, pas de `pnpm add`, pas de `pnpm db:generate`. Verification apres coup par `git status --short`.

## Contrat de donnees
Aucun changement. Les pages lisent **cote serveur, par les fonctions existantes** (memes controles que les routes : session, appartenance, filtre tenant explicite, RLS) :

| Lecture | Fonction existante | Contrat |
|---|---|---|
| session | `auth.api.getSession({ headers })` (`lib/auth.ts`) | better-auth |
| mes organisations | `listMyOrganizations(userId)` (`lib/organizations.ts`) | `listMyOrganizations` |
| membres et role de l'appelant | `listMembers({ userId, organizationId })` (`lib/members/members.ts`) | `listMembers` |
| palier (owner seulement) | `getSubscription({ userId, organizationId })` (`lib/billing/subscriptions.ts`) | `getSubscription` |
| collections | `listCollections({ userId, organizationId })` (`lib/collections/collections.ts`) | `listCollections` |
| liens | `listLinks({ userId, organizationId, collectionId })` (`lib/links/links.ts`) | `listLinks` |

`userId` vient **toujours** de la session, jamais de l'adresse ; les identifiants du chemin passent par le schema du contrat (`Uuid`) puis en minuscules, comme dans les routes. Les valeurs enregistrees ne sont jamais modifiees : toute transformation d'affichage (L-8) est faite a la lecture, cote serveur.

## Ecrans
« Prive » = session exigee ; sans session ou cookie invalide : renvoi `307` vers `/connexion`, **sans parametre de retour** (L-2), sans aucune donnee dans la reponse.

| Chemin | Acces | Lit (serveur) | Actions | Route appelee (navigateur, `fetch` JSON) |
|---|---|---|---|---|
| `/` | tous | session | aucune | renvoi : `/organisations` si session, `/connexion` sinon |
| `/connexion` | public (avec session : renvoi `/organisations`) | session | se connecter | `POST /api/auth/sign-in/email` (better-auth), puis `/organisations` |
| `/inscription` | public (avec session : renvoi `/organisations`) | session | s'inscrire avec son organisation (D-144 Q-1) | `POST /api/auth/sign-up/email` (`name` = adresse), puis `POST /api/organizations` ; succes : page de l'organisation ; echec de la creation : `/organisations?creation=echec` (L-10) |
| `/organisations` | prive | `listMyOrganizations` | ouvrir une organisation ; creer une organisation ; se deconnecter | `POST /api/organizations`, puis page de l'organisation creee ; `POST /api/auth/sign-out` |
| `/organisations/[organizationId]` | prive, membre | `listMyOrganizations` (nom), `listMembers` (membres, role de l'appelant), `listCollections` ; **owner seul** : `getSubscription` | creer une collection ; **owner seul** : inviter | `POST /api/organizations/:id/collections` ; `POST /api/organizations/:id/invitations` |
| `/organisations/[organizationId]/collections/[collectionId]` | prive, membre | `listMyOrganizations` (nom), `listCollections` (nom de la collection), `listLinks`, `listMembers` (adresse de l'auteur) | ajouter un lien | `POST /api/organizations/:id/collections/:cid/links` |
| `/invitations/accept` (impose par l'e-mail de 003) | public (coquille sans donnee) | session (oui/non, adresse du compte connecte) | accepter ; sans session : se connecter ou s'inscrire **sur la meme page**, sans organisation | `POST /api/invitations/accept` (jeton dans le corps seulement) ; better-auth pour connexion, inscription (`name` = adresse), deconnexion |

Ordre d'affichage = ordre des lectures, jamais retrie par la page : organisations `created_at DESC, id DESC` ; collections `created_at DESC, id DESC` ; liens `created_at DESC, id DESC` ; membres date d'arrivee croissante puis `user_id`.

Apres une ecriture reussie, la page relit ses donnees cote serveur (`router.refresh()`) ; aucune donnee de la reponse d'ecriture n'est affichee directement (L-3).

### Contenu par page
- **Inscription** (D-144 Q-1) : adresse, mot de passe, nom de l'organisation ; aucun autre champ (`name` de better-auth = l'adresse). La page envoie l'inscription, puis **une seule** creation d'organisation. Si l'inscription echoue : message fixe sur la page, aucune creation tentee. Si la creation echoue apres une inscription reussie (session ouverte) : navigation vers `/organisations?creation=echec`, qui affiche un message fixe (« Votre compte est cree, mais l'organisation n'a pas pu l'etre. Creez-la ci-dessous. ») et le formulaire de creation ; **aucune nouvelle tentative automatique**. La valeur du parametre n'est jamais reprise : le message s'affiche si et seulement si elle vaut exactement `echec`.
- **Organisation** : nom ; collections (nom, lien vers la page) ; membres (adresse, role) ; formulaire « Nouvelle collection ». **Owner seul** : bloc « Palier » (`Free`/`Pro`, statut, annulation programmee, fin de periode si `Pro`) et formulaire « Inviter » (adresse). Un member ne recoit ni le bloc, ni le formulaire, ni leurs donnees (`getSubscription` n'est pas appele) : ni dans le HTML, ni dans les donnees embarquees de Next (charge RSC). Le role est lu dans `listMembers` (ligne de l'appelant), jamais dans l'adresse.
- **Collection** : nom de l'organisation et de la collection ; liens : titre, nom d'hote (a part), URL en texte, auteur (adresse lue dans `listMembers` ; « ancien membre » si absent, L-4), date (UTC, format fixe `AAAA-MM-JJ HH:MM UTC`, L-5) ; formulaire « Ajouter un lien » (URL, titre).
- **Acceptation** : le navigateur lit `#token=` dans le fragment. Sans jeton dans le fragment : message fixe « Lien d'invitation incomplet », aucun appel. Avec session : adresse du compte connecte, bouton « Accepter l'invitation » (clic explicite, aucun envoi automatique, L-6), bouton « Se deconnecter » (changer de compte). Sans session : formulaires de connexion et d'inscription (sans organisation) **incorpores a la page** ; apres succes, la page se rafraichit **sans changer d'adresse** (le fragment reste en place) et propose le bouton. Apres acceptation : le fragment est efface de l'historique (`history.replaceState`), puis navigation vers la page de l'organisation (`organizationId` de la reponse). Aucune donnee d'invitation (nom d'organisation, adresse invitee) avant l'acceptation : P-4 ferme.

### Messages d'erreur (consigne point 7)
Le texte affiche appartient a une **liste fermee de textes fixes** (`apps/web/src/ui/messages.ts`) : pour un code d'erreur d'un contrat, le texte fixe de la route (`lib/errors.ts` et constantes des routes, recopies) ; si la reponse ne porte pas un texte de cette liste (cas des `422` de `createOrganization` et `createInvitation`, qui renvoient le message de Zod), un texte fixe propre au formulaire. **Jamais la valeur soumise, jamais le message brut de la reponse s'il n'est pas dans la liste.**

| Formulaire | Code (statut) | Texte affiche |
|---|---|---|
| Connexion | `401` better-auth | « Adresse ou mot de passe incorrect. » |
| Connexion, inscription | `429` | « Trop de tentatives. Reessayer dans quelques minutes. » |
| Inscription | compte existant (code better-auth a relever par les tests) | « Un compte existe deja pour cette adresse. » |
| Inscription | autre refus de better-auth | « Adresse e-mail invalide, ou mot de passe trop court (8 caracteres minimum). » |
| Inscription | creation d'organisation en echec | navigation `/organisations?creation=echec` (ci-dessus) |
| Creer une organisation | `422 VALIDATION_FAILED` | « Nom d'organisation invalide : 1 a 120 caracteres, espaces de bord exclus. » |
| Creer une collection | `422`, `409 COLLECTION_NAME_TAKEN` | texte fixe de la route (« Nom de collection invalide : ... », « Une collection de cette organisation porte deja ce nom. ») |
| Inviter | `422` | « Adresse e-mail invalide. » |
| Inviter | `409 INVITATION_ALREADY_PENDING`, `409 ALREADY_MEMBER`, `503 SERVICE_UNAVAILABLE`, `403 INSUFFICIENT_ROLE` | texte fixe de `lib/errors.ts` |
| Ajouter un lien | `422` (URL, titre), `409 FREE_TIER_QUOTA_EXCEEDED`, `404 COLLECTION_NOT_FOUND` | texte fixe de la route (« URL invalide : ... », « Titre invalide : ... », « Le quota de liens du palier Free est atteint : aucun lien n'a ete ajoute. Passer au palier Pro pour en ajouter d'autres. », « Collection introuvable. ») ; `422` dont le message n'est pas dans la liste : « URL ou titre invalide. » (D-147) |
| Accepter | `404`, `410`, `409 INVITATION_ALREADY_USED`, `403 INVITATION_EMAIL_MISMATCH`, `409 ALREADY_MEMBER`, `422` | texte fixe de `lib/errors.ts` (`422` : « Lien d'invitation invalide. ») ; `403` : propose « Se deconnecter » ; `409 ALREADY_MEMBER` : lien vers `/organisations` |
| Tous les formulaires prives | `401` | « Session expiree. » et lien vers `/connexion` (sur la page d'acceptation : retour aux formulaires incorpores) |
| Tous | `404 ORGANIZATION_NOT_FOUND` | « Organisation introuvable. » |
| Tous | autre statut, reseau | « Une erreur est survenue. Reessayer. » |

Pendant un envoi, le bouton est desactive (double clic : un seul envoi depuis la page ; le serveur reste l'autorite, 409 sinon).

## Contrat d'API
Aucune route nouvelle ni modifiee. Routes **appelees** par les pages, telles que contractualisees : `createOrganization`, `listMyOrganizations`, `listMembers`, `getSubscription`, `createInvitation`, `acceptInvitation`, `createCollection`, `listCollections`, `addLink`, `listLinks`, et les routes better-auth `sign-up/email`, `sign-in/email`, `sign-out`. Les lectures des pages passent par les memes fonctions que les routes `GET`, cote serveur (pas d'appel HTTP du serveur vers lui-meme).

Seule modification de `api-contracts/` : D-143 (etiquette `minRole` `"authenticated"` de `createOrganization` et `listMyOrganizations`, commentaire aligne) ; comportement inchange (`401` sans session, deja teste par 001 et 013).

## Criteres d'acceptation
Conventions : utilisateurs et organisations crees par les vraies routes ; member obtenu par le **parcours d'invitation reel** (003 puis 006, fausse messagerie du serveur de test) ; pages lues par `fetch` sur le serveur de test existant (meme `globalSetup`, build de production), avec le cookie de session ; « reponse complete » = le HTML **et** la charge RSC de la meme page (requete avec l'en-tete `RSC: 1`) ; comportement des formulaires prouve par leurs fonctions pures (aucun navigateur, D-137 point 1) ; valeurs inventees visiblement fausses (domaines `.invalid`, noms « Org-Test-... ») ; aucun test ne compare la branche a `main` (D-099).

**Acces, inscription et navigation**
- [ ] AC1 — **Sans session** : `/`, `/organisations`, la page d'une organisation et celle d'une collection (identifiants reels d'une autre session) renvoient `307` vers `/connexion`, `Location` sans parametre ni fragment ; la reponse ne contient aucun nom, adresse ni identifiant d'organisation, de collection ou de lien, **hormis les identifiants que contient l'adresse demandee** (Next les reprend dans le corps du `307`) ; la reponse `307` (statut, en-tete `Location`, corps, ces identifiants mis a part) est **identique** pour un identifiant existant et pour un identifiant inexistant : le renvoi ne revele rien sur l'existence de la ressource (D-148 point 1). Cookie invalide : meme resultat. `/connexion`, `/inscription` et `/invitations/accept` repondent `200` sans session ; avec session, `/`, `/connexion` et `/inscription` renvoient vers `/organisations`.
- [ ] AC2 — **Inscription avec organisation (D-144 Q-1)** : (a) la page `/inscription` sert exactement trois champs (adresse, mot de passe, nom de l'organisation) ; (b) l'enchainement (fonction pure, `fetch` injecte) envoie `sign-up/email` avec `name` = l'adresse, puis **un seul** `POST /api/organizations` avec le nom saisi, et rend la page de l'organisation creee ; (c) inscription refusee : aucune creation tentee, texte fixe ; (d) creation refusee ou en erreur apres inscription reussie : **aucune seconde tentative** (un seul appel compte), destination `/organisations?creation=echec` ; (e) par le serveur : `/organisations?creation=echec` d'un compte sans organisation affiche le message fixe et le formulaire de creation ; toute autre valeur du parametre (dont une valeur piegee) n'affiche pas le message et n'apparait nulle part dans la reponse ; (f) de bout en bout par les vraies routes : un compte inscrit puis son organisation creee voit cette organisation dans `/organisations`, comme owner.
- [ ] AC3 — **Mes organisations** : la page liste exactement les organisations de `listMyOrganizations` de l'appelant, dans son ordre, chacune avec un lien vers `/organisations/<id>` ; etat vide explicite si aucune ; formulaire de creation present. Une organisation d'un autre utilisateur n'y figure pas ; `?userId=<autre>` ne change rien : liste affichee identique (memes organisations, dans le meme ordre, aucune de l'autre utilisateur), l'echo de l'adresse demandee que Next place dans la charge (`"q"`, `"c"`) mis a part (D-148 point 2).

**Roles (consigne point 3)**
- [ ] AC4 — **Owner** : la page de son organisation affiche le nom, les collections (ordre de `listCollections`), les membres (ordre de `listMembers`, role), le bloc « Palier » (valeurs de `getSubscription` : `Free`, `active`) et le formulaire d'invitation.
- [ ] AC5 — **Member** : la page de la meme organisation affiche nom, collections et membres identiques a ceux de l'owner, et **ni** le bloc « Palier », **ni** le formulaire d'invitation : la reponse complete ne contient ni leurs libelles ni leurs marqueurs (`data-testid`), ni `tier`, `status`, `cancelAtPeriodEnd`, `currentPeriodEnd`. `?role=owner` (et tout autre parametre) ne change rien : reponse identique a celle sans parametre.

**Isolation (consigne point 4, US-09)**
- [ ] AC6 — **Organisation d'autrui** : la page d'une organisation dont l'appelant n'est pas membre repond `404`, avec une reponse complete **identique** a celle d'un UUID inexistant (comparaison apres remplacement de l'identifiant demande par un jeton fixe) et a celle d'un identifiant malforme (L-7) ; le statut `404` est exige sur le HTML ; la charge RSC (que Next sert en `200`, l'introuvable etant code dans son contenu) est identique a celle d'un identifiant inexistant et ne contient aucune donnee de l'autre organisation (D-148 point 3, vaut aussi pour AC7) ; elle ne contient aucun nom, adresse ni identifiant de cette organisation, de ses collections ou de ses membres.
- [ ] AC7 — **Collection d'autrui** : `/organisations/<A>/collections/<collection de B>` pour un membre de A seul, et pour un membre de A **et** de B (le chemin fait autorite), repond `404` identique a une collection inexistante de A ; la collection de B sous son propre chemin, pour un non-membre de B : `404` identique a AC6. Aucun titre, URL, nom ni adresse de B dans la reponse complete.

**Affichage sur (consigne point 5, L-8)**
- [ ] AC8 — **Valeurs piegees** : avec un nom d'organisation, un nom de collection, un titre et un chemin d'URL contenant `<script>alert(1)</script>`, `"><img src=x onerror=alert(1)>`, `javascript:alert(1)` (titre), U+202E, U+200B et un titre fait du seul U+200B : (a) **HTML** de la page, donnees embarquees de Next comprises : aucune de ces suites n'y apparait non echappee ; (b) **charge RSC separee** (requete `RSC: 1`, ou une chaine JSON contient le `<script>` brut par construction) : aucune cle `__html`, jamais servie comme du HTML (type de contenu verifie exactement : `text/x-component`), aucun caractere invisible ou bidirectionnel brut. Aucun `dangerouslySetInnerHTML` dans `apps/web/src` (verification de source). Interpretation de `test-writer` validee par l'humain (D-146 point 2).
- [ ] AC9 — **Marqueurs (liste fermee, L-8)** : chacun des caracteres de la liste (U+202A a U+202E, U+2066 a U+2069, U+200E, U+200F, U+061C, U+200B, U+2060, U+FEFF) present dans un nom ou un titre enregistre est rendu par son marqueur `[U+XXXX]` et n'apparait **sous aucune forme brute** dans la reponse complete (HTML et charge RSC) ; la valeur en base est inchangee (relue apres affichage). Un emoji compose avec U+200D (ex. U+1F469 U+200D U+1F4BB) s'affiche **intact**, sans marqueur. Test direct de la fonction pure : chaque caractere de la liste marque, U+200D et un caractere ordinaire non marques.
- [ ] AC10 — **Liens** : chaque lien est un `<a>` avec `href` = forme normalisee de l'URL (`new URL(url).href`, caracteres non ASCII encodes en `%XX`), `target="_blank"`, `rel="noopener noreferrer"` ; le nom d'hote est affiche a part, en punycode (un hote IDN `xn--...` est montre tel quel) ; une valeur dont le schema relu n'est pas `http:`/`https:` (fonction pure, testee directement) est affichee en texte, sans `href`. Aucune valeur libre dans un autre attribut que `href` (titre, noms et adresses absents de tout attribut).

**Jeton d'invitation (consigne point 6)**
- [ ] AC11 — **Le jeton ne quitte pas le fragment** : la reponse de `/invitations/accept` est identique avec et sans `?token=<jeton reel>` (l'echo de l'adresse demandee que Next place dans la charge, `"q"` et `"c"`, mis a part), et ne contient ni nom d'organisation ni adresse invitee (P-4) ; la page ignore entierement `?token=` : un jeton **valide** place dans `?token=` n'est jamais envoye dans la requete d'acceptation et ne consomme jamais l'invitation (test : invitation toujours en attente apres l'affichage de la page avec `?token=<jeton valide>`) ; seul le fragment `#token=` est lu (D-148 point 2) ; les fonctions pures de la page sont testees : jeton lu dans le fragment seulement, requete d'acceptation = `POST /api/invitations/accept` avec le jeton **dans le corps** seulement ; verification de source : le module client n'ecrit le jeton ni dans une adresse (`router.push`, `href`, `location`, parametre), ni dans un stockage (`localStorage`, `sessionStorage`, cookie), ni dans un journal (`console`). Sans session, la page sert les formulaires de connexion et d'inscription incorpores (aucun lien ni renvoi vers `/connexion`), l'inscription sans champ d'organisation.
- [ ] AC12 — **Parcours reel** : apres invitation (003) et acceptation (006) par les vraies routes, `/organisations` de l'invite liste l'organisation et sa page montre la vue member d'AC5. Chaque code d'erreur du contrat `acceptInvitation` a un texte fixe dans la table des messages (test de la table).

**Formulaires (consigne point 7, D-144 Q-2)**
- [ ] AC13 — **Soumission depuis un autre site** : le cookie de session pose par la connexion **et** par l'inscription porte `HttpOnly` et `SameSite=Lax` ; une ecriture sans cookie (forme d'une soumission inter-sites) recoit `401` et ne modifie rien. Limite (origine du meme site) ecrite au contrat et au backlog. **Clause retiree (D-146 point 1)** : « better-auth refuse une connexion d'`Origin` etrangere (`403`) ». Raison : Vitest pose `TEST=true`, herite par le serveur de test (`serverEnv()` transmet `process.env`) ; better-auth tient alors `isTest()` pour vrai et saute son controle d'origine. Le controle est actif hors tests (`TEST` absente) mais n'est prouve nulle part ; correction d'usine 1.6.5 puis retablissement du test dans Signet, au backlog (`000-backlog.md`, « Issus de la tranche 012 »).
- [ ] AC14 — **Messages fixes** : la fonction de choix du message (pure) rend, pour chaque formulaire et chaque code de la table, le texte fixe attendu ; une reponse dont le message contient la valeur soumise, ou un texte hors liste, donne le texte fixe du formulaire, jamais ce message.

**Cadre**
- [ ] AC15 — **Aucun travail serveur, aucune dependance** : aucun fichier de `apps/web/src/app/api/`, `apps/web/src/lib/`, `packages/` modifie, aucune migration, aucune dependance, aucune variable d'environnement ; seul changement d'`api-contracts/` : D-143. Verification **ponctuelle**, ecrite dans la fiche de preuves (aucun test permanent qui compare a `main`).
- [ ] AC16 — **Non-regression** : suites 001 a 006, 009, 010, 011, 013 et `tests/_factory/*` vertes sans modifier leurs assertions ni leurs fichiers ; `pnpm run check` et `pnpm run build` verts.
- [ ] AC17 — **Visite guidee** : `docs/04-runbooks/recette-012.md` (liste a cocher, environ 15 minutes, prerequis exacts renvoyant a `stripe-facturation-locale.md` § 1 etape 4 et a `env-check.ps1`, sans aucune valeur) ; ce qui n'est pas faisable sur le poste (reception de l'e-mail d'invitation, donc acceptation reelle et vue member) est dit comme tel et renvoie aux tests automatiques ; resultat consigne par l'humain dans la fiche de preuves **avant** la fusion.

Cas limites couverts : etat vide (aucune organisation, collection, lien), doublon (`COLLECTION_NAME_TAKEN`, `INVITATION_ALREADY_PENDING`, compte existant), quota (`FREE_TIER_QUOTA_EXCEEDED`), expiration (`INVITATION_EXPIRED`), concurrence (double clic : bouton desactive ; double acceptation : `INVITATION_ALREADY_USED`), permission insuffisante (vue member, `INVITATION_EMAIL_MISMATCH`), echec partiel (inscription reussie, organisation non creee), valeur absente (jeton absent du fragment, auteur qui n'est plus membre, URL non relisible).

## Anti-regression
- Toutes les suites existantes vertes sans modification (AC16).
- `contract-guardian` : seul changement `minRole` D-143 et commentaire ; aucune route modifiee.

## Notes d'implementation
- **Composants serveur par defaut** ; un composant client (`"use client"`) ne recoit en props **que** des identifiants, des booleens et des textes fixes, jamais un texte libre ni une donnee reservee a l'owner (`rules/nextjs.md` : les props sont serialisees dans le HTML). Le bloc « Palier » et le formulaire d'invitation ne sont rendus (et `getSubscription` n'est appele) que si le role lu est `owner`. Exception bornee : l'adresse du compte connecte sur la page d'acceptation, passee **marquee** (L-8), c'est la donnee de l'appelant lui-meme.
- **Statuts** : `redirect()` et `notFound()` appeles avant tout rendu ; **pas de `loading.tsx` ni de `<Suspense>`** autour des lectures, sinon Next envoie `200` avant de savoir (et la page introuvable perdrait son statut `404`). Une seule page introuvable (`app/not-found.tsx`), sans texte libre.
- **Texte visible** (`ui/visible-text.ts`, fonction pure, L-8) : liste **fermee** — controles bidirectionnels U+202A a U+202E, U+2066 a U+2069, U+200E, U+200F, U+061C ; largeur nulle U+200B, U+2060, U+FEFF — remplaces par `[U+XXXX]` (hexadecimal majuscule, 4 chiffres). **U+200D n'est pas marque** (il compose les emojis). Appliquee **cote serveur, avant de transmettre aux composants** (donnees embarquees comprises), a tout texte libre affiche (noms, titres, URL en texte, adresses) ; React echappe le reste. Valeur enregistree inchangee. Titre de page (`<title>`) fixe, sans valeur libre.
- **Lien sur** (`ui/safe-link.tsx`) : `URL.canParse`, schema `http:`/`https:` relu, `href = new URL(url).href`, hote `new URL(url).hostname` ; sinon texte seul.
- **Formulaires** : composants clients minces ; la construction des requetes, l'enchainement de l'inscription et le choix des messages sont des fonctions pures testees dans Vitest sans navigateur (`ui/requests.ts`, `ui/messages.ts`, `fetch` injecte). `fetch` meme origine, `Content-Type: application/json`, cookie envoye par le navigateur (`credentials` par defaut).
- **Session des pages** : `auth.api.getSession({ headers: await headers() })`, une fois par requete.
- **404 de collection** : `listLinks` rend `ORGANIZATION_NOT_FOUND` ou `COLLECTION_NOT_FOUND` ; les deux donnent la meme page introuvable.
- Erreurs typees (`Result`) des fonctions existantes ; un `fail` inattendu dans une page (ex. `getSubscription` en erreur pour un owner) : page d'erreur generique, aucun detail.

## Decisions humaines appliquees
- **D-137** (humain) : cadrage de 012 (preuves sans outil nouveau, apparence sobre, ecrans, hors tranche).
- **D-142** (humain, 2026-10-28) : D-139, D-140, D-141 validees.
- **D-143** (humain, sur recommandation de l'orchestrateur, 2026-10-28) : `minRole` `"authenticated"` pour `createOrganization` et `listMyOrganizations`, etiquette seulement.
- **D-144** (humain, 2026-10-28) : contrat et lectures L-1 a L-9 valides, avec trois precisions :
  - **Q-1, option A** : inscription = adresse, mot de passe, nom de l'organisation, creation enchainee ; l'invite s'inscrit sans organisation ; creation en echec apres inscription : « mes organisations » avec un message fixe et le formulaire, sans nouvelle tentative automatique, critere teste (AC2) ; `name` de better-auth = l'adresse, aucun champ ajoute. Ecarte : (B) inscription du seul compte ; un champ « Nom ».
  - **Q-2** : aucun changement serveur dans 012 ; la protection des ecritures repose sur le cookie `SameSite=Lax` (les routes n'exigent pas le type de contenu et ne controlent pas `Origin`, seul better-auth le fait sur `/api/auth/*`) ; test du cookie `SameSite=Lax` et `HttpOnly` (AC13) ; controle de l'origine des routes d'ecriture au backlog, avant la mise en ligne. Limite : une page d'une autre origine du **meme site** (autre sous-domaine, autre port de `localhost`) enverrait le cookie. Ecarte : l'ajouter dans 012 (travail serveur).
  - **Marqueurs (L-8)** : liste fermee ci-dessus, U+200D exclu, transformation cote serveur avant les composants, valeur enregistree inchangee, emoji compose teste (AC9).

## Lectures de l'orchestrateur
Validees par D-144 (L-1 a L-9) :
- **L-1** chemins en francais ci-dessus ; `/invitations/accept` impose par 003.
- **L-2** renvoi vers `/connexion` sans parametre de retour (evite un renvoi ouvert et toute fuite du jeton) ; apres connexion : `/organisations`.
- **L-3** apres une ecriture, relecture serveur (`router.refresh()`) ; creation d'organisation : navigation vers sa page.
- **L-4** auteur d'un lien affiche par son adresse (lue dans `listMembers`), « ancien membre » s'il n'est plus membre (US-06.3).
- **L-5** dates en UTC, format fixe, rendues cote serveur.
- **L-6** acceptation sur clic explicite, jamais automatique au chargement (un apercu de lien ou un prechargement ne consomme pas l'invitation) ; jeton absent du fragment : aucun appel.
- **L-7** identifiant malforme dans le chemin d'une page : meme page introuvable (`404`) qu'un identifiant inconnu (les routes rendent `422` ; une page n'a pas de raison de distinguer).
- **L-8** caracteres invisibles ou bidirectionnels rendus par un marqueur visible `[U+XXXX]`, liste fermee de D-144 (la precision humaine la nomme « L-4 » ; il s'agit de cette lecture).
- **L-9** bouton « Se deconnecter » (`POST /api/auth/sign-out`) sur les pages privees et la page d'acceptation : necessaire pour changer de compte (cas `INVITATION_EMAIL_MISMATCH`, visite owner puis member).

A l'ouverture, apres D-144 (D-145, **a valider par l'humain**) :
- **L-10** le message d'echec de creation apres inscription est porte par un parametre d'adresse fixe, `/organisations?creation=echec` : la page le rend cote serveur (testable sans navigateur, AC2 e) ; la valeur n'est jamais reprise, seule la valeur exacte `echec` affiche le texte fixe. Ecartes : etat garde par le navigateur (perdu a la navigation, non testable par le serveur) ; message affiche a tout compte sans organisation (l'invite inscrit qui n'a pas encore accepte le verrait a tort).
- **L-11** la liste fermee de L-8 ne marque pas les autres caracteres de controle du titre encore acceptes par le contrat (C0 hors U+0000, C1 : backlog de 005) ; React les rend tels quels (texte, sans effet de balisage). Les marquer serait une regle d'affichage nouvelle : non fait, signale.
