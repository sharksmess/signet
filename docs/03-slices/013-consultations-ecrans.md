# 013 — Consultations pour les ecrans

> **Statut : ouverte en mode autonome le 2026-10-28** (`/run-queue`, budget : cette seule tranche), selon `docs/04-runbooks/consigne-run-queue-013.md` (objectif A, D-136). Les regles de lecture sont decidees d'avance par l'humain (D-138). Le contrat n'attend pas de validation humaine avant l'implementation (precedent D-027) : les lectures de l'orchestrateur qui ne viennent ni des sources ni de D-138 sont inscrites au registre comme **a valider par l'humain** (D-139).

## Capacite
En tant qu'utilisateur connecte, je consulte la liste des organisations dont je suis membre (US-01, parcours d'ecran de 012) ; en tant que membre d'une organisation (owner ou member), je consulte la liste de ses membres (US-07.1 partiel, contrat `listMembers`). Sans session, rien n'est lisible ; une organisation d'autrui est indistinguable d'une organisation inexistante (US-09.2). Ces deux lectures sont les seules qui manquent aux ecrans de 012 (D-136).

## Perimetre
- **Touche** :
  - contrat `docs/02-architecture/api-contracts/organizations.ts` : **ajout** du contrat `listMyOrganizations` (D-138 point 1) ; `createOrganization` et `renameOrganization` inchanges ;
  - route `GET /api/organizations` (contrat `listMyOrganizations`), ajoutee au fichier de route existant **sans modifier son `POST`** ;
  - route `GET /api/organizations/:organizationId/members` (contrat `listMembers`, existant, implemente tel quel), nouveau fichier ;
  - `apps/web/src/lib/organizations.ts` (ajout de la lecture `listMyOrganizations`, `createOrganization` et `renameOrganization` inchanges) et `apps/web/src/lib/contracts.ts` (export du nouveau contrat) ;
  - nouveau module `apps/web/src/lib/members/` (point d'import du contrat `listMembers`, logique de lecture) ;
  - tests `tests/screen-reads/**`, `tests/helpers/screen-reads*.ts` ;
  - backlog, registre, journal de projet 23, index du journal (ligne 22).
- **NE touche PAS** :
  - **aucune migration**, aucun privilege, aucune politique, aucun index, aucune fonction `SECURITY DEFINER` (D-138 point 5) : `signet.organizations_for_user` (executable par `signet_app`) et la politique `app_user_visible_to_co_members` suffisent ; si l'un d'eux semble manquer : **arret** ;
  - **aucune ecriture** par les nouvelles routes : ni `organization`, ni `member`, ni `app_user`, ni aucune autre table ;
  - `apps/web/src/lib/db.ts` (si elle devait changer : **arret**), `apps/web/src/lib/errors.ts`, `apps/web/src/lib/auth.ts` ;
  - le `POST /api/organizations` (meme reponse, memes messages, memes ecritures) et le `PATCH /api/organizations/:organizationId` ;
  - contrats existants : `createOrganization`, `renameOrganization`, `listMembers`, `removeMember` et tous les autres fichiers de `api-contracts/` ;
  - role de l'appelant dans `listMyOrganizations` (la fonction ne le rend pas ; la page d'organisation le lit par `listMembers`, D-138 point 1) ;
  - invitations en attente dans `listMembers` (aucune lecture d'invitation, backlog de 003, D-138 point 3) ;
  - pagination, plafond de reponse, filtres, recherche, tri au choix de l'appelant (D-138 point 4) ;
  - echappement, nettoyage ou normalisation des noms et adresses par l'API (D-138 point 4 ; l'affichage echappe est 012) ;
  - ecrans : **tranche 012** ; retrait d'un membre : 008 ; suppression d'une collection : 007 ; changement de palier, Stripe, authentification.

## Perimetre de fichiers
Declare dans `.gates/scope-013.txt` (source de verite du hook) : documentation de la tranche, `docs/02-architecture/api-contracts/organizations.ts`, `apps/web/src/app/api/organizations/route.ts`, `apps/web/src/app/api/organizations/[organizationId]/members/route.ts`, `apps/web/src/lib/organizations.ts`, `apps/web/src/lib/contracts.ts`, `apps/web/src/lib/members/*`, `tests/screen-reads/**`, `tests/helpers/screen-reads*.ts`. Aucun fichier de `packages/`, aucun test des tranches precedentes.

