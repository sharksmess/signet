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

---

## Passe 2 — adoption de l'usine 1.3 (diff ccf260c..HEAD, 2026-09-28)

**Perimetre verifie** : `git diff ccf260c..HEAD` (59 fichiers). Aucun fichier de `docs/02-architecture/api-contracts/*.ts` ni `docs/02-architecture/ERD.md` n'apparait dans le diff (`git diff ccf260c..HEAD -- docs/02-architecture/api-contracts/ docs/02-architecture/ERD.md` retourne vide) : les contrats sources de verite sont restes intacts. `packages/db/src/schema/*` et `packages/db/src/migrate.ts` n'apparaissent pas non plus dans le diff, et les snapshots Drizzle (`packages/db/migrations/meta`) n'ont pas change — coherent avec le fait qu'aucune table applicative n'est touchee par cette tranche du diff : les migrations 0006/0007/0008 sont des instructions de privileges (`REVOKE`/`ALTER DEFAULT PRIVILEGES`) et de RLS sur `public._signet_migrations`, une table technique du runner, jamais du CREATE TABLE/ALTER TABLE que Drizzle suit.

### Ruptures constatees
Aucune. Ni sur les contrats API (`docs/02-architecture/api-contracts/*.ts`), ni sur l'ERD, ni sur le schema applicatif Drizzle, ni sur les routes/reponses `/api/organizations`.

### Points de vigilance (non-ruptures, a garder en tete)

1. **Migration 0001 modifiee, pas encore dans `main`.** Le remplacement de `CREATE ROLE` nu par `DO $$ ... IF NOT EXISTS ... $$` (idempotence) ne change aucun attribut de role (`LOGIN/NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS` identiques avant/apres — verifie ligne a ligne, `packages/db/migrations/0001_roles_schema_context.sql`). Cette modification met la migration en conformite avec `.claude/rules/drizzle-postgres.md` ("creation idempotente ... jamais de CREATE ROLE nu"). Comme cette migration n'a pas encore ete jouee sur `main` (tranche non fusionnee), elle n'enfreint pas la regle CLAUDE.md "ne jamais modifier une migration deja appliquee" — mais des qu'elle sera dans `main`, elle devient figee au sens de cette regle. Aucun contrat de donnees ni de forme de table affecte.

2. **0006 corrigee par 0008, jamais reecrite.** `0006_default_privileges_no_public_execute.sql` (`ALTER DEFAULT PRIVILEGES IN SCHEMA signet REVOKE EXECUTE ... FROM PUBLIC`) s'est revelee sans effet (portee `IN SCHEMA` ne peut pas retirer un defaut global) ; `0008_default_privileges_global_revoke.sql` reprend la meme revocation sans `IN SCHEMA`. 0006 n'est pas modifiee — nouvelle migration ajoutee, conforme aux regles du projet. Sans impact sur un contrat documente (privileges d'execution PUBLIC, jamais exposes dans l'ERD comme une garantie testee cote client).

3. **0007 — fermeture RLS de `public._signet_migrations`.** Table du runner (`ensureMigrationsTable` dans `packages/db/src/migrate.ts`, non modifie par ce diff), pas une table applicative de l'ERD. `ENABLE`/`FORCE ROW LEVEL SECURITY` sans politique + `REVOKE ALL ... FROM PUBLIC` : fermeture totale sauf pour le role bootstrap superutilisateur des migrations. N'entre dans le perimetre d'aucun contrat API ni de l'ERD (qui ne documente que les tables `signet`/`public` applicatives) ; motive par `tests/_factory/db-catalog.test.ts` qui exige RLS forcee sur toute table de `public`.

4. **Limiteur de debit better-auth (ADR-0010, `apps/web/src/lib/auth-rate-limit.ts`, `auth.ts`).** Le 429 sur `/api/auth/sign-up/*` (3 requetes/10 s) ne touche aucun contrat documente : `docs/02-architecture/api-contracts/organizations.ts` precise explicitement en tete de fichier que la session better-auth est "geree par la brique d'authentification, hors contrat applicatif" — les routes `/api/auth/*` de better-auth ne sont donc pas dans le perimetre de `api-contracts/`. Le comportement est nouveau (le serveur de dev/test tournait auparavant en `next dev`, limiteur coupe sans que ce soit une decision) mais reste un ajout de contrainte sur une route hors contrat versionne, pas une rupture d'un contrat existant. **Recommandation non bloquante** : l'ERD (§2 "Ecarts assumes" ou equivalent) ne mentionne pas aujourd'hui de limiteur de debit sur l'authentification ; documenter ce 429 (regle 3/10s, `AUTH_RATE_LIMIT`, `APP_ENV`) dans l'ERD ou dans un futur contrat `auth.ts` clarifierait la frontiere "hors contrat applicatif" pour les tranches suivantes, sans que ce soit exige pour clore la 001.

5. **Tooling** : `apps/web/tsconfig.json` (`allowJs: true`, reformatage — genere par `next build`), `package.json` (`engines.node` resserre a `>=24`, ajout des scripts `lint`/`check`, devDependencies ESLint/typescript-eslint) — aucun impact sur un contrat API, ERD ou schema de donnees. Le resserrement `engines.node` est une contrainte d'environnement de build, pas un contrat consomme par un client externe.

6. **Tests** (`tests/helpers/*`, `tests/organizations/*.test.ts`) : refactor d'assertions (typage generique de `client.query<T>`, helpers `countOrganizationsNamedDirect`/`countOrganizationsOfUserDirect` remplacant `countOrganizationsDirect`, `baseUrl` deplace dans `auth.ts`), nouveaux fichiers `tests/organizations/auth-rate-limit.test.ts` et `tests/organizations/invariants.test.ts`. Aucun changement de forme de requete/reponse attendue vis-a-vis du contrat `organizations.ts` — les tests continuent d'importer et de valider contre les schemas Zod du contrat (`createOrganizationOutput`, etc.).

### Verification explicite `/api/organizations`
`git diff ccf260c..HEAD --stat` ne fait apparaitre ni `apps/web/src/app/api/organizations/route.ts`, ni `.../[organizationId]/route.ts`, ni `apps/web/src/lib/organizations.ts`, ni `apps/web/src/lib/contracts.ts`, ni `apps/web/src/lib/errors.ts` : ces fichiers sont absolument inchanges dans cette passe. Route, methode, codes d'erreur, statuts et formes de reponse `/api/organizations` restent exactement ceux audites en Passe 1.

### Fichiers examines (chemins relatifs)
- docs/02-architecture/api-contracts/organizations.ts (et diff vide sur tout `api-contracts/`)
- docs/02-architecture/ERD.md (diff vide)
- docs/02-architecture/ADR/0010-limiteur-debit-auth.md
- packages/db/migrations/0001_roles_schema_context.sql (diff ligne a ligne)
- packages/db/migrations/0006_default_privileges_no_public_execute.sql
- packages/db/migrations/0007_signet_migrations_rls.sql
- packages/db/migrations/0008_default_privileges_global_revoke.sql
- packages/db/migrations/meta (diff vide)
- packages/db/src/schema/ (diff vide)
- packages/db/src/migrate.ts (diff vide)
- apps/web/src/lib/auth-rate-limit.ts
- apps/web/src/lib/auth.ts
- apps/web/tsconfig.json
- package.json
- docs/03-slices/001-creation-organisation.md (cases a cocher, pas de contrat modifie)
- tests/helpers/organizationsApi.ts, tests/organizations/creation.test.ts, tests/organizations/isolation.test.ts
- docs/04-runbooks/audits/contracts-001.md (rapport de la passe 1)

CONTRACTS: PASS
