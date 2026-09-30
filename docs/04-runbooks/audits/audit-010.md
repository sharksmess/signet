# Audit de securite — tranche 010 « durcissement de l'isolation tenant »

- Date : 2026-09-30
- Branche : `slice/010-durcissement-isolation`, HEAD `7320169`, arbre de travail propre
- Perimetre : `git diff main...HEAD` (21 fichiers). Code audite : migrations `0009_rls_session_user_membership.sql` et `0010_reimpose_role_attributes.sql`, commentaires de `apps/web/src/lib/db.ts`, `tests/helpers/db.ts` (`asTenantRaw`), `tests/isolation-hardening/*`. Relus pour le contexte : 0001-0008, `apps/web/src/lib/organizations.ts`, les routes `organizations`, ADR-0011, audit-001.
- Execution : `pnpm test` n'a PAS ete lance par l'auditeur, parce que plusieurs relecteurs tournaient en parallele sur la meme base de test. Resultat communique par l'orchestrateur sur `7320169` : 10/10 fichiers, 82/82 tests, `pnpm run check` vert. Tout le reste de ce rapport vient de la lecture du SQL et des tests, pas d'une execution en base.
- `pnpm audit --prod` : « No known vulnerabilities found ». Aucune dependance ajoutee (ni `package.json` ni `pnpm-lock.yaml` dans le diff).

## Points verifies sans constat

1. **La RLS de `signet_app` exige l'appartenance.** Les politiques `organization_isolation`, `member_isolation`, `organization_link_usage_read_only`, `subscription_owner_only` et `app_user_visible_to_co_members` comparent a `signet.current_org()`. La politique est stockee avec l'OID de la fonction, donc elle prend la nouvelle version remplacee par `CREATE OR REPLACE`. Cette nouvelle version ne renvoie `app.organization_id` que si une ligne `public.member (organization_id = context_org(), user_id = current_user_id())` existe. Sinon elle renvoie NULL et toutes les politiques ferment. Cela couvre AC2 (membre de A avec un contexte B) et AC3 (a) et (b). AC3 (c) avec un UUID malforme : l'erreur 22P02 survient avant qu'une ligne ne soit rendue.
2. **`current_org()` n'offre pas de contournement.**
   - Elle est `SECURITY DEFINER` et appartient a `signet_definer` (ALTER explicite, 0009:145). Ce role est NOBYPASSRLS et `member` est en FORCE RLS : la requete interne reste soumise a la RLS.
   - Elle ne peut pas etre inlinee (SECURITY DEFINER et clause SET).
   - Son `search_path` est fige a `pg_catalog, signet, public, pg_temp`. La table est qualifiee (`public.member`) et les fonctions aussi (`signet.context_org()`, `signet.current_user_id()`). Une table temporaire ne peut donc pas masquer `member`, et Postgres ne cherche jamais les fonctions ni les operateurs dans `pg_temp`.
   - `signet_app` n'a aucun droit CREATE sur `signet` (REVOKE ALL en 0001), ni sur `public` (PG16).
   - EXECUTE : `signet_app` et le proprietaire seulement. PUBLIC est revoque.
   - Elle ne prend aucun parametre, donc on ne peut pas l'interroger sur l'appartenance d'un tiers.
3. **`context_org()` est inaccessible a `signet_app`.** Aucun GRANT, et PUBLIC est revoque (0009:59). Un test le verifie avec `has_function_privilege`. Ce ne serait pas une fuite de toute facon : `signet_app` peut lire `current_setting('app.organization_id')` directement.
4. **Pas de recursion.** Chaine d'evaluation : `member_isolation` (signet_app) appelle `current_org()`, executee sous `signet_definer`. Celle-ci lit `member` sous `member_definer_context` (`context_org()`) et `member_definer_self_read` (`current_user_id()`), qui n'appellent ni l'une ni l'autre `current_org()`. Aucune politique TO PUBLIC n'existe sur `member` ni sur `organization`. Le catalogue le verifie (voir INFO-2 pour sa limite).
5. **Un appel de `signet_app` n'atteint aucune fonction definer utilisable pour forger un contexte.** Voir MINEUR-2 pour le risque futur.
   - `create_organization` ecrase le contexte avec un `uuidv7()` qu'elle genere elle-meme.
   - `organizations_for_user` filtre `m.user_id = v_session_user`. Meme avec un contexte B choisi par l'appelant, la jointure exige une ligne `member` de l'utilisateur de session.
   - Les trois fonctions de trigger ne peuvent pas etre declenchees par `signet_app`. Sur `member` et `subscription`, `signet_app` n'a que SELECT. Sur `organization`, le seul trigger est AFTER INSERT, et l'INSERT est structurellement impossible (MINEUR-1).
