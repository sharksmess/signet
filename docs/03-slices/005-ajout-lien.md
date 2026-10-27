# 005 — Ajout d'un lien avec quota Free

> **Statut : contrat valide par l'humain le 2026-10-26, tranche activee** (consigne `docs/04-runbooks/consigne-tranche-005.md`, objectif A, D-083, D-084). Tranche la plus risquee du backlog (PRD, risque #3) : menee avec l'humain. Decisions : D-119 (mecanisme d'atomicite et lectures 1 a 4), D-120 (Q-1, URL), D-121 (Q-2, tests de catalogue), D-122 (Q-3, recalcul reporte a 007).

## Capacite
En tant que membre d'une organisation (owner ou member), j'ajoute un lien (URL + titre) a une collection existante de mon organisation pour le partager avec mon equipe (US-06.1). Une URL malformee est refusee avant enregistrement (US-06.2) ; l'auteur et la date sont enregistres par le serveur (US-06.3) ; sur le palier Free, le 51e lien de l'organisation, toutes collections confondues, est refuse avec un message explicite et aucun lien n'est cree, y compris sous ajouts concurrents (US-06.4, risque #3, ADR-0002).

## Perimetre
- **Touche** :
  - table `link` (ERD §6.2) : colonnes, `CHECK`, cle etrangere composite `link_collection_fk (collection_id, organization_id) -> collection (id, organization_id) ON DELETE CASCADE`, trois index, RLS activee et forcee, politique `signet_app`, privileges ; une migration nouvelle `0017_*` ;
  - fonction de trigger `signet.link_usage_on_insert()` (`SECURITY DEFINER`, ADR-0002, ERD §7, branche `INSERT` seulement) et trigger `AFTER INSERT FOR EACH ROW` sur `link` ;
  - schema Drizzle `packages/db/src/schema/links.ts` et son export ;
  - route `POST /api/organizations/:organizationId/collections/:collectionId/links` ;
  - module `apps/web/src/lib/links/` (contrat, logique d'ajout, traduction des erreurs SQL) ; codes `COLLECTION_NOT_FOUND` et `FREE_TIER_QUOTA_EXCEEDED` dans `apps/web/src/lib/errors.ts` ;
  - ERD (§6.2, §7, matrice d'isolation, « Migrations appliquees »), ADR-0002 (recalcul reporte, D-122), backlog, registre, journal de projet 21 ;
  - `docs/02-architecture/api-contracts/links.ts` : `addLink.input.url` resserre (D-120), **modifie au commit d'ouverture** ;
  - une ligne dans chacun de `tests/collections/catalog.test.ts` et `tests/invitation-acceptance/catalog.test.ts` : le nom `link_usage_on_insert` ajoute a la liste fermee des fonctions `SECURITY DEFINER` (D-121).
- **NE touche PAS** :
  - liste et lecture des liens (`GET`, `listLinks`, US-07) : **tranche 009** ;
  - suppression d'une collection et de ses liens, branche `DELETE` du trigger de compteur, `GRANT DELETE` sur `link` (US-10) : **tranche 007** (voir « Coherence du compteur ») ;
  - suppression ou edition d'un lien isole : hors perimetre du PRD ;
  - ecrans (formulaire d'ajout, affichage « 32 / 50 ») : **tranche 012** ;
  - apercu, verification en ligne, resolution DNS ou suivi de redirection des URL ; deduplication d'URL (non exigee, contrat `addLink.idempotency`) ;
  - `organization_link_usage` (aucune colonne, politique ni privilege modifie), `subscription`, `quota_for_tier`, `propagate_subscription_quota`, Stripe, `collection`, `member`, `invitation`, authentification ;
  - limite de debit sur la route (au backlog avec audit-001 MINEUR-5, audit-002 MINEUR-1, audit-004 MINEUR-1) ;
  - `apps/web/src/lib/db.ts` (`withTenant` inchange).

## Perimetre de fichiers
Declare dans `.gates/scope-005.txt` (source de verite du hook) : documentation de la tranche, ERD, ADR-0002, registre, journal de projet 21, fiche de preuves, FRICTION, cette consigne ; migrations nouvelles et `meta/` ; `packages/db/src/schema/links.ts` et `index.ts` ; route `apps/web/src/app/api/organizations/[organizationId]/collections/[collectionId]/links/*` ; `apps/web/src/lib/links/*` ; `errors.ts` ; `tests/links/**` ; `tests/helpers/links*.ts` ; `links.ts` (D-120) et les deux tests de catalogue nommes ci-dessus (D-121).

## Dependances
- Tranches devant etre closes avant celle-ci : 002 (palier, `link_quota`, close) et 004 (`collection`, `UNIQUE (id, organization_id)`, close, PR #34 fusionnee, commit 5ccd609). 001, 010, 011, 003, 006 closes.
- **Aucune dependance nouvelle.**

## Commandes d'echafaudage prevues
`pnpm db:generate` (table `link` declaree dans le schema Drizzle) ; fichier genere renomme au numero suivant du dossier (`0017_*`), etiquette alignee dans `meta/_journal.json` (ERD « Numerotation », precedent 0016), puis completion du meme fichier : RLS, politique, privileges, fonction et trigger. Puis `pnpm db:migrate`. Verification apres coup par `git status --short`. Aucun `pnpm add`.

## Contrat de donnees
| Table | Colonnes ajoutees / modifiees | Contraintes et index |
|---|---|---|
| `link` (nouvelle) | `id uuid` PK `DEFAULT uuidv7()` ; `organization_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE` ; `collection_id uuid NOT NULL` ; `url text NOT NULL` ; `title text NOT NULL` ; `added_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT` ; `created_at timestamptz NOT NULL DEFAULT now()` | `link_collection_fk FOREIGN KEY (collection_id, organization_id) REFERENCES collection (id, organization_id) ON DELETE CASCADE` ; `CHECK (url ~ '^https?://[^[:space:]]+$')` ; `CHECK (char_length(url) BETWEEN 8 AND 2048)` ; `CHECK (char_length(btrim(title)) BETWEEN 1 AND 200)` ; `INDEX link_collection_recent_idx (collection_id, created_at DESC, id DESC)` ; `INDEX link_org_idx (organization_id)` ; `INDEX link_author_idx (added_by_user_id)` |
| `organization_link_usage` | aucune modification | inchangee ; ecrite par le nouveau trigger seulement |

Exactement l'ERD §6.2, sans colonne ni index de plus.

**RLS** : `ENABLE` et `FORCE ROW LEVEL SECURITY`. Une seule politique, `link_isolation`, `TO signet_app`, `USING` et `WITH CHECK (organization_id = signet.current_org())` (aucun `context_org()`, aucune politique `TO PUBLIC` ni `signet_definer`). **Privileges** de `signet_app` : `SELECT, INSERT` seulement (`SELECT` pour le `RETURNING` et la tranche 009 ; ni `UPDATE`, ni `DELETE`, ni `TRUNCATE` : un `TRUNCATE` contournerait les triggers et desalignerait le compteur). Proprietaire `signet_owner`.

**Trigger de quota (ADR-0002 option D, ERD §7, branche `INSERT`)** : `signet.link_usage_on_insert()`, `SECURITY DEFINER`, proprietaire `signet_definer`, `SET search_path = pg_catalog, signet, public, pg_temp`, tables qualifiees, `REVOKE ALL ... FROM PUBLIC`, aucun `EXECUTE` accorde. Corps :
1. premiere instruction : `set_config('app.organization_id', NEW.organization_id::text, true)` (valeur de confiance : la ligne a deja passe le `WITH CHECK` de `link_isolation`, donc `NEW.organization_id = current_org()` sous `signet_app` ; patron `propagate_subscription_quota`, regle ADR-0011 / D-033) ;
2. `UPDATE public.organization_link_usage SET link_count = link_count + 1, updated_at = now() WHERE organization_id = NEW.organization_id RETURNING link_count, link_quota` ;
3. aucune ligne mise a jour -> `RAISE EXCEPTION` (`P0001`, compteur manquant = invariant rompu, jamais absorbe) ;
4. `link_quota IS NOT NULL AND link_count > link_quota` -> `RAISE EXCEPTION ... USING ERRCODE = 'SG001'`, message sans identifiant client.

### Mecanisme d'atomicite (exigence 1 de la consigne)
Le refus est porte par la base, dans la meme instruction que l'insertion : l'`INSERT INTO link` declenche, dans la meme transaction et avant son retour, l'`UPDATE` du compteur de l'organisation. Il n'existe **aucune lecture prealable** du compte, ni en application ni en base.

Pourquoi cela tient en `READ COMMITTED` : l'`UPDATE` prend un verrou exclusif sur **la** ligne de compteur de l'organisation. Une seconde transaction qui ajoute un lien a la meme organisation bloque sur ce verrou jusqu'au `COMMIT` ou au `ROLLBACK` de la premiere. A son reveil, Postgres ne reutilise pas la valeur qu'elle aurait lue avant d'attendre : en `READ COMMITTED`, un `UPDATE` bloque relit la **derniere version validee** de la ligne (re-evaluation) et applique `link_count + 1` a cette version. Si la premiere a valide le 50e lien, la seconde calcule 51, le `RETURNING` le lui rend, le test `51 > 50` leve `SG001`, et toute l'instruction, donc l'insertion du lien, est annulee. Si la premiere a annule, la seconde calcule 50 et reussit. Le comptage et la decision portent donc toujours sur une valeur verrouillee et a jour, quel que soit le nombre de collections (une seule ligne de compteur par organisation, « tous collections confondues » par construction). Scenario detaille : ERD §7. Consequence acceptee : les ajouts d'une meme organisation sont serialises (ADR-0002).

En isolation plus stricte, la seconde transaction recevrait `40001` au lieu de relire : la route s'execute en `READ COMMITTED` (defaut de `withTenant`, verifie par AC10) et traduit les deux codes, comme l'exige le contrat (lecture L-4).

### Coherence du compteur (exigence 3)
Dans cette tranche, le seul chemin qui change l'ensemble des lignes de `link` sous un role applicatif est l'`INSERT` de `signet_app` ; chaque insertion validee incremente le compteur dans la meme transaction, chaque insertion refusee (quota, `CHECK`, cle etrangere, RLS, compteur manquant) annule aussi l'increment. `signet_app` n'a ni `UPDATE`, ni `DELETE`, ni `TRUNCATE` sur `link`, ni aucune ecriture sur `organization_link_usage` (0003). AC9 et AC12 le prouvent.

**Plus tard (007, non implemente ici)** : la suppression d'une collection cascadera sur ses liens ; ce qui gardera le compteur juste est la branche `AFTER DELETE` du trigger (ERD §7 : decrement inconditionnel, tolerant a l'absence de ligne lors d'une cascade d'organisation, jamais de controle de quota), creee **dans la meme migration** que le `GRANT DELETE` de 007, avec le test `link_count = count(*)` apres cascade. Tant qu'elle n'existe pas, une suppression de lien par un role d'administration desalignerait le compteur : aucun chemin applicatif ne le permet.

## Contrat d'API
Source : `docs/02-architecture/api-contracts/links.ts`, `addLink`, avec `url` resserre par D-120 (entree seulement, sortie inchangee) ; `listLinks` non implemente (009).

| Route | Methode | Entree | Sorties | Role minimal | Idempotent sur |
|---|---|---|---|---|---|
| `/api/organizations/:organizationId/collections/:collectionId/links` | POST | session better-auth (cookie) + corps `{ url, title }` ; `organizationId` et `collectionId` du chemin font autorite ; tout autre champ du corps (`organizationId`, `collectionId`, `addedBy`, `createdAt`, `id`) est ignore | `201 { id, collectionId, url, title, addedBy, createdAt }` (`url` et `title` tels qu'enregistres, sans espaces de bord ; `addedBy` = utilisateur de session ; `createdAt` = horloge de la base, ISO 8601 UTC) | `member` (owner ou member) | non idempotente : chaque appel reussi cree un lien, meme URL comprise |

Erreurs (ordre d'evaluation) :
- `401 UNAUTHENTICATED` — aucune session valide ;
- `422 VALIDATION_FAILED` — corps non JSON ou non objet ; `organizationId` ou `collectionId` du chemin qui n'est pas un UUID ; `url` ou `title` invalide (AC3, AC4) ; message fixe du premier champ fautif dans l'ordre `url` puis `title`, sans la valeur soumise ni le message de Zod ;
- `404 ORGANIZATION_NOT_FOUND` — organisation inexistante **ou** appelant non membre : corps strictement identique ;
- `404 COLLECTION_NOT_FOUND` — collection inexistante **ou** d'une autre organisation : corps strictement identique ;
- `409 FREE_TIER_QUOTA_EXCEEDED` — refus de quota (`SG001`, ou `40001`) : aucun lien cree.

Ordre dans la route : session -> validation (contrat) -> transaction `withTenant({ userId, organizationId })` : appartenance (filtre explicite `organization_id` et `user_id`, patron 003/004) -> une seule instruction `INSERT INTO link (...) SELECT $org, c.id, $url, $title, $user FROM collection c WHERE c.id = $collection AND c.organization_id = $org RETURNING ...` -> zero ligne = `404 COLLECTION_NOT_FOUND` ; `SG001`/`40001` = `409` -> `COMMIT`.

## Criteres d'acceptation

Conventions : utilisateurs et organisations crees par les vraies routes (inscription better-auth, `POST /api/organizations`), collections par la route de 004 ; un `member` est obtenu par une ligne forcee en base (connexion d'administration) ou par le parcours 003/006 ; liens de remplissage (49, 50, 75) inseres en base sous `signet_app` avec le contexte de l'organisation, pour passer par le trigger ; palier Pro et retrogradation obtenus par les moyens de test de la tranche 002. Valeurs inventees visiblement fausses (`https://exemple.invalid/...`, usine 1.6.3). Aucun test ne compare la branche a `main` (D-099). Apres chaque scenario qui ecrit, `link_count = count(*)` pour chaque organisation touchee (AC9).

- [ ] AC1 — **Ajout nominal par l'owner (US-06.1, US-06.3)** : l'owner de A ajoute `https://exemple.invalid/article` titre `Article de test` a une collection de A -> `201`, corps conforme a `addLink.output` (`collectionId` = la collection, `addedBy` = l'owner, `createdAt` ISO 8601 compris entre deux lectures de l'horloge de la base encadrant la requete). En base : une ligne `link` avec `organization_id` = A, `added_by_user_id` = l'owner, compteur de A +1. Le meme ajout rejoue -> `201`, deuxieme ligne, compteur +2 (aucune deduplication). Des identifiants en majuscules dans le chemin designent les memes ressources.
- [ ] AC2 — **Ajout par un member, auteur et date poses par le serveur (US-06.1, US-06.3)** : un `member` de A ajoute un lien -> `201`, `addedBy` = ce member. Un corps qui porte en plus `addedBy` (autre utilisateur), `createdAt` (`2001-01-01T00:00:00Z`), `organizationId` (= B), `collectionId` (autre collection) et `id` : tous ignores ; le lien est dans la collection et l'organisation du chemin, l'auteur est l'utilisateur de session, la date celle de la base.
- [ ] AC3 — **Validation de l'URL (US-06.2, securite)** : refus `422 VALIDATION_FAILED`, message fixe qui nomme la regle (http ou https, nom d'hote, longueur) sans reprendre la valeur, aucune ligne, compteur inchange, pour : `url` absente, `null`, nombre, chaine vide ; `javascript:alert(1)`, `data:text/html,x`, `file:///etc/passwd`, `ftp://exemple.invalid/x`, `exemple.invalid/x`, `//exemple.invalid/x` ; `http://`, `https://`, `http:///chemin`, `https://?q=1`, `https://#x` (sans hote) ; URL avec espace interne ; 2049 caracteres ; schema en majuscules (`HTTPS://exemple.invalid/`, D-119 lecture 3) ; caractere de controle (`\u0000`, `\u0001`) et identifiants dans l'URL (`https://utilisateur:secret@exemple.invalid/`, `https://exemple.invalid@piege.invalid/`) (D-120). Acceptes : exactement 2048 caracteres -> `201` ; URL entouree d'espaces -> `201`, enregistree sans ses espaces de bord. Aucune entree ne produit de `500`.
- [ ] AC4 — **Validation du titre (US-06.1)** : `title` absent, `null`, nombre, vide, fait d'espaces, 201 caracteres apres `trim` -> `422`, message fixe, aucune ligne, compteur inchange ; exactement 200 caracteres -> `201` ; `"  Titre de test  "` -> `201`, `title` = `Titre de test` en reponse et en base ; titre contenant `\u0000` -> `422`, jamais `500`. Corps non JSON et JSON non objet -> `422`.
- [ ] AC5 — **Isolation tenant (US-09)** :
  - (a) par l'API : l'owner de B (non membre de A) ajoute un lien a une collection de A via le chemin de A -> `404 ORGANIZATION_NOT_FOUND`, corps strictement identique a celui d'un UUID d'organisation inexistant ; aucune ligne, compteurs de A et B inchanges ;
  - (b) un membre de A, sous le chemin de A, vise l'identifiant d'une collection de B -> `404 COLLECTION_NOT_FOUND`, corps strictement identique a celui d'un UUID de collection inexistant ; aucune ligne dans A ni dans B, compteurs inchanges ;
  - (c) en base sous **contexte etranger force** (`signet_app`, `app.user_id` = owner de B, `app.organization_id` = A) : `INSERT` d'un lien de A refuse par la RLS, `SELECT` ne rend aucune ligne de A, compteur de A inchange ; sous `app.organization_id` = B, `INSERT` d'un lien dont `organization_id` = A refuse (`WITH CHECK`) ;
  - (d) cle composite : sous la connexion d'administration, un lien `organization_id` = A et `collection_id` = une collection de B est refuse (`23503`), aucune ligne, compteurs inchanges ;
  - (e) les quotas sont par organisation : B (Free) a 50 liens n'empeche pas A d'ajouter ; les ajouts de A ne changent pas le compteur de B.
- [ ] AC6 — **Quota Free, sequentiel (US-06.4)** : organisation Free a 49 liens repartis sur trois collections -> le 50e (dans une quatrieme collection) `201`, compteur 50 ; le 51e, dans **chacune** des quatre collections tour a tour -> `409 FREE_TIER_QUOTA_EXCEEDED`, message fixe et explicite, aucune ligne, compteur 50 = nombre reel. A 50 liens, une collection inexistante donne `404 COLLECTION_NOT_FOUND` (pas `409`) et une URL invalide `422`.
- [ ] AC7 — **Quota Free, concurrence (risque #3, ADR-0002)** :
  - (a) par l'API : 49 liens, **10** `POST` simultanes (connexions distinctes) dans une meme collection -> exactement **un** `201` et neuf `409 FREE_TIER_QUOTA_EXCEEDED` ; compteur = nombre reel = 50 ; scenario rejoue trois fois sur trois organisations neuves ;
  - (b) meme preuve **repartie sur plusieurs collections** : 49 liens, 10 `POST` simultanes repartis sur 5 collections de la meme organisation -> un seul `201` ;
  - (c) preuve **deterministe** du verrou, en base, deux connexions `signet_app` : T1 insere le 50e lien sans valider ; l'insertion de T2 est observee **en attente de verrou** (`pg_stat_activity.wait_event_type = 'Lock'`) ; T1 valide -> T2 recoit `SG001`, aucune ligne de T2 ; variante : T1 annule -> T2 reussit, compteur 50 ;
  - (d) en base, **10 connexions** `signet_app` simultanees a 49 liens -> une seule transaction validee, neuf `SG001`.
- [ ] AC8 — **Pro et retrogradation (ADR-0002, D-057)** : (a) organisation Pro (`link_quota` NULL) a 50 liens : le 51e -> `201` ; 10 `POST` simultanes -> 10 `201`, compteur = nombre reel ; (b) organisation passee de Pro a Free avec **75** liens : `link_quota` = 50, `link_count` = 75 ; tout ajout -> `409`, dans chaque collection ; les 75 liens restent (aucune suppression), compteur 75 = nombre reel ; (c) la meme repassee en Pro -> l'ajout reussit.
- [ ] AC9 — **Coherence du compteur** : (a) apres chaque scenario d'AC1 a AC8, `link_count = count(*)` pour chaque organisation touchee ; (b) une insertion refusee laisse le compteur inchange, pour chaque cause : quota (`SG001`), `CHECK` d'URL ou de titre (insertion directe sous `signet_app` avec contexte valide, `23514`), cle etrangere (`23503`), RLS (`42501`) ; (c) `signet_app` ne peut ni inserer, ni modifier, ni supprimer une ligne de `organization_link_usage` (`42501`) ; (d) compteur de l'organisation supprime par la connexion d'administration -> toute insertion de lien echoue (`P0001`), aucune ligne ; par l'API -> `500` generique, sans code SQL, message de base ni identifiant.
- [ ] AC10 — **Traduction des erreurs et niveau d'isolation (ADR-0002, contrat)** : la transaction de la route s'execute en `read committed` (lu par `current_setting('transaction_isolation')` dans `withTenant`) ; `SG001` -> `409 FREE_TIER_QUOTA_EXCEEDED` ; `40001` -> `409` (preuve en base : deux transactions `REPEATABLE READ` a 49 liens, la seconde recoit `40001` ; preuve de la traduction par la couche d'acces : `linkErrorFromSqlState` (D-123) rend l'erreur `409 FREE_TIER_QUOTA_EXCEEDED` pour `"SG001"` et `"40001"`, et `null` pour tout autre code et pour `undefined`) ; tout autre code -> `500` generique, journalise par son seul code. Le corps d'erreur ne contient jamais de code SQL, de nom de contrainte ni de message de Postgres.
- [ ] AC11 — **Session et forme du chemin** : sans session (ou cookie invalide) -> `401 UNAUTHENTICATED`, aucune ligne ; `organizationId` ou `collectionId` malforme -> `422` ; non-membre avec un corps invalide -> `422` (la validation precede l'appartenance, precedent 004).
- [ ] AC12 — **Catalogue (ADR-0001, ADR-0002, ADR-0011, ERD §6.2, §7)** : `link` a la RLS activee **et** forcee ; exactement une politique, `TO signet_app`, `USING` et `WITH CHECK` portant `organization_id = signet.current_org()`, aucune `TO PUBLIC`, aucune `signet_definer`, aucune n'appelle `context_org(` ; privileges de `signet_app` sur `link` : `SELECT` et `INSERT` seulement ; colonnes, `CHECK`, `link_collection_fk` (colonnes `(collection_id, organization_id)` vers `collection (id, organization_id)`, `ON DELETE CASCADE`), cle vers `organization` (`CASCADE`) et vers `app_user` (`RESTRICT`), trois index conformes a l'ERD ; un seul trigger utilisateur sur `link`, `AFTER INSERT FOR EACH ROW`, aucun trigger `DELETE` ni `UPDATE` (007) ; `signet.link_usage_on_insert()` est `SECURITY DEFINER`, proprietaire `signet_definer`, `search_path` fige avec `pg_temp` en dernier, `EXECUTE` refuse a `PUBLIC` et a tout role `signet_*` ; l'ensemble des fonctions `prosecdef` de `signet` = celui d'avant **plus** `link_usage_on_insert` exactement ; privileges de `organization_link_usage` inchanges ; invariants de 010 et de `tests/_factory` verts sans modification.
- [ ] AC13 — **Fonction definer sous contexte etranger (ADR-0002, ADR-0011, D-033)** : (a) appel direct de `signet.link_usage_on_insert()` sous `signet_app` refuse ; (b) sous la connexion d'administration, `app.organization_id` = B, insertion d'un lien de A : le compteur de **A** augmente, celui de B est inchange (la fonction se borne a `NEW.organization_id`, jamais au contexte ambiant) ; (c) sous `signet_app` avec contexte etranger force (AC5 c), aucune ligne de compteur ne change.
- [ ] AC14 — **Dependances et environnement** : aucune dependance ajoutee, aucune variable d'environnement nouvelle (verification **ponctuelle**, ecrite dans la fiche de preuves ; aucun test permanent qui compare a `main`).

## Anti-regression
- Suites 001, 002, 003, 004, 006, 010, 011 et `tests/_factory/*` vertes **sans modifier leurs assertions**, a l'exception decidee par l'humain (D-121, regle D-065 n°2 : liste fermee des fonctions definer dans deux tests de catalogue, ajout du seul nom `link_usage_on_insert`). Preuve : `git diff main -- tests/collections tests/invitation-acceptance` ne montre que cet ajout.
- Les tests de retrogradation de 002 (compteur au-dessus du plafond) restent verts : le trigger de 005 ne touche pas `link_quota`.
- `contract-guardian` : `docs/02-architecture/api-contracts/*` inchanges, sauf `addLink.input.url` et le declencheur du `422` (D-120 : resserrement d'entree, sortie inchangee) ; `addLink` implemente tel que contractualise.

## Notes d'implementation
- Patron de 003/004 : appartenance lue avec filtre explicite `WHERE m.organization_id = $1 AND m.user_id = $2` sous `withTenant` (RLS en seconde barriere) ; non-membre ou organisation inexistante -> `404` identique.
- Insertion en **une seule instruction** `INSERT ... SELECT ... FROM collection WHERE id = $c AND organization_id = $o RETURNING id, collection_id, url, title, added_by_user_id, created_at` : l'existence de la collection et l'insertion ne sont pas deux etapes ; une suppression concurrente de la collection (007) serait refusee par la cle composite. `organization_id` toujours explicite (regle absolue).
- `SG001` met la transaction en echec : l'erreur typee `409` est rendue sans `COMMIT` sur une transaction en echec (point de sauvegarde, patron D-092/D-116), choix ecrit dans le journal de tranche.
- Jamais de `SELECT link_count` avant l'insertion, ni pour decider, ni pour composer le message.
- **Traduction des erreurs SQL (D-123)** : `apps/web/src/lib/links/errors.ts` exporte `linkErrorFromSqlState(code: string | undefined): ApiError | null` ; `"SG001"` et `"40001"` -> l'erreur `409 FREE_TIER_QUOTA_EXCEEDED` (fabrique dans `lib/errors.ts`, message de D-119 lecture 2) ; tout autre code, ou `undefined` -> `null` (l'appelant rend alors le `500` generique). Fonction pure, sans acces a la base ; c'est elle que la route utilise, jamais une copie.
- **Tests (D-124)** : message du `409` compare mot pour mot au texte de D-119 lecture 2 ; textes des `422` non figes (absence de la valeur, de Zod et de SQL seulement) ; la journalisation « par son seul code » n'est pas testable depuis le processus de test et revient aux relecteurs ; `500` assertionne par son statut seul.
- Erreurs metier typees (`Result`) ; `throw` pour l'inattendu seulement.

## Lectures de l'orchestrateur (validees par l'humain, D-119 ; points 5 et 6 : forme seulement)
Aucune regle metier inventee ; ces points precisent la forme sans changer une regle des sources :
1. **Statut `201`** et **identifiant malforme dans le chemin -> `422`** (precedents 003/004, D-114).
2. **Message du `409` sans le nombre 50** : « Le quota de liens du palier Free est atteint : aucun lien n'a ete ajoute. Passer au palier Pro pour en ajouter d'autres. » La valeur 50 n'existe qu'a un endroit du systeme (`quota_for_tier`, ADR-0002) ; l'ecran (012) affichera « 50 / 50 » depuis le compteur. Ecarte : relire le plafond apres le refus (requete de plus sur une transaction annulee).
3. **URL enregistree telle que soumise apres `trim`**, jamais reecrite (`new URL().href` changerait la casse de l'hote, ajouterait `/`, encoderait en punycode : l'utilisateur ne reconnaitrait pas son lien). Le schema de casse est celui du contrat et du `CHECK` : `HTTPS://...` est refuse (`422`), comme aujourd'hui dans `links.ts`.
4. **`40001` traduit en `409`** comme l'exige le contrat, bien qu'inatteignable en `READ COMMITTED` ; limite ecrite dans le journal : si un jour la route passait en isolation stricte, un `40001` sur une organisation Pro serait annonce a tort comme un depassement de quota (a reexaminer alors, ADR-0002).
5. **« 200 caracteres » et « 2048 caracteres » = longueur mesuree par Zod** (unites UTF-16, apres `trim`), comme D-114 point 3 ; les `CHECK` (`char_length`) sont le filet.
6. **Nom de la fonction de trigger** `signet.link_usage_on_insert()` et de la politique `link_isolation` (l'ERD ne les nomme pas), noms de `CHECK` `link_url_scheme_chk`, `link_url_length_chk`, `link_title_length_chk`.
