# 009 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : implementation terminee. `tests/consultation` 38/38 ; `pnpm run check` vert ; suite complete 58 fichiers, 718 passes, 1 ignore, 0 echec (153 s, 2026-10-27 17:10). Le test ignore est preexistant et sans lien : `tests/invitations/environment.test.ts:208`, `it.runIf` sur une branche `slice/003-`.
- Branche : slice/009-consultation
- Dernier commit : 35c8365 docs(slice-009): journal et criteres apres les routes GET (code : 08de798)
- Prochaine etape : orchestrateur — AC12 (verification ponctuelle), trois relecteurs, registre, `close-slice.sh`

## Couches
- [ ] Migration — sans objet (D-131 point 5 : aucune migration)
- [x] Acces donnees — eb72c7d (`listCollections` dans `lib/collections/collections.ts`, `listLinks` dans `lib/links/links.ts`, exports de contrat)
- [x] Logique metier — eb72c7d (meme module, patron de 004/005 : appartenance, collection, SELECT)
- [x] API — 08de798 (`GET` ajoute aux deux `route.ts`, `POST` inchanges)
- [ ] UI — sans objet (tranche 012)
- [x] Suite complete verte + `pnpm run check` (AC11 : `tests/collections/**` et `tests/links/**` verts sans modification)

## Blocages

## Decisions
- Ouverture (orchestrateur) : lectures de forme D-132 (contrat de tranche, section « Lectures de l'orchestrateur ») ; ERD §6.1 aligne sur D-131 point 1.
- Tests (test-writer) : 38 tests dans `tests/consultation/` (nominal, order, errors, isolation, read-only) + `tests/helpers/consultation.ts`. 36 echouent en 405 (GET non exporte) ; 2 passent deja (AC6 d, SELECT sous signet_app : la RLS existe deja, non-regression).
- Horodatage egal (AC2) : ids fixes par le test (prefixe aleatoire + suffixe 1 a 6) inseres dans l'ordre 3,6,1,5,2,4, pour que l'ordre d'insertion differe de l'ordre des ids de facon deterministe ; precondition verifiee (un seul created_at).
- Messages de 422 : on prouve qu'ils sont fixes (sans la valeur soumise ni Zod) et lesquels sont distincts, sans figer les textes (precedent D-124).
- AC9 : un test supplementaire sur le nom de collection (le contrat de creation l'accepte ; le contrat de tranche rend `name` tel qu'enregistre). D-131 point 4 ne cite que l'URL et le titre : extension inscrite en D-132 point 6 par l'orchestrateur, a valider par l'humain.
- Implementation (implementeur) — acces donnees et logique metier dans le meme module, comme 004 et 005 (`createCollection`, `addLink`) : une seule fonction par lecture qui ouvre `withTenant`, verifie l'appartenance puis lit. Ecarte : un module de requetes separe (aucun precedent dans le depot, double les points d'entree sans gain de test).
- Implementation (implementeur) — liens : deux instructions (existence de la collection `c.id AND c.organization_id`, puis `SELECT` sur `link` avec `organization_id` et `collection_id` explicites) plutot qu'une jointure `LEFT JOIN`. Raison : « collection absente » et « liste vide » se distinguent sans logique sur des lignes nulles ; cout d'un aller-retour supplementaire dans la meme transaction. Ecarte : jointure unique (acceptee par le contrat de tranche, mais plus fragile a relire).
- Implementation (implementeur) — erreurs inattendues : `listCollections` et `listLinks` enveloppent `withTenant` et journalisent le seul code SQL (`[collections] lecture : ...`, `[links] lecture : ...`) avant de relever une erreur sans detail, comme `unexpected()` des POST. Raison : `withTenant` releve l'erreur `pg` brute, dont `detail` peut contenir des valeurs ; sans enveloppe, Next la journaliserait telle quelle. Ecarte : laisser remonter l'erreur brute.
- Implementation (implementeur) — types de sortie dedies (`CollectionListItem`, `LinkListItem`) distincts de `CollectionView`/`LinkView` des POST : la liste ne porte ni `organizationId` ni `collectionId` (AC1, cles exactes) ; les vues des POST sont inchangees.
- Implementation (implementeur) — routes : le `GET` reutilise dans chaque fichier `errorResponse`, `canonical` et, pour les liens, `FIELD_MESSAGES` (organisation prioritaire sur collection) ; le code des `POST` n'est pas modifie. Collections : repli neutre « Requete invalide. » ajoute pour un refus du schema hors `organizationId` (meme texte que le repli de 005). Ecarte : extraire un module partage (hors perimetre de fichiers, et les `POST` auraient change de forme).
- Implementation (implementeur) — `200` par `NextResponse.json(result.value)` : la projection champ par champ est faite une seule fois, dans le module de lecture. Le gestionnaire lit les en-tetes (session), donc il est dynamique : aucune reponse mise en cache par Next (AC7 vert).