6. **Les gardes SG002 sont correctes.** Ce sont les premieres instructions. `IS DISTINCT FROM` ferme le cas NULL que la garde de 0003 laissait passer. Les messages ne contiennent aucun identifiant, et le meme code SQLSTATE sert pour « absent » et « different ». `create_organization` insere le membre owner avec la valeur de session deja verifiee. Les routes prennent `userId` dans `session.user.id` (`[organizationId]/route.ts:34`, `organizations.ts:30-36`), jamais dans la requete.
7. **0010 est correcte.** Elle est idempotente (des ALTER ROLE inconditionnels, sans effet sur un cluster conforme). Elle echoue fermee : le bloc DO leve avant les ALTER, et `migrate.ts` annule la transaction. Aucun secret : ni mot de passe, ni message autre que des noms de roles. Les tests AC6 (i) et (ii) jouent le fichier reel dans une transaction toujours annulee, et echouaient avant 0010 (fichier absent).
8. **Les tests sont discriminants.** Le journal donne une baseline de 28 echecs avant l'implementation, puis 0 apres. Les deux tests AC4 `create_organization` echouaient avant 0009 : l'owner inexistant provoquait une violation de FK 23503 et non SG002. Ils verifient maintenant l'absence de creation hors RLS, apres la transaction. `tests/organizations/**` et `tests/_factory/**` sont absents du diff (AC1).
9. **Modele de menace.** Du SQL arbitraire execute sous `signet_app` peut forger `app.user_id`. C'est une limite documentee et acceptee par ADR-0011 (§ « Modele de menace retenu ») : ce n'est pas un constat.

## Constats

### MINEUR-1 : `GRANT INSERT ON organization TO signet_app` toujours present (reconduit d'audit-001 MINEUR-2)
- **Emplacement** : `packages/db/migrations/0003_organizations_and_policies.sql:185`. 0009 ne le revoque pas, et ADR-0011 § Consequences l'assume.
- **Scenario** : aucun exploit. Depuis 0009, le `WITH CHECK (id = current_org())` impose que l'appelant soit deja membre d'une organisation portant cet `id`. Cette organisation existe donc (FK `member` vers `organization`), et l'INSERT echoue sur la cle primaire. Le privilege reste un chemin de creation parallele au niveau SQL, en contradiction avec l'invariant « `create_organization()` seul chemin », et une future politique moins stricte le rouvrirait.
- **Remediation** : `REVOKE INSERT ON organization FROM signet_app` dans une migration future, avec une assertion de catalogue sur les privileges de table de `signet_app`.

