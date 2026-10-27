# 009 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : couche de lecture committee (typecheck vert) ; routes GET a ecrire
- Branche : slice/009-consultation
- Dernier commit : eb72c7d feat(slice-009): lecture des collections et des liens d'une organisation
- Prochaine etape : ajouter `GET` aux deux `route.ts`, puis `pnpm vitest run tests/consultation`

## Couches
- [ ] Migration — sans objet (D-131 point 5 : aucune migration)
- [x] Acces donnees — eb72c7d (`listCollections` dans `lib/collections/collections.ts`, `listLinks` dans `lib/links/links.ts`, exports de contrat)
- [x] Logique metier — eb72c7d (meme module, patron de 004/005 : appartenance, collection, SELECT)
- [ ] API
- [ ] UI — sans objet (tranche 012)
- [ ] Suite complete verte + `pnpm run check`

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
