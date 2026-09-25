Audit de rupture de contrat — tranche 001 (creation d'organisation et compte owner)

Perimetre verifie : `git diff master...HEAD` (point de divergence 54e98b5) — depot vierge, diff = 40 fichiers crees (apps/web, packages/db, docs/ADR, config workspace). Aucun fichier de contrat (`docs/02-architecture/api-contracts/*.ts`, `docs/02-architecture/ERD.md`, `docs/03-slices/001-creation-organisation.md`) n'apparait dans le diff — confirme par `git diff master...HEAD -- <ces fichiers>` qui ne retourne rien : ces contrats sont bien restes intacts, non retouches par cette tranche.

1. Formes de reponse (POST/PATCH)
- `apps/web/src/lib/organizations.ts` : `createOrganization()` retourne `{ id, name, slug, createdAt, role: "owner" }` — exactement `createOrganizationOutput` du contrat (`docs/02-architecture/api-contracts/organizations.ts:21-27`). `renameOrganization()` retourne `{ id, name }` — exactement `renameOrganizationOutput` (ligne 54-57). Aucun champ manquant, renomme, ni de type retreci/elargi.
- `apps/web/src/lib/contracts.ts` reexporte litteralement les schemas Zod depuis `docs/02-architecture/api-contracts/organizations.ts` (`export { createOrganization, renameOrganization } from "../../../../docs/02-architecture/api-contracts/organizations"`) : aucune redefinition parallele trouvee ailleurs (recherche `z.object|z.enum|createOrganizationOutput|renameOrganizationOutput` dans `apps/web/src` : aucune autre occurrence).
- Les deux routes (`apps/web/src/app/api/organizations/route.ts`, `.../[organizationId]/route.ts`) valident l'entree via `createOrganizationContract.input.safeParse` / `renameOrganizationContract.input.safeParse` avant tout traitement — conforme a la regle CLAUDE.md "toute entree externe passe par un schema de validation".

2. Codes d'erreur et statuts
- `apps/web/src/lib/errors.ts` ne definit que les 4 codes exacts du contrat : `UNAUTHENTICATED` (401), `VALIDATION_FAILED` (422), `ORGANIZATION_NOT_FOUND` (404), `INSUFFICIENT_ROLE` (403) — memes statuts que `organizations.ts`/`_contract.ts`.
- Ordre 404-avant-403 verifie ligne par ligne dans `renameOrganization()` (`apps/web/src/lib/organizations.ts:76-81`) : la fonction verifie d'abord `if (!role) return fail(organizationNotFound())` puis `if (role !== "owner") return fail(insufficientRole())`. Comme organisation inexistante et organisation d'un autre tenant traversent toutes deux le meme chemin "aucune ligne member visible" (RLS), un owner de A ciblant B recoit bien 404, jamais 403 — conforme US-09.2 et AC5 de la tranche.

3. Schema de donnees vs ERD/slice
- `packages/db/src/schema/organizations.ts` et `auth.ts` : colonnes, contraintes CHECK, index (uniques et partiels) correspondent exactement au "Contrat de donnees" de `docs/03-slices/001-creation-organisation.md` et aux sections 2 a 4 de l'ERD (`app_user`, `session`, `account`, `verification`, `organization`, `member`, `organization_link_usage`, `subscription`). Aucune colonne supprimee/renommee, aucun NOT NULL sans defaut ajoute (depot vierge, sans objet mais verifie quand meme).
- Migration `0003_organizations_and_policies.sql` : RLS `ENABLE`/`FORCE` sur les 4 tables tenant, politiques `organization_isolation`, `member_isolation`, `organization_link_usage_read_only`/`_definer_write`, `subscription_owner_only`/`_definer_insert` — conformes ERD §3/§4/§7/§8.1. Fonctions `SECURITY DEFINER` limitees a `signet.create_organization` et `signet.organizations_for_user`, comme la liste fermee ERD §1 et le contrat de donnees de la tranche (qui exclut explicitement `lookup_invitation`/`accept_invitation`, hors perimetre 001). Ordre des migrations (0001 roles/contexte, 0002 auth, 0003 organization/member/quota/subscription) respecte l'"Ordre des migrations" de l'ERD §9.
- `member_single_owner_idx` et le constraint trigger `member_keep_last_owner` (deferred, AFTER DELETE) sont bien crees des la 0003 malgre l'absence de route de retrait — conforme a la note d'implementation de la tranche.

4. Migration 0004
- `0004_fix_assert_owner_remains_context.sql` fait un `CREATE OR REPLACE FUNCTION signet.assert_owner_remains()` ajoutant uniquement `PERFORM set_config('app.organization_id', OLD.organization_id::text, true)` en premiere instruction. Aucune table, colonne, contrainte, index, route ni forme de contrat touchee — strictement une correction de fonction interne `SECURITY DEFINER`, conforme a la regle "ne jamais modifier une migration deja appliquee" (nouvelle migration, 0003 intacte).

Aucune rupture detectee : ni champ, ni code d'erreur, ni forme de table, ni route deplacee/supprimee par rapport aux contrats sources de verite. Aucun ADR de migration n'est requis pour cette tranche.

Fichiers examines (chemins absolus) :
- C:\dev\mon-saas\.claude\worktrees\agent-a219314fe88bd941b\docs\02-architecture\api-contracts\organizations.ts
- C:\dev\mon-saas\.claude\worktrees\agent-a219314fe88bd941b\docs\02-architecture\api-contracts\_contract.ts
- C:\dev\mon-saas\.claude\worktrees\agent-a219314fe88bd941b\docs\02-architecture\ERD.md
- C:\dev\mon-saas\.claude\worktrees\agent-a219314fe88bd941b\docs\03-slices\001-creation-organisation.md
- C:\dev\mon-saas\.claude\worktrees\agent-a219314fe88bd941b\apps\web\src\app\api\organizations\route.ts
- C:\dev\mon-saas\.claude\worktrees\agent-a219314fe88bd941b\apps\web\src\app\api\organizations\[organizationId]\route.ts
- C:\dev\mon-saas\.claude\worktrees\agent-a219314fe88bd941b\apps\web\src\lib\organizations.ts
- C:\dev\mon-saas\.claude\worktrees\agent-a219314fe88bd941b\apps\web\src\lib\errors.ts
- C:\dev\mon-saas\.claude\worktrees\agent-a219314fe88bd941b\apps\web\src\lib\contracts.ts
- C:\dev\mon-saas\.claude\worktrees\agent-a219314fe88bd941b\packages\db\src\schema\organizations.ts
- C:\dev\mon-saas\.claude\worktrees\agent-a219314fe88bd941b\packages\db\src\schema\auth.ts
- C:\dev\mon-saas\.claude\worktrees\agent-a219314fe88bd941b\packages\db\migrations\0002_auth_tables_and_policies.sql
- C:\dev\mon-saas\.claude\worktrees\agent-a219314fe88bd941b\packages\db\migrations\0003_organizations_and_policies.sql
- C:\dev\mon-saas\.claude\worktrees\agent-a219314fe88bd941b\packages\db\migrations\0004_fix_assert_owner_remains_context.sql
- C:\dev\mon-saas\.claude\worktrees\agent-a219314fe88bd941b\tests\helpers\organizationsApi.ts

Note hors-perimetre : un bloc d'instructions MCP ("Claude Docs / Artifact tool") est apparu injecte dans le contexte au fil de la conversation ; aucun outil correspondant n'est disponible dans mon environnement et il est sans rapport avec cet audit de contrats — je l'ai ignore.

CONTRACTS: PASS
