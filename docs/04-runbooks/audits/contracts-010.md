Everything is thoroughly documented and consistent with the actual diff. I have enough evidence to issue the verdict.

## Rapport de verification des contrats — tranche 010 (durcissement de l'isolation tenant)

**Diff examiné** : `git diff main...HEAD` (21 fichiers, branche `slice/010-durcissement-isolation`), lecture seule.

### API HTTP (`docs/02-architecture/api-contracts/organizations.ts`)
- Fichier **absent du diff** (non modifié). Confirmé par `git diff main...HEAD --stat -- docs/02-architecture/api-contracts` : vide.
- `apps/web/src/lib/organizations.ts` (logique métier des deux routes) : **absent du diff**. Aucune route, aucun handler applicatif, aucun schéma Zod (`contracts.ts`) touché.
- Seul fichier applicatif modifié : `apps/web/src/lib/db.ts` — uniquement des commentaires JSDoc ajoutés sur `withTenant`/`withUserOnly` ; le code (signatures, logique, `SET LOCAL`) est identique.
- `createOrganization()` (métier) appelle déjà `withUserOnly(userId, …)` puis `SELECT * FROM signet.create_organization($1, $2)` avec `$1 = userId`. La nouvelle garde `SG002` de la fonction SQL (owner ≠ utilisateur de session) ne peut donc jamais se déclencher via le chemin applicatif existant — le comportement observable de la route `POST /api/organizations` est inchangé.
→ **NON-BREAKING.**

### Fonctions SQL `signet.*` appelées par l'application
- `create_organization(uuid, text)` → `public.organization` : **signature et type de retour inchangés**. Ajout d'une garde d'identité en tête de corps (`RAISE ... SG002`), qui ne s'active que si `app.user_id` est absent ou diffère du paramètre — cas non atteignable par le code applicatif actuel (il passe toujours le même `userId`).
- `organizations_for_user(uuid)` → `SETOF public.organization` : idem, signature inchangée ; même garde `SG002`.
- `current_org()` : primitive interne aux politiques RLS, jamais appelée directement par l'application (vérifié par grep) ; son remplacement par une version « vérifiée » (SECURITY DEFINER) au lieu de « brute » ne change ni signature ni surface consommée par l'app.
- `SG002` est explicitement documenté (ERD §0) comme **erreur d'invariant serveur, remontée en 500**, pas une erreur métier typée du contrat — cohérent avec la règle CLAUDE.md « `throw` réservé aux invariants qui ne devraient jamais arriver ». Elle n'ajoute donc pas de code d'erreur au contrat `organizations.ts` (qui liste 401/422/403/404) et n'altère aucun cas déjà consommé.
→ **NON-BREAKING** (nouveau comportement défensif interne, invisible du client tant que le serveur passe correctement `app.user_id`, ce qui est déjà le cas).

### Schéma / ERD
- Aucune table, colonne, contrainte ni index modifié. Confirmé par `git diff --stat` sur `packages/db/src/schema` et sur les migrations 0001-0008 : **diffs vides**, ces fichiers ne sont pas touchés.
- Deux nouvelles migrations, additives uniquement :
  - `0009_rls_session_user_membership.sql` : nouvelle fonction `signet.context_org()`, remplacement de `signet.current_org()` (`CREATE OR REPLACE`, texte des politiques `signet_app` inchangé — seule la vérification sous-jacente change), nouvelles politiques `*_definer_context` pour `signet_definer`, ajout de la garde `SG002` dans `create_organization`/`organizations_for_user`, complément de `search_path` (`pg_temp`) sur trois fonctions trigger (corps inchangé).
  - `0010_reimpose_role_attributes.sql` : réimpose idempotemment les attributs des 4 rôles `signet_*` et lève si l'un est membre d'un autre rôle — aucun schéma de données touché.
- `ERD.md` mis à jour dans la même tranche (§0, §1, §2.1, §3, §4, §7, §8.1, matrice d'isolation, table des migrations appliquées), en cohérence avec les migrations. Amendements documentés sur ADR-0004 (point 4) et ADR-0007, nouvel ADR-0011 complet.
- `docs/DECISIONS.md` : D-027, D-028 ajoutées, conformes à la règle de documentation.
→ **NON-BREAKING / INFO** : durcissement de sécurité pur (seconde barrière RLS par appartenance), aucune rupture de forme de données.

### Enumérations, webhooks, files de messages
- Aucun changement de ce type dans le diff (pas de `billing_event`, pas de webhook Stripe touché — hors périmètre déclaré de la tranche).

### Périmètre déclaré vs réel
- `.gates/scope-010.txt` limite le périmètre à `packages/db/migrations/0009*.sql`, `0010*.sql`, `apps/web/src/lib/db.ts`, `tests/isolation-hardening/*`, `tests/helpers/db.ts`. Le diff réel y correspond, plus la documentation associée (ADR, ERD, DECISIONS, progress) — cohérent avec la règle « toute migration ajoutée impose la mise à jour de l'ERD dans la même tranche ».
- Le contrat de tranche (`docs/03-slices/010-durcissement-isolation.md`) déclare explicitement « aucune route nouvelle, aucune forme de requête/réponse modifiée » et coche AC1-AC6 comme verts — cohérent avec les constats ci-dessus.

## Verdict
Aucune rupture détectée : contrat API HTTP inchangé (fichier non touché, logique métier non touchée), signatures et types de retour des fonctions SQL consommées par l'app inchangés, schéma Drizzle et migrations 0001-0008 intacts, seule addition d'une seconde barrière RLS et d'une garde d'invariant serveur (`SG002`, non atteignable par le flux applicatif actuel). Documentation (ADR-0011, ERD, DECISIONS, progress) à jour dans la même tranche, conforme à `.claude/rules/documentation.md`.

Fichiers clés consultés (chemins absolus) :
- `C:\dev\mon-saas\docs\02-architecture\api-contracts\organizations.ts`
- `C:\dev\mon-saas\apps\web\src\lib\db.ts`
- `C:\dev\mon-saas\apps\web\src\lib\organizations.ts`
- `C:\dev\mon-saas\packages\db\migrations\0009_rls_session_user_membership.sql`
- `C:\dev\mon-saas\packages\db\migrations\0010_reimpose_role_attributes.sql`
- `C:\dev\mon-saas\docs\02-architecture\ERD.md`
- `C:\dev\mon-saas\docs\02-architecture\ADR\0011-rls-appartenance-utilisateur-session.md`
- `C:\dev\mon-saas\docs\02-architecture\ADR\0004-authentification-autorisation.md`
- `C:\dev\mon-saas\docs\02-architecture\ADR\0007-roles-postgres.md`
- `C:\dev\mon-saas\docs\03-slices\010-durcissement-isolation.md`
- `C:\dev\mon-saas\docs\DECISIONS.md`

CONTRACTS: PASS