## Dependances
- Tranches devant etre closes avant celle-ci : 001 et 006 (closes et fusionnees, PR #1 et #33).
- **Aucune dependance nouvelle.**

## Commandes d'echafaudage prevues
Aucune. Ni `pnpm db:generate`, ni `pnpm add`. Verification apres coup par `git status --short`.

## Contrat de donnees
Aucun changement. Lus sous `signet_app` :
- `signet.organizations_for_user(user_id)` (ERD §1, ADR-0011 § e ; `SECURITY DEFINER`, garde d'identite `SG002` : l'argument doit etre l'utilisateur de session `app.user_id`) ; colonnes rendues : `id`, `name`, `created_at` de `organization` ;
- `member` (ERD §4 ; `created_at` = date d'arrivee dans l'organisation ; `SELECT` accorde par 0003, politique `member_isolation`) joint a `app_user` (`email` ; `SELECT` accorde par 0003, politique `app_user_visible_to_co_members` : seuls les membres de l'organisation du contexte sont visibles).

## Contrat d'API
Sources : `docs/02-architecture/api-contracts/organizations.ts` (`listMyOrganizations`, **ajoute** par cette tranche, D-138 point 1) et `members.ts` (`listMembers`, **non modifie**).

| Route | Methode | Entree | Sorties | Role minimal | Idempotent sur |
|---|---|---|---|---|---|
| `/api/organizations` | GET | session better-auth (cookie) ; aucune autre entree | `200 [{ id, name, createdAt }]`, `created_at DESC, id DESC` de l'organisation (D-138 point 2) ; `[]` si aucune | `public` (toute session valide) | lecture seule |
| `/api/organizations/:organizationId/members` | GET | session ; `organizationId` du chemin | `200 [{ userId, email, role }]`, `member.created_at ASC, user_id ASC` (D-138 point 3) ; contient toujours l'appelant | `member` (owner ou member) | lecture seule |

Contrat ajoute (texte exact a ecrire dans `organizations.ts`, D-138 point 1) : `route: "/api/organizations"`, `method: "GET"`, `minRole: "public"`, `input: z.object({})`, `output: z.array(z.object({ id: Uuid, name: z.string(), createdAt: z.string().datetime() }))`, `errors: [{ status: 401, code: "UNAUTHENTICATED", ... }]`, idempotente, lecture seule ; commentaire : appuye sur `signet.organizations_for_user`, utilisateur toujours celui de la session, jamais un parametre de la requete ; pas de role dans la sortie.

Chaque element contient **exactement** les champs du schema de sortie du contrat (ni `slug`, ni identifiant Stripe, ni `updatedAt`, ni `organizationId`, ni `createdAt` de membre, ni colonne interne) ; `createdAt` en ISO 8601 UTC ; `name` et `email` tels qu'enregistres. La chaine de requete est ignoree (aucun parametre au contrat).

Erreurs (ordre d'evaluation) :
- `GET /api/organizations` : `401 UNAUTHENTICATED` seule.
- `GET .../members` : `401 UNAUTHENTICATED` (aucune session valide) < `422 VALIDATION_FAILED` (`organizationId` du chemin qui n'est pas un UUID ; le contrat le valide comme `Uuid`, precedent D-114 point 2, D-132 point 2 ; message fixe « Identifiant d'organisation invalide. ») < `404 ORGANIZATION_NOT_FOUND` (organisation inexistante **ou** appelant non membre : corps strictement identique).

## Criteres d'acceptation

Conventions : utilisateurs et organisations crees par les vraies routes (inscription better-auth, `POST /api/organizations`) ; un member obtenu par le **parcours d'invitation reel** (003 puis 006) quand le critere le dit, ou par une ligne forcee en base sous la connexion d'administration quand le test l'exige (date d'arrivee egale). Valeurs inventees visiblement fausses (usine 1.6.3, domaines `.invalid`). Aucun test ne compare la branche a `main` (D-099).

**Mes organisations (`GET /api/organizations`)**
- [x] AC1 — **Session** : sans cookie, ou avec un cookie invalide -> `401 UNAUTHENTICATED` (corps `{ code, message }` du `401` commun).
- [x] AC2 — **Aucune organisation** : un utilisateur inscrit qui n'a cree ni rejoint aucune organisation -> `200 []`.
- [x] AC3 — **Organisations creees et rejointes, ordre (D-138 point 2)** : un utilisateur owner d'une organisation qu'il a creee et member d'une autre qu'il a rejointe par une **invitation acceptee** (parcours 003 puis 006) voit **exactement** ces deux organisations, de la plus recente a la plus ancienne (`created_at DESC` de l'organisation, pas de la date d'arrivee). **A horodatage egal** (organisations forcees en base dans une meme transaction), l'ordre est `id DESC` quel que soit l'ordre d'insertion. Chaque element est conforme a `listMyOrganizations.output`, ses cles sont **exactement** `{id, name, createdAt}` (ni `slug`, ni `role`, ni identifiant Stripe, ni colonne interne), `createdAt` en ISO 8601 UTC (suffixe `Z`) egal a la date enregistree, `name` tel qu'enregistre.
- [x] AC4 — **Isolation (US-09)** : la liste ne contient **jamais** une organisation dont l'appelant n'est pas membre (une organisation d'un autre utilisateur, creee avant et apres la sienne, n'y figure pas) ; un parametre de requete (`?userId=<id d'un autre utilisateur>`, `?organizationId=...`) est **ignore** : la reponse est identique a celle sans parametre ; aucun en-tete ni corps de requete ne change l'utilisateur lu.

**Membres (`GET /api/organizations/:organizationId/members`)**
- [x] AC5 — **Lecture nominale par l'owner et par un member** : l'owner de A et un member de A (rejoint par invitation acceptee) obtiennent chacun `200` et **la meme liste**, qui contient l'appelant. Chaque element est conforme a `listMembers.output`, ses cles sont **exactement** `{userId, email, role}` ; `role` est celui enregistre (`owner` pour le fondateur, `member` pour l'invite) ; `email` est l'adresse enregistree du compte. Un `organizationId` en majuscules dans le chemin designe la meme organisation.
- [x] AC6 — **Ordre (D-138 point 3)** : date d'arrivee (`member.created_at`) du plus ancien au plus recent, le fondateur en premier ; **a date d'arrivee egale** (lignes `member` forcees en base dans une meme transaction), l'ordre est `user_id ASC` quel que soit l'ordre d'insertion. Une chaine de requete (`?sort=desc`) ne change rien.
- [x] AC7 — **Session et validation, ordre des erreurs** : sans cookie ou cookie invalide -> `401` quelle que soit la validite du chemin ; identifiant malforme -> `422 VALIDATION_FAILED`, message fixe sans la valeur soumise ni le message de Zod ; ordre prouve : sans session et chemin malforme -> `401` ; session et chemin malforme -> `422` ; session, UUID inconnu -> `404`.
- [x] AC8 — **Isolation tenant (US-07.1, US-09)** :
  - (a) l'owner de B (non membre de A) lit les membres de A -> `404 ORGANIZATION_NOT_FOUND`, corps **strictement identique** a celui d'un UUID d'organisation inexistant ;
  - (b) un utilisateur membre **de A et de B** : sous le chemin de A, la liste ne contient **aucune** adresse d'un membre de B qui n'est pas membre de A, et inversement (le chemin fait autorite, D-132 point 5) ;
  - (c) en base sous **contexte etranger force** (`signet_app`, `app.user_id` = l'owner de B, `app.organization_id` = A) : `SELECT` sur `member` de A et sur `app_user` des membres de A rendent **zero ligne**.
- [x] AC9 — **Invitation en attente** : une invitation emise et non acceptee vers une adresse (compte inscrit ou non) n'ajoute **aucun** element a la liste ; apres son acceptation, l'invite y apparait (en dernier, `role = member`).

**Lecture seule**
- [x] AC10 — **Lecture seule prouvee** : apres une serie de lectures (succes et chaque cas d'erreur d'AC1, AC4, AC7, AC8), les lignes de `organization`, `member`, `app_user` et `invitation` des organisations concernees sont inchangees (comparaison des lignes completes). Aucun privilege, aucune politique, aucune fonction `SECURITY DEFINER` nouveaux : les tests de catalogue existants et les listes fermees de D-121 restent verts **sans modification**.
- [x] AC11 — **Non-regression du `POST /api/organizations`** : `tests/organizations/**` vert sans modifier ses assertions ni ses fichiers (memes statuts, memes messages, memes ecritures).
- [x] AC12 — **Dependances, migrations et environnement** : aucune dependance ajoutee, aucune migration, aucune variable d'environnement nouvelle, `apps/web/src/lib/db.ts` inchange (verification **ponctuelle**, ecrite dans la fiche de preuves ; aucun test permanent qui compare a `main`).

## Anti-regression
- Suites 001, 002, 003, 004, 005, 006, 009, 010, 011 et `tests/_factory/*` vertes **sans modifier leurs assertions** ni leurs fichiers.
- `contract-guardian` : seul ajout dans `api-contracts/` = `listMyOrganizations` ; `listMembers` implemente tel que contractualise ; aucun autre contrat modifie.

## Notes d'implementation
- **Mes organisations** : session -> `withUserOnly(session.user.id, ...)` (patron de `createOrganization`, contexte utilisateur sans organisation) -> `SELECT id, name, created_at FROM signet.organizations_for_user($1) ORDER BY created_at DESC, id DESC`, `$1` = **l'utilisateur de session**, jamais une valeur de la requete. L'axe tenant est ici l'utilisateur : la fonction filtre `m.user_id = current_user_id()` (ADR-0011 § e).
- **Membres** : patron de 009 : session -> `safeParse` du contrat sur le chemin -> forme canonique en minuscules -> `withTenant({ userId, organizationId })` -> appartenance `WHERE m.organization_id = $1 AND m.user_id = $2` -> `404` identique pour inexistant et non membre -> `SELECT m.user_id, u.email, m.role FROM member m JOIN app_user u ON u.id = m.user_id WHERE m.organization_id = $1 ORDER BY m.created_at ASC, m.user_id ASC` (`organization_id` **explicite**, RLS en seconde barriere).
- Reponse construite champ par champ (jamais `SELECT *` renvoye tel quel) ; `createdAt` par `toISOString()`.
- Erreurs metier typees (`Result`) ; `throw` pour l'inattendu seulement, journalise par son seul code SQL (patron D-133 point 3), jamais un identifiant, un nom ni une adresse.
- `lib/members/contracts.ts` exporte `listMembers` (point d'import unique du contrat) ; `lib/contracts.ts` exporte en plus `listMyOrganizations`.

## Decisions humaines appliquees
- **D-136** (humain, 2026-10-28) : tranche 013 creee, en mode autonome, avant 012, ajoutee a l'objectif A.
- **D-138** (humain, sur recommandation de l'orchestrateur, 2026-10-28) : contrat `listMyOrganizations` ; ordre `created_at DESC, id DESC` ; `listMembers` tel quel, ordre date d'arrivee croissante puis `user_id`, invitations en attente exclues ; pas de pagination, valeurs telles qu'enregistrees ; aucune migration, fonction ni privilege nouveaux.

## Lectures de l'orchestrateur (a valider par l'humain, D-139)
Aucune regle metier inventee ; ces points precisent la forme sans changer une regle des sources :
1. **Statut `200`** pour les deux lectures (les contrats ne nomment pas le statut de succes ; precedent D-132 point 1).
2. **`GET .../members` : identifiant malforme -> `422`**, ordre `401 < 422 < 404` (precedent D-114 point 2, D-132 point 2) ; le contrat `listMembers` ne liste pas ce `422`, comme `listCollections` (contracts-009, au backlog) ; le contrat n'est pas modifie (D-138 point 3 : « tel quel »).
3. **Chaine de requete ignoree** pour les deux routes ; **`input: z.object({})`** pour `listMyOrganizations` (aucune entree, D-138 point 1), la route ne lit ni chaine de requete ni corps.
4. **Ordre de `listMembers` departage par `user_id` en ordre croissant** (D-138 point 3 dit « puis `user_id` » sans le sens ; le sens croissant suit celui du premier critere).
5. **`createdAt` de `listMyOrganizations`** = `organization.created_at` (date de creation de l'organisation, celle de l'ordre de D-138 point 2), jamais la date d'arrivee de l'appelant.
6. **`minRole: "public"` ecrit tel que D-138 le fixe, ecart signale** : depuis D-109 (tranche 006), `_contract.ts` definit `"public"` comme « aucune authentification » et `"authenticated"` comme « session exigee, sans appartenance prealable » ; `createOrganization`, cite en modele par D-138, date d'avant D-109. Le comportement n'est pas en cause (`401` sans session, AC1). L'orchestrateur n'a pas reecrit la decision humaine : passer `listMyOrganizations` (et `createOrganization`) a `"authenticated"` est une modification de contrat a decider par l'humain (backlog).