### MINEUR-2 : les fonctions `SECURITY DEFINER` voient le contexte brut, que l'appelant choisit
- **Emplacement** : `0009_rls_session_user_membership.sql:77-92`. Les politiques `organization_definer_context` et `member_definer_context` sont FOR ALL. `organization_link_usage_definer_write` et `subscription_definer_insert` reposent aussi sur `context_org()`.
- **Constat** : pour `signet_definer`, la visibilite de `organization` et de `member` repose sur `app.organization_id` brut. Dans `withTenant`, cette valeur vient du parametre d'URL et est posee avant tout controle. La barriere « appartenance de l'utilisateur de session » ne vaut donc que pour `signet_app`. A l'interieur d'une fonction definer, elle ne tient que si la fonction pose d'abord son propre contexte a partir d'une valeur de confiance, ou filtre sur `current_user_id()`. C'est une convention : aucun test de catalogue ne l'impose. Ce n'est pas une regression, la situation avant 0009 etait identique.
- **Scenario** (futur, non exploitable aujourd'hui) :
  1. La tranche 002 ajoute une fonction definer appelable par `signet_app`, par exemple une lecture de membres ou d'abonnement, qui s'appuie sur la RLS sans poser son propre contexte.
  2. Un utilisateur membre de A seulement appelle une route avec `organizationId = B`.
  3. La fonction voit toutes les lignes de B.

  Aucune des cinq fonctions actuelles n'a ce defaut (point 5 ci-dessus).
- **Remediation** : ajouter a ADR-0011 une regle pour toute fonction definer que `signet_app` peut executer : poser son contexte depuis une valeur de confiance, ou filtrer sur `current_user_id()` en premiere instruction. L'accompagner d'un invariant teste, par exemple un test par fonction avec un contexte etranger force, qui ne doit rendre aucune ligne, sur le modele d'AC2.

### INFO-1 : ce que 0010 ne couvre pas
- **Emplacement** : `0010_reimpose_role_attributes.sql:33-49`.
- 0010 ne detecte que les roles `signet_*` qui sont membres d'un autre role. Elle ne voit pas le sens inverse : un role tiers membre de `signet_definer` ou de `signet_app`. Elle ne voit pas non plus les reglages par role (`pg_db_role_setting`, par exemple `ALTER ROLE signet_app SET app.user_id = ...`).
- **Scenario** : un administrateur accorde `signet_definer` a un compte humain. Ce compte fait `SET ROLE signet_definer`, pose `app.organization_id`, puis lit `member` et `organization` de n'importe quel tenant via les politiques `*_definer_context`. Cela suppose une action d'administrateur du cluster.
- **Remediation** : lors d'une prochaine migration de roles, etendre l'assertion a `pg_auth_members.roleid IN (signet_*)` et a `pg_db_role_setting` pour ces roles.

### INFO-2 : les invariants de catalogue ignorent les politiques TO PUBLIC
- **Emplacement** : `tests/isolation-hardening/definer-functions.test.ts:108` et `:126` (`pol.polroles @> ARRAY[<oid du role>]`).
- Une politique TO PUBLIC (`polroles = {0}`) qui appellerait `current_org(` ou `context_org(` echapperait aux deux invariants. Aucune politique de ce type n'existe aujourd'hui.
- **Remediation** : inclure `0 = ANY(pol.polroles)` dans les deux filtres.

### INFO-3 : le test AC4 « owner different » utilise un utilisateur inexistant
- **Emplacement** : `tests/isolation-hardening/definer-functions.test.ts:69-81`.
- `differentOwnerId` n'a pas de ligne `app_user`. Avant 0009, l'appel echouait deja (FK 23503), et aucune organisation n'aurait pu etre comptee. Le test distingue bien les deux etats grace au code SG002, mais il n'exerce pas le vrai scenario : creer une organisation dont l'owner est un autre utilisateur existant.
- **Remediation** : utiliser comme `p_owner_user_id` l'owner reel d'une autre fixture.

### INFO-4 : la RLS verifie l'appartenance, pas le role
- **Emplacement** : `0003:88-90`, politique `organization_isolation` (FOR ALL, `signet_app`).
- Au niveau base, un membre non owner peut executer `UPDATE organization`. Le controle owner n'existe que dans `organizations.ts:79`. C'est interne au tenant, anterieur a la tranche et hors perimetre de 010. A garder en tete quand 002 et 008 recopieront le patron.

## Synthese

| Gravite | Nombre | Constats |
|---|---|---|
| CRITIQUE | 0 | aucun |
| MAJEUR | 0 | aucun |
| MINEUR | 2 | MINEUR-1 (GRANT INSERT, reconduit), MINEUR-2 (contexte brut dans les fonctions definer, sans invariant) |
| INFO | 4 | INFO-1 a INFO-4 |

Audit-001 MINEUR-1 (RLS tautologique quand le contexte vient de l'URL) est **leve** : la RLS de `signet_app` exige desormais l'appartenance de l'utilisateur de session, et l'origine du contexte tenant n'est plus un constat MAJEUR. Audit-001 MINEUR-10 est **leve** pour son objet (attributs et appartenances des roles `signet_*`). Son extension est decrite en INFO-1.

AUDIT: PASS
