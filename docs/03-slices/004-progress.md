# 004 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : migration 0016 commitee ; acces donnees, logique et API en cours
- Branche : slice/004-creation-collection
- Dernier commit : 4558151 feat(slice-004): table collection, RLS et privileges (migration 0016)
- Prochaine etape : module `apps/web/src/lib/collections/` (contrat, creation sous `withTenant`), erreur `COLLECTION_NAME_TAKEN`, route POST
- D-113 : deja applique dans le commit d'ouverture 255fd28 (`tests/stack-upgrade/lint-scope.test.ts`, delai propre de 60 s sur les quatre `it`) ; rien a faire dans l'implementation. La mention « appliquer D-113 » de la version precedente de ce journal etait erronee.

## Couches
- [x] Migration — 4558151 (`0016_collection.sql`, schema `collections.ts`, ERD §6.1, matrice d'isolation, « Migrations appliquees », numerotation). 13/14 tests de `catalog.test.ts` verts ; l'echec restant est un defaut du test (voir Blocages).
- [ ] Acces donnees
- [ ] Logique metier
- [ ] API
- [ ] UI (aucune : tranche 012)
- [ ] Suite complete verte + `pnpm run check`

## Blocages
- **Test `catalog.test.ts` « PRIMARY KEY (id), UNIQUE (id, organization_id)... deux CHECK sur name » : assertion impossible a satisfaire.** Cause : `normalized()` ecrase les espaces (`squash`) puis supprime les parentheses ; la definition rendue par Postgres, `CHECK ((name = btrim(name)))`, devient `CHECK name = btrimname`, alors que le test attend `name = btrim name`. Aucune definition Postgres de `name = btrim(name)` (contrat ERD §6.1) ne produit un espace entre `btrim` et `name`. Essai : migration conforme au contrat, sortie observee `expected 'CHECK name = btrimname' to contain 'name = btrim name'`. Options : (a) corriger la chaine attendue du test en `name = btrimname` (modifie une assertion : decision humaine ou de l'auteur des tests) ; (b) laisser l'echec signale. Retenu : (b), la consigne interdit de modifier les assertions. Le reste du test (PK, UNIQUE, FK, CHECK de longueur) passe.
- `pnpm db:migrate` (base de developpement) echoue : `DATABASE_URL_MIGRATE n'est pas definie`. Variable non chargee dans le shell de l'agent ; action humaine. La base de test est migree par le globalSetup (`pnpm test`), ou 0016 s'applique.

## Decisions
<!-- Toute decision prise sans l'humain, avec sa raison. Reprise dans la PR. -->
- Ouverture en mode autonome (`/run-queue`, consigne `docs/04-runbooks/consigne-run-queue-004.md`) : lectures de l'orchestrateur sur le contrat inscrites au registre, a valider par l'humain (D-114). D-113 (humain) : delai propre de 60 s sur les quatre `it` de `tests/stack-upgrade/lint-scope.test.ts`, applique au commit d'ouverture 255fd28.
- Politique unique `collection_isolation` en `FOR ALL TO signet_app` (et non une politique par commande, comme `invitation_owner_*`) : le contrat exige exactement une politique ; les privileges (`SELECT, INSERT`) bornent deja les commandes possibles. Ecarte : deux politiques `FOR SELECT` / `FOR INSERT` (contredit AC8 « exactement une politique »).
- Noms des contraintes : `collection_id_organization_id_key` (convention Postgres pour `UNIQUE`), `collection_name_length_chk`, `collection_name_trimmed_chk` (convention `_chk` des tables existantes). L'ERD ne les nommait pas.
- Proprietaire de la table : `signet_owner`, comme `invitation` (0014) ; non precise par le contrat.
