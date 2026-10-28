# Rapport contract-guardian, tranche 009 (Consultation)

Lecture seule. Je n'ai pas lancé `pnpm test`. J'ai lu `git diff main..HEAD`, les deux contrats de référence et les deux `route.ts`. Je n'ai pas relu D-131 ni D-132 dans `docs/DECISIONS.md`. Pour le 422, je m'appuie donc sur le résumé de la consigne et sur le fait que 004 et 005 emploient déjà le 422 sur identifiant malformé.

## Points vérifiés

1. **Contrats de référence inchangés.** Le diff ne touche aucun fichier de `docs/02-architecture/api-contracts/`. Les modifications de `apps/web/src/lib/collections/contracts.ts` et de `apps/web/src/lib/links/contracts.ts` se limitent à ajouter `listCollections` et `listLinks` à la réexportation, et à mettre à jour un commentaire. Les routes valident donc avec les schémas du contrat, sans copie.

2. **`listCollections` conforme.**
   - La route `/api/organizations/:organizationId/collections`, la méthode GET et le rôle minimal `member` sont respectés. Le GET accepte owner et member, sans contrôle de rôle supplémentaire.
   - La sortie est un tableau d'objets `{ id, name, createdAt }`, construits champ par champ (`collections.ts`, `listCollections`). `createdAt` passe par `toISOString()`, ce qui satisfait `z.string().datetime()`. Aucun champ en plus.
   - Les erreurs sont 401 `UNAUTHENTICATED` et 404 `ORGANIZATION_NOT_FOUND`. Ce 404 est identique pour une organisation inexistante et pour un non-membre : la requête d'appartenance filtre sur `organization_id` et `user_id`.
   - Une liste vide renvoie `[]` avec 200.

3. **`listLinks` conforme.**
   - La route `.../collections/:collectionId/links`, la méthode GET et le rôle minimal `member` sont respectés.
   - La sortie est `{ id, url, title, addedBy, createdAt }`, construite champ par champ. `addedBy` vient de `added_by_user_id`. Aucun champ en plus.
   - Les erreurs sont 401, 404 `ORGANIZATION_NOT_FOUND` et 404 `COLLECTION_NOT_FOUND`. La collection est cherchée avec `c.id` et `c.organization_id` : une collection inexistante et une collection d'une autre organisation donnent le même 404.
   - L'ordre de contrat est tenu : appartenance, puis collection, puis liens.
   - Le tri `created_at DESC, id DESC` respecte la garantie écrite dans le contrat (`idempotency` : « createdAt desc, contrat garanti »). `id DESC` ne sert qu'à départager deux horodatages égaux.

4. **Le 422 sur identifiant malformé est une lecture compatible, pas une rupture.**
   - Ce cas n'a aucun ancien comportement contractuel : ces routes GET n'existaient pas avant la tranche 009.
   - La réponse suit le précédent déjà adopté par les POST de 004 et 005, avec la même forme `{ code, message }` et des messages fixes.
   - Le contrat GET ne liste pas le 422 parmi ses erreurs. C'est un écart de documentation du contrat, non un changement de comportement pour un cas existant.
   - Ce choix est déjà tracé comme lecture de forme à valider (D-132). Aucun client ne casse, et aucun ADR de migration n'est requis. Recommandation non bloquante : ajouter le 422 aux `errors` des deux contrats GET dans une tranche dédiée, car ces fichiers sont figés pendant cette tranche.

5. **`POST` de 004 et 005 inchangés.** Dans les deux `route.ts`, le diff ne contient que des ajouts : imports, commentaires, constante `INVALID_REQUEST` et fonctions `GET`. Les fonctions `POST`, `createCollection` et `addLink` n'ont aucune ligne modifiée, ni pour la forme, ni pour les statuts, ni pour les messages. Les constantes de message existantes sont réutilisées sans modification.

6. **Types partagés et schéma de base inchangés.** Le diff ne contient aucun fichier `packages/`, aucune migration et aucun fichier de schéma. Le seul changement sous `docs/02-architecture/` est dans `ERD.md` : une note de texte sur l'ordre de la liste des collections. Les types ajoutés (`CollectionListItem`, `LinkListItem`) restent internes à `apps/web/src/lib`.

## Écarts

- **Basse gravité, documentaire.** `docs/02-architecture/ERD.md` disait que l'index sert « la liste des collections triée par nom ». La note devient « triée de la plus récente à la plus ancienne », ce qui reprend D-131. Ce n'est pas un contrat d'API : `listCollections` ne garantit aucun ordre. Aucun consommateur n'existait avant cette tranche. Ce n'est donc pas une rupture, et le changement est documenté dans la même PR.
- **Basse gravité, observation.** L'ordre de `listCollections` n'est pas contractualisé, alors que celui de `listLinks` l'est. Les futurs clients pourront s'appuyer sur un ordre non garanti. Il serait utile de le garantir dans le contrat lors d'une tranche ultérieure.

Aucun champ supprimé ou renommé, aucun champ de requête devenu obligatoire, aucun code de statut changé pour un cas existant, aucune route déplacée ni aucune colonne touchée. Aucun besoin de stratégie de compatibilité ni d'ADR de migration.

Fichiers examinés :
- `C:\dev\mon-saas\apps\web\src\app\api\organizations\[organizationId]\collections\route.ts`
- `C:\dev\mon-saas\apps\web\src\app\api\organizations\[organizationId]\collections\[collectionId]\links\route.ts`
- `C:\dev\mon-saas\apps\web\src\lib\collections\collections.ts`
- `C:\dev\mon-saas\apps\web\src\lib\links\links.ts`
- `C:\dev\mon-saas\docs\02-architecture\api-contracts\collections.ts`
- `C:\dev\mon-saas\docs\02-architecture\api-contracts\links.ts`
- `C:\dev\mon-saas\docs\02-architecture\ERD.md`

CONTRACTS: PASS
