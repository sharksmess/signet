# 009 — Consultation des collections et des liens

> **Statut : ouverte en mode autonome le 2026-10-27** (`/run-queue`, budget : cette seule tranche), selon `docs/04-runbooks/consigne-run-queue-009.md` (objectif A, D-130). Les regles de lecture sont decidees d'avance par l'humain (D-131). Le contrat n'attend pas de validation humaine avant l'implementation (precedent D-027) : les lectures de l'orchestrateur qui ne viennent ni des sources ni de D-131 sont inscrites au registre comme **a valider par l'humain** (D-132).

## Capacite
En tant que membre d'une organisation (owner ou member), je consulte les collections de mon organisation, puis les liens d'une collection, du plus recent au plus ancien, pour retrouver une ressource partagee (US-07.1, US-07.2). Sans session, rien n'est lisible (US-07.3) ; une organisation ou une collection d'autrui est indistinguable d'une ressource inexistante (US-09.2).

## Perimetre
- **Touche** :
  - route `GET /api/organizations/:organizationId/collections` (contrat `listCollections`), ajoutee au fichier de route existant **sans modifier le comportement de son `POST`** ;
  - route `GET /api/organizations/:organizationId/collections/:collectionId/links` (contrat `listLinks`), ajoutee au fichier de route existant **sans modifier le comportement de son `POST`** ;
  - modules `apps/web/src/lib/collections/` et `apps/web/src/lib/links/` (point d'import des contrats, logique de lecture) ;
  - ERD §6.1 : la phrase « sert aussi la liste des collections d'une organisation triee par nom » alignee sur D-131 point 1 (documentation seulement, aucun changement de schema) ;
  - backlog, registre, journal de projet 22, index du journal (ligne 21).
- **NE touche PAS** :
  - **aucune migration**, aucun privilege, aucune politique, aucun index, aucune fonction `SECURITY DEFINER` (D-131 point 5) ; si l'une semble necessaire : arret ;
  - **aucune ecriture** par les nouvelles routes : ni `collection`, ni `link`, ni `organization_link_usage` ;
  - pagination, plafond de reponse, filtres, recherche, tri au choix de l'appelant : hors contrat (D-131 point 3 ; pagination au backlog avant la mise en ligne) ;
  - contrats d'API `docs/02-architecture/api-contracts/*` : **inchanges** (`listCollections` et `listLinks` implementes tels quels ; `deleteCollection` reste a 007) ;
  - comportement des `POST` de 004 et 005 (memes reponses, memes messages, memes ecritures) ;
  - nettoyage, normalisation ou echappement de l'URL, du titre ou du nom par l'API (D-131 point 4 ; l'echappement a l'affichage est 012) ;
  - ecrans (pages d'organisation et de collection) : **tranche 012** ;
  - suppression d'une collection (007), retrait d'un membre (008), lecture d'un lien isole (aucune route au contrat) ;
  - `organization`, `member`, `invitation`, `subscription`, Stripe, authentification, `apps/web/src/lib/db.ts`, `apps/web/src/lib/errors.ts`.

## Perimetre de fichiers
Declare dans `.gates/scope-009.txt` (source de verite du hook) : documentation de la tranche, les **deux** fichiers `route.ts` (et eux seuls) sous `apps/web/src/app/api/organizations/[organizationId]/collections/`, `apps/web/src/lib/collections/*`, `apps/web/src/lib/links/*`, `tests/consultation/**`, `tests/helpers/consultation*.ts`. Aucun fichier de `packages/`, aucun test des tranches precedentes.

## Dependances
- Tranches devant etre closes avant celle-ci : 004 et 005 (closes et fusionnees, PR #34 et #36).
- **Aucune dependance nouvelle.**

## Commandes d'echafaudage prevues
Aucune. Ni `pnpm db:generate`, ni `pnpm add`. Verification apres coup par `git status --short`.

## Contrat de donnees
Aucun changement. Tables lues : `member` (appartenance), `collection` (ERD §6.1), `link` (ERD §6.2), sous `signet_app` (`SELECT` deja accorde par 0016 et 0017, politiques `collection_isolation` et `link_isolation` existantes). L'ordre des liens est celui de l'index `link_collection_recent_idx (collection_id, created_at DESC, id DESC)`.

## Contrat d'API
Sources : `docs/02-architecture/api-contracts/collections.ts` (`listCollections`) et `links.ts` (`listLinks`), **non modifies**.

| Route | Methode | Entree | Sorties | Role minimal | Idempotent sur |
|---|---|---|---|---|---|
| `/api/organizations/:organizationId/collections` | GET | session better-auth (cookie) ; `organizationId` du chemin | `200 [{ id, name, createdAt }]`, de la plus recente a la plus ancienne (`created_at DESC, id DESC`, D-131 point 1) ; `[]` si aucune | `member` (owner ou member) | lecture seule |
| `/api/organizations/:organizationId/collections/:collectionId/links` | GET | session ; `organizationId` et `collectionId` du chemin | `200 [{ id, url, title, addedBy, createdAt }]`, du plus recent au plus ancien (`created_at DESC, id DESC`, D-131 point 2) ; `[]` si aucun | `member` (owner ou member) | lecture seule |

Chaque element contient **exactement** les champs du schema de sortie du contrat (ni `organizationId`, ni `collectionId`, ni colonne interne) ; `createdAt` en ISO 8601 UTC ; `url`, `title` et `name` tels qu'enregistres. La chaine de requete est ignoree (aucun parametre au contrat).

Erreurs (ordre d'evaluation) :
- `401 UNAUTHENTICATED` — aucune session valide ;
- `422 VALIDATION_FAILED` — `organizationId` ou `collectionId` du chemin qui n'est pas un UUID (le contrat les valide comme `Uuid`, precedent D-114 point 2) ; message fixe, celui de l'organisation si les deux sont malformes ;
- `404 ORGANIZATION_NOT_FOUND` — organisation inexistante **ou** appelant non membre : corps strictement identique ;
- `404 COLLECTION_NOT_FOUND` — collection inexistante **ou** d'une autre organisation : corps strictement identique.

Ordre dans la route : session -> validation (contrat) -> transaction `withTenant({ userId, organizationId })` : appartenance (filtre explicite `organization_id` et `user_id`) -> (liens : existence de la collection, filtre explicite `id` et `organization_id`) -> `SELECT` avec `organization_id` explicite et `ORDER BY created_at DESC, id DESC`.

## Criteres d'acceptation

Conventions : utilisateurs et organisations crees par les vraies routes (inscription better-auth, `POST /api/organizations`) ; collections et liens crees par les vraies routes de 004 et 005, ou par insertion sous la connexion d'administration quand le test l'exige (horodatage egal, 75 liens) ; un `member` obtenu par une ligne forcee en base ou par le parcours d'invitation. Valeurs inventees visiblement fausses (usine 1.6.3, domaines `.invalid`). Aucun test ne compare la branche a `main` (D-099). Chaque critere vaut pour **les deux routes** sauf mention.

- [x] AC1 — **Lecture nominale par l'owner et par un member (US-07.1)** : l'owner de A et un member de A obtiennent chacun `200` et la meme liste des collections de A, puis la meme liste des liens d'une collection de A. Chaque element est conforme au schema de sortie du contrat (`listCollections.output`, `listLinks.output`) et ses cles sont **exactement** `{id, name, createdAt}` et `{id, url, title, addedBy, createdAt}` ; `createdAt` est en ISO 8601 UTC (suffixe `Z`) et designe la date enregistree ; `addedBy` est l'auteur reel du lien. La liste des liens ne contient que ceux de la collection demandee (pas ceux d'une autre collection de A). Un `organizationId` (et un `collectionId`) en majuscules dans le chemin designe la meme ressource.
- [x] AC2 — **Ordre (US-07.2, D-131 points 1 et 2)** : collections et liens sont rendus du plus recent au plus ancien (`created_at DESC`). **A horodatage egal** (lignes inserees dans une meme transaction, donc meme `now()`), l'ordre est `id DESC` : la liste rendue est egale aux identifiants tries de facon decroissante, quel que soit l'ordre d'insertion. Une chaine de requete (`?sort=asc`, `?order=name`) ne change rien.
- [x] AC3 — **Listes vides** : une organisation sans collection -> `200 []` ; une collection sans lien -> `200 []`.
- [x] AC4 — **Session (US-07.3)** : sans cookie, ou avec un cookie invalide -> `401 UNAUTHENTICATED`, quelle que soit la validite des identifiants du chemin.
- [x] AC5 — **Validation et ordre des erreurs** : identifiant malforme dans le chemin -> `422 VALIDATION_FAILED`, message fixe sans la valeur soumise ni le message de Zod. Ordre prouve : sans session et chemin malforme -> `401` ; session, organisation non membre (ou inexistante) et `collectionId` malforme -> `422` ; organisation et collection malformees -> message de l'organisation, different de celui de la collection ; organisation non membre et collection inexistante -> `404 ORGANIZATION_NOT_FOUND` ; organisation membre et collection inexistante -> `404 COLLECTION_NOT_FOUND`.
- [x] AC6 — **Isolation tenant (US-07.1, US-09)** :
  - (a) l'owner de B (non membre de A) lit les collections de A, puis les liens d'une collection de A -> `404 ORGANIZATION_NOT_FOUND`, corps **strictement identique** a celui d'un UUID d'organisation inexistant ;
  - (b) un membre de A demande, sous le chemin de A, une collection de B -> `404 COLLECTION_NOT_FOUND`, corps strictement identique a celui d'un UUID de collection inexistant ;
  - (c) un utilisateur membre **de A et de B** : par chaque chemin, il ne voit que les donnees de l'organisation du chemin (collections de A seules sous A, de B seules sous B ; collection de B sous le chemin de A -> `404 COLLECTION_NOT_FOUND`, et inversement) ;
  - (d) en base sous **contexte etranger force** (`signet_app`, `app.user_id` = l'owner de B, `app.organization_id` = A) : `SELECT` sur `collection` et sur `link` de A rendent **zero ligne**.
- [x] AC7 — **Fraicheur** : une collection creee puis un lien ajoute par les `POST` existants apparaissent a la lecture suivante, en tete de liste ; aucune reponse n'est servie depuis un cache (deux lectures encadrant un ajout different).
- [x] AC8 — **Organisation retrogradee au-dessus du quota (patron de 005)** : une organisation Pro puis Free avec 75 liens : la lecture rend les 75 liens (somme sur ses collections), dans l'ordre d'AC2 ; aucun lien supprime ni modifie, compteur `organization_link_usage` inchange (75).
- [x] AC9 — **Valeurs telles qu'enregistrees (D-131 point 4, D-119)** : un lien dont l'URL contient U+202E et U+200B dans son chemin et dont le titre contient U+202E et U+200B est rendu **a l'identique** (egalite stricte de chaines avec la valeur enregistree), ni reecrit, ni nettoye, ni echappe.
- [x] AC10 — **Lecture seule prouvee** : apres une serie de lectures (succes et chaque cas d'erreur d'AC4 a AC6), le nombre de lignes de `collection` et de `link` et la ligne `organization_link_usage` de l'organisation sont inchanges. Aucun privilege, aucune politique, aucune fonction `SECURITY DEFINER` nouveaux : les tests de catalogue de 004 et 005 et les listes fermees de D-121 restent verts **sans modification**.
- [x] AC11 — **Non-regression des `POST`** : suites `tests/collections/**` et `tests/links/**` vertes sans modifier leurs assertions ni leurs fichiers (memes statuts, memes messages, memes ecritures).
- [ ] AC12 — **Dependances, migrations et environnement** : aucune dependance ajoutee, aucune migration, aucune variable d'environnement nouvelle (verification **ponctuelle**, ecrite dans la fiche de preuves ; aucun test permanent qui compare a `main`).

## Anti-regression
- Suites 001, 002, 003, 004, 005, 006, 010, 011 et `tests/_factory/*` vertes **sans modifier leurs assertions** ni leurs fichiers.
- `contract-guardian` : `docs/02-architecture/api-contracts/*` inchanges ; `listCollections` et `listLinks` implementes tels que contractualises ; `createCollection` et `addLink` inchanges.

## Notes d'implementation
- Patron de 004 et 005 : session -> `safeParse` du contrat sur les parametres du chemin -> forme canonique en minuscules -> `withTenant({ userId, organizationId })` -> appartenance `WHERE m.organization_id = $1 AND m.user_id = $2` -> `404` identique pour inexistant et non-membre.
- Requetes : `organization_id` **toujours explicite** (regle absolue), RLS en seconde barriere. Liens : existence de la collection `WHERE c.id = $2 AND c.organization_id = $1` (zero ligne -> `COLLECTION_NOT_FOUND`), puis `SELECT ... FROM link l WHERE l.organization_id = $1 AND l.collection_id = $2 ORDER BY l.created_at DESC, l.id DESC` (une seule instruction avec jointure est acceptable si elle distingue « collection absente » de « liste vide »).
- Reponse construite champ par champ depuis la ligne (jamais `SELECT *` renvoye tel quel) ; `createdAt` par `toISOString()`.
- Erreurs metier typees (`Result`) ; `throw` pour l'inattendu seulement, journalise par son seul code (jamais un identifiant, une URL, un titre ni un nom).
- Messages de `422` : reprendre les textes fixes des `POST` (« Identifiant d'organisation invalide. », « Identifiant de collection invalide. ») ; un repli neutre si le schema refuse un autre champ.
- `lib/collections/contracts.ts` et `lib/links/contracts.ts` exportent en plus `listCollections` et `listLinks` (point d'import unique du contrat).

## Decisions humaines appliquees
- **D-131** (humain, 2026-10-27) : ordre des collections `created_at DESC, id DESC` ; ordre des liens idem (index `link_collection_recent_idx`) ; pas de pagination ; valeurs rendues telles qu'enregistrees ; aucune migration.

## Lectures de l'orchestrateur (a valider par l'humain, D-132)
Aucune regle metier inventee ; ces points precisent la forme sans changer une regle des sources :
1. **Statut `200`** pour les deux lectures (le contrat ne nomme pas le statut de succes).
2. **Identifiant malforme dans le chemin -> `422`** (precedent D-114 point 2) ; ordre `401 < 422 < 404` organisation `< 404` collection, celui de la consigne et de 005 : un non-membre qui envoie un `collectionId` malforme recoit `422`, ce qui ne revele rien sur l'organisation.
3. **Chaine de requete ignoree** : aucun parametre au contrat ; aucun tri ni filtre au choix de l'appelant.
4. **ERD §6.1** : la phrase sur la liste « triee par nom » est remplacee par l'ordre de D-131 point 1 (aucun index nouveau ; index `(organization_id, created_at)` au backlog si besoin, D-131 point 5).
5. **Membre de deux organisations** (AC6 c) : la lecture des liens sous le chemin de A d'une collection de B rend `404 COLLECTION_NOT_FOUND` meme si l'appelant est aussi membre de B : le chemin fait autorite, comme pour les `POST`.
