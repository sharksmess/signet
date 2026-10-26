# 004 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : auditee (security-auditor, contract-guardian, code-reviewer : PASS, `docs/04-runbooks/audits/review-004.md`) ; correctifs de relecture appliques (A CORRIGER 1, A CORRIGER 2, SUGGESTION 1)
- Branche : slice/004-creation-collection
- Dernier commit : 616d428 test(slice-004): figer les messages d'erreur et durcir le test RLS
- Prochaine etape : cloture par l'orchestrateur (registre, journal de projet 20, fiche de preuves avec AC9, suite complete, `close-slice.sh`)
- Resultats actuels : `pnpm exec vitest run tests/collections` 72 passes / 72 (5 fichiers) ; `pnpm run check` vert (typecheck + eslint). Suite complete apres D-115 (rapport de l'orchestrateur) : 487 passes, 1 ignore ; relancee par l'orchestrateur a la cloture.
- D-113 : deja applique dans le commit d'ouverture 255fd28 (`tests/stack-upgrade/lint-scope.test.ts`, delai propre de 60 s sur les quatre `it`) ; rien a faire dans l'implementation. La mention « appliquer D-113 » d'une version precedente de ce journal etait erronee.

## Couches
- [x] Migration — 4558151 (`0016_collection.sql`, schema `collections.ts`, ERD §6.1, matrice d'isolation, « Migrations appliquees », numerotation)
- [x] Acces donnees + logique metier — 7c00543 (`lib/collections/{contracts,collections}.ts`, `collectionNameTaken` dans `errors.ts`)
- [x] API — a5d7278 (`POST /api/organizations/:organizationId/collections`)
- [x] Lint des tests — 1d2b39f (deux `client.query` types, aucune assertion touchee)
- [x] Correction du test CHECK — 714ace9 (D-115, `test-writer`)
- [x] Correctifs de relecture — 616d428 (`tests/collections/decisions.test.ts` : messages fixes, D-114 point 4 ; `catalog.test.ts` : politique stricte)
- [ ] UI (aucune : tranche 012)
- [x] `tests/collections` vert + `pnpm run check` vert ; suite complete : relance par l'orchestrateur a la cloture

## Blocages
- **Resolu par D-115 (714ace9)** — test `catalog.test.ts` « ... deux CHECK sur name » : l'assertion `name = btrim name` etait inatteignable (`normalized()` ecrase les espaces puis retire les parentheses : `CHECK ((name = btrim(name)))` devient `CHECK name = btrimname`). Remplacee par une regex ancree par `test-writer` (voir Decisions).
- `pnpm db:migrate` (base de developpement) echoue : `DATABASE_URL_MIGRATE n'est pas definie`. Variable non chargee dans le shell de l'agent ; action humaine. La base de test est migree par le globalSetup (`pnpm test`), ou 0016 s'applique.

## Decisions
<!-- Toute decision prise sans l'humain, avec sa raison. Reprise dans la PR. -->
- Ouverture en mode autonome (`/run-queue`, consigne `docs/04-runbooks/consigne-run-queue-004.md`) : lectures de l'orchestrateur sur le contrat inscrites au registre, a valider par l'humain (D-114). D-113 (humain) : delai propre de 60 s sur les quatre `it` de `tests/stack-upgrade/lint-scope.test.ts`, applique au commit d'ouverture 255fd28.
- Politique unique `collection_isolation` en `FOR ALL TO signet_app` (et non une politique par commande, comme `invitation_owner_*`) : le contrat exige exactement une politique ; les privileges (`SELECT, INSERT`) bornent deja les commandes possibles. Ecarte : deux politiques `FOR SELECT` / `FOR INSERT` (contredit AC8 « exactement une politique »).
- Noms des contraintes : `collection_id_organization_id_key` (convention Postgres pour `UNIQUE`), `collection_name_length_chk`, `collection_name_trimmed_chk` (convention `_chk` des tables existantes). L'ERD ne les nommait pas.
- Proprietaire de la table : `signet_owner`, comme `invitation` (0014) ; non precise par le contrat.
- Un `23505` sur `collection_org_name_ci_idx` est traite par **point de sauvegarde** (patron D-092, comme 003 et 006) : `ROLLBACK TO SAVEPOINT` puis `409`, `withTenant` valide une transaction saine qui n'a rien ecrit. Ecarte : traduire l'erreur apres le `ROLLBACK` de `withTenant` (exigerait une classe d'erreur a intercepter hors du module, ou une modification de `db.ts`, hors perimetre).
- Toute autre erreur SQL de l'insertion : journalisee par son seul code (`[collections] creation : erreur inattendue de la base (code ...)`), puis relevee sans detail (500 generique de Next), comme `accept.ts` (006).
- Messages de `422` fixes, deux seulement selon le champ fautif : « Identifiant d'organisation invalide. » si une erreur Zod porte sur `organizationId`, sinon « Nom de collection invalide : 1 a 100 caracteres, espaces de bord exclus. » ; « Corps JSON attendu. » pour un corps non JSON ou non objet (meme texte que 003). Ecarte : `parsed.error.message` comme en 003 (contraire a D-114 point 4).
- Message du `409` : « Une collection de cette organisation porte deja ce nom. » (fixe, sans le nom).
- La reponse `201` reprend `organization_id` et `name` tels que rendus par `RETURNING` (donc la forme enregistree en base), et `created_at.toISOString()` (UTC, millisecondes).
- Deux `client.query` des tests deja ecrits (`catalog.test.ts` l. 271, `isolation.test.ts` l. 164) recoivent un parametre de type `<{ id: string }>` : `pnpm run check` les refusait (`no-unsafe-return`). Aucune assertion modifiee. Ecarte : desactiver la regle (interdit), laisser `check` rouge.
- `pnpm db:migrate` n'a pas ete lance sur la base de developpement (`DATABASE_URL_MIGRATE` absente du shell de l'agent) ; 0016 est appliquee a la base de test par le globalSetup.
- Correction du test AC8 (`tests/collections/catalog.test.ts`, CHECK `name = btrim(name)`, D-115) : l'assertion passait par `normalized()`, qui retire les parentheses, et cherchait `name = btrim name`, chaine inatteignable (defaut du test, pas du code). Remplacee par une regex ancree sur la definition Postgres, `^CHECK [(]+name = btrim[(]name[)]+$`, qui tolere les parentheses doublees mais echoue si la contrainte disparait ou devient autre chose (ex. `name = lower(name)`).
- **Preuve de D-114 point 4 (review-004 A CORRIGER 1, 616d428)** : `tests/collections/decisions.test.ts` compare le `message` de chaque erreur, par egalite, a la liste exacte des textes fixes : « Corps JSON attendu. » (corps non JSON, tableau, nombre, `null`) ; « Identifiant d'organisation invalide. » (`pas-un-uuid`, UUID a caractere non hexadecimal, et chemin invalide + nom invalide : le chemin prime) ; « Nom de collection invalide : 1 a 100 caracteres, espaces de bord exclus. » (nom absent, vide, fait d'espaces, 101 caracteres, nombre, `null`, tableau) ; « Une collection de cette organisation porte deja ce nom. » (409). Chaque 422 est aussi verifie sans fragment de Zod (`Too big`, `Too small`, `too_big`, `too_small`, `expected`, `received`, `Invalid`, `invalid_type`, `invalid_format`, `"path"`, `"code": "`). Fichier nouveau plutot qu'un ajout a `creation.test.ts` : les assertions des tests deja ecrits restent intactes, et le fichier porte le nom de ce qu'il protege.
- **Mutation (2026-10-26)** : dans la route, `validationFailed(pathIsInvalid ? INVALID_ORGANIZATION_ID : INVALID_NAME)` remplace temporairement par `validationFailed(parsed.error.message)`. Resultat de `pnpm exec vitest run tests/collections/decisions.test.ts` : **10 en echec, 5 passes (15)**. Echouent les 3 cas de chemin invalide et les 7 cas de nom invalide ; passent les 4 cas de corps (branche non mutee) et le 409. Route restauree par `git checkout`, `git diff -- apps/` vide ; rien de la mutation n'est committe.
- **Test de politique strict (review-004 SUGGESTION 1, 616d428)** : `catalog.test.ts` verifie `polcmd = '*'` (FOR ALL), et compare `USING` et `WITH CHECK`, normalises (espaces, parentheses, `signet.`), par **egalite** a `organization_id = current_org`. Une politique `... OR true` ou une conjonction quelconque echoue. Les autres assertions sont inchangees.
