# Rapport contract-guardian, tranche 013 (`slice/013-consultations-ecrans`)

J'ai lu `git diff main..HEAD` en lecture seule. Je n'ai lancé aucun test.

## Contrats existants
- **`api-contracts/` :** le seul fichier modifié est `organizations.ts`, et la modification est un ajout pur de 34 lignes (`listMyOrganizations`). `members.ts`, `_contract.ts` et les autres contrats n'apparaissent pas dans le diff.
- **`createOrganization` et `renameOrganization` :** leur forme, leurs codes d'erreur et leurs déclencheurs sont inchangés.
- **`POST /api/organizations` :** le diff de `apps/web/src/app/api/organizations/route.ts` ne fait qu'étendre l'import et ajouter un `GET`. Le corps du `POST` n'est pas touché. Il n'y a pas de rupture de comportement.

## Schéma de base et ERD
- Aucune migration, aucun fichier sous `db/` ou `drizzle/`, et `docs/02-architecture/ERD.md` n'est pas modifié. Le schéma est inchangé, comme D-138 point 5 le demandait.

## Types partagés
- `apps/web/src/lib/errors.ts` n'est pas modifié, et il n'y a pas de nouveau type partagé.
- `apps/web/src/lib/contracts.ts` ajoute seulement `listMyOrganizations` à la réexportation. C'est un ajout.
- `apps/web/src/lib/members/contracts.ts` est un nouveau fichier de réexportation.

## Conformité de l'implémentation

| Route | Contrat | Constat |
|---|---|---|
| `GET /api/organizations` | `listMyOrganizations` | Conforme. La sortie `{ id, name, createdAt }` est construite champ par champ, `createdAt` en `toISOString()` (compatible `z.string().datetime()`). |
| | | L'ordre est `created_at DESC, id DESC`. L'utilisateur lu est toujours celui de la session. |
| | | Le `401 UNAUTHENTICATED` est le seul code d'erreur produit en dehors de l'inattendu. La requête et le corps ne sont pas lus. |
| `GET /api/organizations/:organizationId/members` | `listMembers` | Conforme. La sortie `{ userId, email, role }` est construite champ par champ, avec `role` limité à owner/member. |
| | | Le `401` sans session et le `404 ORGANIZATION_NOT_FOUND` (non-membre ou organisation inexistante, même réponse) sont conformes. |
| | | L'accès est ouvert à owner et member, ce qui correspond à `minRole: "member"`. |

- **Ordre des membres :** `created_at ASC, user_id ASC`, conforme à D-138 point 3. Le sens du départage est tranché par D-139 point 4.
- **Filtre tenant :** `organization_id` est explicite dans les deux requêtes de `listMembers`, et `withTenant` pose la RLS en seconde barrière.

## Écarts entre contrat publié et comportement (aucun n'est une rupture)
1. **`422` non déclaré dans `listMembers.errors`.**
   - Un identifiant malformé renvoie `422 VALIDATION_FAILED` avec un message fixe.
   - Le contrat n'est pas modifié (D-138 point 3 : « tel quel »), donc la liste d'erreurs publiée est incomplète.
   - C'est le même écart que pour 009 (D-132 point 2, D-134), déjà au backlog.
   - Ce n'est pas une rupture : la route n'existait pas avant, et aucun client ne dépendait d'un autre code.
   - La compatibilité se fait en ajoutant le `422` à `errors` dans une tranche dédiée, ce qui est un ajout.
2. **`minRole: "public"` sur `listMyOrganizations`.**
   - La valeur est écrite telle que D-138 la fixe, alors que `_contract.ts` réserve `"public"` à « aucune authentification » (D-109).
   - Le comportement réel est un `401` sans session, donc c'est une incohérence documentaire du contrat, pas une divergence de comportement.
   - L'écart est déjà tracé (D-139 point 6) avec un passage à `"authenticated"` au backlog, décision humaine.
   - Ce changement futur de métadonnée de contrat touchera aussi `createOrganization` et sera à traiter comme une correction documentaire. Il ne casse aucun client.
3. **`email: z.string().email()` en sortie de `listMembers`.** Le serveur rend l'adresse telle qu'enregistrée, sans revalider en sortie. Une adresse stockée qui échouerait à ce schéma serait servie quand même. C'est une observation sans conséquence aujourd'hui, pas une rupture.

## Ruptures
Aucune. Il n'y a ni champ ou route supprimés, ni code de statut changé, ni colonne ou enum touchés, ni événement modifié. Les deux routes `GET` sont de nouvelles routes.

CONTRACTS: PASS
