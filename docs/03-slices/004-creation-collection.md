# 004 — Creation d'une collection

> **Statut : ouverte en mode autonome le 2026-10-26** (`/run-queue`, budget : cette seule tranche), selon `docs/04-runbooks/consigne-run-queue-004.md` (objectif A, D-083, D-084). Le contrat n'attend pas de validation humaine avant l'implementation (precedent D-027) : les lectures de l'orchestrateur sont inscrites au registre comme **a valider par l'humain** (D-114). D-113 (delai propre du test de portee du lint) est une decision humaine appliquee dans cette tranche.

## Capacite
En tant que membre d'une organisation (owner ou member), je cree une collection nommee pour ranger des liens par theme (US-05.1). Le nom est unique dans l'organisation, sans tenir compte de la casse ni des espaces de bord (US-05.3, ERD §6.1) ; la collection n'appartient qu'a son organisation et n'est jamais visible depuis une autre (US-05.2, US-09).

## Perimetre
- **Touche** :
  - table `collection` (ERD §6.1), sa RLS (activee et forcee), sa politique `signet_app`, ses privileges ; une migration nouvelle `0016_*` ;
  - schema Drizzle `packages/db/src/schema/collections.ts` et son export ;
  - route `POST /api/organizations/:organizationId/collections` ;
  - module `apps/web/src/lib/collections/` (contrat, logique de creation) ; erreur `COLLECTION_NAME_TAKEN` dans `apps/web/src/lib/errors.ts` ;
  - ERD (§6.1 si precise, matrice d'isolation, « Migrations appliquees »), backlog, registre, journal de projet 20 ;
  - **D-113** : `tests/stack-upgrade/lint-scope.test.ts`, delai propre de 60 s, pour cette seule raison.
- **NE touche PAS** :
  - liste des collections (`GET`, US-07.1) et lecture : **tranche 009** ;
  - suppression d'une collection et cascade sur ses liens (US-10) : **tranche 007** ;
  - renommage d'une collection : aucune US, hors MVP (aucune route, aucun privilege `UPDATE`) ;
  - table `link`, cle etrangere composite, compteur `organization_link_usage`, triggers de quota : **tranche 005** ;
  - ecrans (formulaire de creation) : **tranche 012** ;
  - contrats d'API : `collections.ts` est **inchange** (creation implementee telle quelle ; `listCollections` et `deleteCollection` non implementes) ;
  - aucune fonction `SECURITY DEFINER` nouvelle, aucune politique `signet_definer` ;
  - `organization`, `member`, `invitation`, `subscription`, Stripe, invitations, authentification.

## Perimetre de fichiers
Declare dans `.gates/scope-004.txt` (source de verite du hook) : documentation de la tranche, migrations nouvelles et `meta/`, `packages/db/src/schema/collections.ts` et `index.ts`, route `apps/web/src/app/api/organizations/[organizationId]/collections/*`, `apps/web/src/lib/collections/*`, `errors.ts`, `tests/collections/**`, `tests/helpers/collections*.ts`, et **un fichier de test de 011** : `tests/stack-upgrade/lint-scope.test.ts` (D-113, voir Anti-regression).

## Dependances
- Tranches devant etre closes avant celle-ci : 001 (close). 010, 011, 002, 003, 006 closes et fusionnees.
- **Aucune dependance nouvelle.**

## Commandes d'echafaudage prevues
`pnpm db:generate` (table `collection` declaree dans le schema Drizzle) ; fichier genere renomme au numero suivant du dossier (`0016_*`), etiquette alignee dans `meta/_journal.json` (ERD « Numerotation », precedent 0014), puis completion du meme fichier : RLS, politique, privileges. Puis `pnpm db:migrate`. Verification apres coup par `git status --short`. Aucun `pnpm add`.

## Contrat de donnees
| Table | Colonnes ajoutees / modifiees | Contraintes et index |
|---|---|---|
| `collection` (nouvelle) | `id uuid` PK `DEFAULT uuidv7()` ; `organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE` ; `name text NOT NULL` ; `created_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT` ; `created_at timestamptz NOT NULL DEFAULT now()` | `CHECK (char_length(btrim(name)) BETWEEN 1 AND 100)` ; `CHECK (name = btrim(name))` ; `UNIQUE (id, organization_id)` (cible de la FK composite de `link`, 005) ; `UNIQUE INDEX collection_org_name_ci_idx ON collection (organization_id, lower(btrim(name)))` |

Exactement l'ERD §6.1, sans colonne ni index de plus.

**RLS** : `ENABLE` et `FORCE ROW LEVEL SECURITY`. Une seule politique, `TO signet_app`, `USING (organization_id = signet.current_org())` et `WITH CHECK (organization_id = signet.current_org())` (aucun appel a `context_org()`, aucune politique `TO PUBLIC` ni `signet_definer`). **Privileges** de `signet_app` : `SELECT, INSERT` seulement (le `SELECT` sert le `RETURNING` de l'insertion et les tranches 009/007 ; ni `UPDATE`, ni `DELETE`, ni `TRUNCATE` : la suppression arrivera avec 007).

## Contrat d'API
Source : `docs/02-architecture/api-contracts/collections.ts`, `createCollection`, **non modifie**.

| Route | Methode | Entree | Sorties | Role minimal | Idempotent sur |
|---|---|---|---|---|---|
| `/api/organizations/:organizationId/collections` | POST | session better-auth (cookie) + corps `{ name }` ; `organizationId` du chemin fait autorite (tout `organizationId` ou autre champ du corps est ignore, precedent 003) | `201 { id, organizationId, name, createdAt }` (`name` tel qu'enregistre, sans espaces de bord ; `createdAt` ISO 8601 UTC) | `member` (owner ou member) | non idempotente : un rejeu du meme nom apres succes -> `409 COLLECTION_NAME_TAKEN` |

Erreurs (ordre d'evaluation) :
- `401 UNAUTHENTICATED` — aucune session valide ;
- `422 VALIDATION_FAILED` — corps non JSON ou non objet, `organizationId` du chemin qui n'est pas un UUID (precedent 003), `name` absent, non textuel, vide apres `trim`, ou de plus de 100 caracteres apres `trim` (schema du contrat) ;
- `404 ORGANIZATION_NOT_FOUND` — organisation inexistante **ou** appelant non membre : corps strictement identique ;
- `409 COLLECTION_NAME_TAKEN` — une collection de l'organisation porte deja ce nom, casse et espaces de bord ignores (`23505` sur `collection_org_name_ci_idx`).

Ordre dans la route : session -> validation (contrat) -> transaction `withTenant({ userId, organizationId })` : appartenance (filtre explicite sur `organization_id` et `user_id`) -> `INSERT ... RETURNING` avec `organization_id` explicite -> `COMMIT`.

## Criteres d'acceptation

Conventions : utilisateurs et organisations crees par les vraies routes (inscription better-auth, `POST /api/organizations`) ; un `member` est obtenu par une ligne forcee en base (connexion d'administration) ou par le parcours d'invitation de 003/006. Valeurs inventees visiblement fausses (usine 1.6.3). Aucun test ne compare la branche a `main` (D-099).

- [ ] AC1 — **Creation nominale par l'owner (US-05.1)** : l'owner de A cree `Veille` -> `201`, corps conforme a `createCollection.output` (`id` UUID, `organizationId` = A, `name` = `Veille`, `createdAt` ISO 8601). En base : une ligne `collection` avec `organization_id` = A, `created_by_user_id` = l'owner, `name` = `Veille`. Un `organizationId` en majuscules dans le chemin designe la meme organisation (forme canonique en minuscules dans la reponse et en base).
- [ ] AC2 — **Creation par un member (US-05.1)** : un `member` de A cree une collection -> `201`, `created_by_user_id` = ce member. Les deux roles sont acceptes ; aucun `403`.
- [ ] AC3 — **Unicite insensible a la casse et aux espaces de bord (US-05.3, ERD §6.1)** : apres `Veille`, les creations de `veille`, `VEILLE`, `  Veille  ` et ` vEiLlE` dans A -> `409 COLLECTION_NAME_TAKEN`, aucune ligne de plus. Rejeu exact de `Veille` -> `409`. Le message du `409` est fixe et ne reprend pas le nom.
- [ ] AC4 — **Validation du nom (contrat, ERD §6.1)** : `name` absent, `null`, nombre, chaine vide, chaine faite d'espaces, 101 caracteres (apres `trim`) -> `422 VALIDATION_FAILED`, aucune ligne ; exactement 100 caracteres -> `201` ; `"  Veille interne  "` -> `201` avec `name` = `Veille interne` en reponse et en base ; 100 caracteres entoures d'espaces -> `201`. Corps non JSON et JSON non objet (tableau, nombre) -> `422`. Le `422` ne reprend pas la valeur soumise.
- [ ] AC5 — **Isolation tenant (US-05.2, US-09)** :
  - (a) par l'API : l'owner de B (non membre de A) cree une collection dans A -> `404 ORGANIZATION_NOT_FOUND`, corps **strictement identique** a celui obtenu pour un UUID d'organisation inexistant ; aucune ligne `collection` dans A ni dans B ;
  - (b) un `organizationId` = B dans le corps d'une requete adressee a A par un membre de A cree la collection dans **A** (le chemin fait autorite) ;
  - (c) en base sous **contexte etranger force** (`signet_app`, `app.user_id` = l'owner de B, `app.organization_id` = A) : `INSERT` d'une collection de A refuse par la RLS, `SELECT` ne rend aucune ligne de A ; sous `app.organization_id` = B, `INSERT` d'une ligne dont `organization_id` = A refuse (`WITH CHECK`) ;
  - (d) l'unicite est **par organisation** : `Veille` existe dans A ; l'owner de B cree `Veille` dans B -> `201`.
- [ ] AC6 — **Concurrence (US-05.3)** : deux `POST` simultanes du meme nom dans A (et une variante : `Veille` et `veille` simultanes) -> exactement un `201` et un `409 COLLECTION_NAME_TAKEN`, une seule ligne en base. La garantie vient de l'index unique, pas d'une lecture prealable.
- [ ] AC7 — **Session** : sans session (ou cookie invalide) -> `401 UNAUTHENTICATED`, aucune ligne.
- [ ] AC8 — **Catalogue (ADR-0001, ADR-0011, ERD §6.1)** : `collection` a la RLS activee **et** forcee ; ses politiques sont exactement une politique `TO signet_app` dont `USING` et `WITH CHECK` portent `organization_id = signet.current_org()`, aucune `TO PUBLIC`, aucune `signet_definer`, aucune n'appelle `context_org(` ; privileges de `signet_app` : `SELECT` et `INSERT` seulement ; colonnes, `CHECK`, `UNIQUE (id, organization_id)` et index `collection_org_name_ci_idx` (expression `lower(btrim(name))`) conformes a l'ERD ; l'ensemble des fonctions `prosecdef` du schema `signet` est inchange (aucune fonction `SECURITY DEFINER` nouvelle) ; les invariants de catalogue de 010 et de `tests/_factory` restent verts sans modification. En base, les `CHECK` refusent un nom avec espace de bord ou vide, l'index refuse un doublon de casse inseres sous la connexion d'administration.
- [ ] AC9 — **Dependances et environnement** : aucune dependance ajoutee, aucune variable d'environnement nouvelle (verification **ponctuelle**, ecrite dans la fiche de preuves ; aucun test permanent qui compare a `main`).

## Anti-regression
- Suites 001, 002, 003, 006, 010, 011 et `tests/_factory/*` vertes **sans modifier leurs assertions**, a **une exception decidee par l'humain (D-113)** : `tests/stack-upgrade/lint-scope.test.ts` recoit un delai propre de 60 s, troisieme argument de **chacun de ses quatre `it`** (chacun charge la configuration ESLint), sans toucher a ses assertions ni au delai global de `vitest.config.ts`. Preuve : `git diff main -- tests/stack-upgrade/lint-scope.test.ts` ne montre que l'ajout de ces arguments.
- `contract-guardian` : `docs/02-architecture/api-contracts/*` inchanges ; `createCollection` implemente tel que contractualise.

## Notes d'implementation
- Patron de 003 : appartenance lue avec filtre explicite `WHERE m.organization_id = $1 AND m.user_id = $2` sous `withTenant` (RLS en seconde barriere) ; non-membre ou organisation inexistante -> `404` identique.
- Insertion : `INSERT INTO collection (organization_id, name, created_by_user_id) VALUES ($1, $2, $3) RETURNING id, organization_id, name, created_at` — `organization_id` toujours explicite (regle absolue). `23505` dont la contrainte est `collection_org_name_ci_idx` -> `409` ; tout autre code -> erreur inattendue (`500` generique, journalisee par son `code` seulement). Pas de lecture prealable « le nom existe-t-il ? » : la decision est dans l'index (AC6).
- Erreurs metier typees (`Result`) ; `throw` pour l'inattendu seulement.
- Le `name` enregistre est celui produit par le schema du contrat (`trim` de Zod) ; le `CHECK (name = btrim(name))` est le filet en base.
- Un `23505` met la transaction en echec : l'erreur typee `409` doit etre rendue sans que `withTenant` tente un `COMMIT` sur une transaction en echec (point de sauvegarde, patron D-092, ou traduction apres le `ROLLBACK` — au choix de l'implementeur, ecrit dans le journal de tranche).

## Lectures de l'orchestrateur (a valider par l'humain, D-114)
Aucune regle metier inventee ; ces points precisent la forme sans changer une regle des sources :
1. **Statut `201`** pour la creation (le contrat ne nomme pas le statut de succes ; precedent `POST` d'invitation, consigne).
2. **`organizationId` malforme dans le chemin -> `422`** (le contrat le valide comme `Uuid`), comme 003 ; un UUID bien forme inconnu -> `404`.
3. **« 100 caracteres » = la longueur mesuree par le schema Zod du contrat** (`.max(100)`, unites UTF-16, apres `trim` de Zod) : un nom fait de caracteres hors plan de base (emoji) est refuse un peu avant 100 caracteres visibles. Le `CHECK` de l'ERD (`char_length`, points de code) est plus permissif, donc jamais atteint par la route. Ecarte : modifier le contrat (hors tranche, sans gain metier).
4. **Messages d'erreur fixes** : `422` et `409` ne reprennent ni la valeur soumise ni le message de Zod (raison de D-107).
5. **Pas d'index sur `created_by_user_id`** : l'ERD §6.1 n'en prevoit pas (contrairement a `link_author_idx`) ; aucune suppression de compte n'existe dans le MVP (ERD §10). Signale au backlog pour `db-architect`, pas ajoute.
6. **Privileges de `signet_app` : `SELECT, INSERT`** : ni `UPDATE` (aucune US de renommage), ni `DELETE` (ajoute par 007 avec sa route et ses tests).
