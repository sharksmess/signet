# Rapport contract-guardian, tranche 004 (creation d'une collection)

Branche `slice/004-creation-collection`, diff `git diff main...HEAD`. Je n'ai pas lancé `pnpm test`.

## 1. Contrats d'API
`git diff main...HEAD --stat -- docs/02-architecture/api-contracts` est vide. Aucun fichier de contrat n'est modifié, ce qui correspond à ce qui était annoncé. Le contrat `createCollection` figure déjà dans `collections.ts`, et `lib/collections/contracts.ts` ne fait que le ré-exporter. La route valide donc avec le schéma du contrat, pas avec une copie.

## 2. Conformité de la route au contrat `createCollection`
Fichiers examinés : `apps/web/src/app/api/organizations/[organizationId]/collections/route.ts` et `apps/web/src/lib/collections/collections.ts`.

| Point du contrat | Constat | Verdict |
|---|---|---|
| Route et méthode : `POST /api/organizations/:organizationId/collections` | Même chemin, `POST` | conforme |
| Entrée : `organizationId` en `Uuid`, `name` en `trim().min(1).max(100)` | Le schéma du contrat valide `{...body, organizationId}`. L'`organizationId` du chemin l'emporte sur celui du corps. | conforme |
| Sortie : `id`, `organizationId`, `name`, `createdAt` (datetime) | Les quatre champs sont renvoyés. `createdAt` passe par `toISOString()`. Statut 201. | conforme |
| 401 `UNAUTHENTICATED` (aucune session) | Rendu avant toute validation | conforme |
| 404 `ORGANIZATION_NOT_FOUND` (organisation inexistante ou appelant non membre) | La recherche d'appartenance filtre sur `organization_id` et `user_id`. Le 404 est le même dans les deux cas, et owner et member passent (`minRole: member`). | conforme |
| 422 `VALIDATION_FAILED` (nom vide ou trop long) | Corps non objet ou non JSON, `organizationId` invalide et nom invalide donnent tous 422. Les messages sont fixes. | conforme |
| 409 `COLLECTION_NAME_TAKEN` | Rendu sur `23505` de l'index `collection_org_name_ci_idx`, sans lecture préalable. L'insertion est sous point de sauvegarde et la transaction reste saine. | conforme |
| Idempotence : non idempotente, un rejeu après succès donne 409 | Chaque appel réussi insère une ligne. Un rejeu, y compris avec une casse différente, donne 409 par l'index. | conforme |

Deux remarques sans rupture :
- Le contrat ne dit rien sur un `organizationId` mal formé. L'implémentation répond 422, ce qui reste dans la fourchette de `VALIDATION_FAILED` et correspond à la lecture D-114. Elle ne casse rien, mais le contrat ne la couvre pas explicitement.
- Le corps JSON invalide ou absent donne 422. C'est cohérent avec le contrat.

## 3. Schéma de base et ERD §6.1
Les colonnes, types, valeurs par défaut, clés étrangères (`ON DELETE cascade` pour l'organisation, `restrict` pour `created_by_user_id`), contraintes et index de `0016_collection.sql` correspondent ligne à ligne à l'ERD §6.1.

- **Contraintes :** `UNIQUE (id, organization_id)`, `collection_name_length_chk` et `collection_name_trimmed_chk` sont présentes.
- **Index :** `collection_org_name_ci_idx` est un unique fonctionnel sur `(organization_id, lower(btrim(name)))`.
- **RLS et privilèges :** la RLS est activée et forcée, avec une seule politique `collection_isolation` pour `signet_app`. Le `GRANT` est limité à `SELECT, INSERT`. L'ERD (§6.1, matrice d'isolation, tableau des migrations) est mis à jour dans la même PR.
- **Schéma TypeScript :** `packages/db/src/schema/collections.ts` est aligné avec la migration. `schema/index.ts` gagne un `export *`, ce qui est additif.
- **Migrations existantes :** aucune n'est modifiée. Le diff ne contient que l'ajout de 0016, de `meta/0006_snapshot.json` et d'une entrée en fin de `_journal.json`.
- **Tables existantes :** 0016 ne touche aucune table existante (une création de table et ses dépendances). Aucune colonne n'est supprimée, renommée ou passée en NOT NULL. Aucune migration antérieure ne référence `collection`.

## 4. Types partagés (`apps/web/src/lib/errors.ts`)
Le diff ajoute `COLLECTION_NAME_TAKEN` en fin d'union `ApiErrorCode`, ajoute la fabrique `collectionNameTaken` (409) et met à jour un commentaire. Aucun code existant n'est modifié ni retiré. Le statut 409 était déjà dans l'union `status`. C'est un ajout en fin de liste, donc pas une rupture.

## 5. Autres fichiers touchés
Le test `tests/stack-upgrade/lint-scope.test.ts` reçoit seulement des délais propres (60 s). Ce changement est hors contrat et n'a aucun effet sur les interfaces. Aucun webhook ni événement de file n'est modifié.

## Synthèse
- Aucune rupture : aucune suppression ou renommage de champ, aucun changement de statut sur un cas existant, aucune colonne retirée, aucune valeur d'énumération retirée.
- Il n'y a donc pas de besoin de stratégie de compatibilité ni d'ADR de migration.
- Aucune divergence à signaler entre l'état actuel, le contrat `createCollection` et l'ERD §6.1.

CONTRACTS: PASS
