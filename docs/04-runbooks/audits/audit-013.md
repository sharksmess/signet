# Rapport d'audit de sécurité : tranche 013 (Consultations pour les écrans)

**Périmètre :** `git diff main..HEAD` sur `slice/013-consultations-ecrans`, soit 8 commits. L'arbre de travail est propre, rien d'autre n'est en attente. Le code de production modifié tient en six fichiers :
- `C:\dev\mon-saas\apps\web\src\app\api\organizations\route.ts`
- `C:\dev\mon-saas\apps\web\src\app\api\organizations\[organizationId]\members\route.ts`
- `C:\dev\mon-saas\apps\web\src\lib\organizations.ts`
- `C:\dev\mon-saas\apps\web\src\lib\members\members.ts`
- `C:\dev\mon-saas\apps\web\src\lib\members\contracts.ts`
- `C:\dev\mon-saas\apps\web\src\lib\contracts.ts`

S'y ajoutent le contrat `docs/02-architecture/api-contracts/organizations.ts` et les tests `tests/screen-reads/*`. Le diff ne touche ni migration, ni `package.json`, ni `pnpm-lock.yaml`.

## Vérifications par point de la grille

1. **Isolation tenant : conforme.**
   - **`GET /api/organizations`** : `userId` vient uniquement de `session.user.id` (`route.ts:50`). La route ne lit ni la chaîne de requête, ni le corps, ni les en-têtes. La fonction `signet.organizations_for_user` (migration 0009, lignes 252-287) lève `SG002` si `app.user_id` est absent ou diffère de l'argument. Elle filtre sur `m.user_id = v_session_user`. Le test AC4 prouve que `?userId=`, `?organizationId=` et les en-têtes d'identité sont ignorés.
   - **`GET .../members`, appartenance** : l'appartenance est contrôlée explicitement par `organization_id = $1 AND user_id = $2` (`members.ts:67-71`). `userId` vient de la session (`members/route.ts:50`).
   - **`GET .../members`, liste** : la lecture filtre explicitement sur `m.organization_id = $1` (`members.ts:74-81`). Un membre de deux organisations ne peut donc lire, sous le chemin de A, que les membres de A (testé par AC8 b).
   - **Seconde barrière RLS** : la politique `app_user_visible_to_co_members` (0003:145) repose sur `signet.current_org()`. Depuis la migration 0009, cette fonction ne rend l'organisation que si l'utilisateur de session en est membre. L'identifiant d'organisation venu de l'URL est donc vérifié aussi par la RLS (point 8 de la grille), ce que le test AC8 c prouve sous `signet_app`.

2. **Autorisation : conforme.**
   - `listMembers` accepte un owner comme un member, ce qui correspond à `minRole: "member"` du contrat. Un utilisateur connecté mais non membre reçoit un 404.
   - `listMyOrganizations` n'exige qu'une session valide, ce qui est correct puisque la lecture est bornée à soi-même.

3. **Validation des entrées : conforme.**
   - Le chemin est validé par le schéma du contrat (`listMembersContract.input.safeParse`), sans copie locale. L'identifiant est ensuite mis en minuscules avant usage, ce qui écarte le piège de comparaison texte relevé à l'audit 002.
   - Aucun corps n'est lu, donc aucun mass assignment possible.
   - Le message de 422 est fixe et ne renvoie ni la valeur soumise ni le message de Zod.

4. **Injection : conforme.** Toutes les requêtes sont paramétrées (`$1`, `$2`) et le diff ne contient aucune interpolation.

5. **Secrets et fuites : conforme.**
   - Le 404 est identique pour une organisation inexistante et pour une organisation d'autrui (« Organisation introuvable. », sans identifiant), ce que testent AC7 et AC8 a.
   - Les journaux ne contiennent que le code SQL, jamais d'identifiant, d'adresse, de nom ni le `detail` de `pg`.
   - L'erreur est relevée sans détail, ce qui donne un 500 générique.

6. **Webhooks : non concerné.**

7. **Fonctions à privilèges : rien de nouveau.** La tranche ne crée aucune fonction `SECURITY DEFINER`, aucun privilège, aucune politique (D-138 point 5 tenu). `organizations_for_user` existait déjà : sa garde d'identité est la première instruction, et elle a `REVOKE ALL FROM PUBLIC` puis `GRANT EXECUTE` au seul `signet_app`.

8. **Origine du contexte tenant : conforme.** `app.user_id` vient de la session. `app.organization_id` vient de l'URL, mais il est vérifié par `current_org()` comme indiqué au point 1.

9. **Écriture involontaire : aucune.** Il n'y a que des `SELECT`, dans une transaction validée sans modification. AC10 photographie les tables `organization`, `member`, `app_user` et `invitation` avant et après les lectures.

10. **Dépendances : conforme.** `pnpm audit --prod` répond « No known vulnerabilities found », et la tranche n'ajoute aucune dépendance. L'audit complet, dépendances de développement comprises, n'a pas été relancé (il était rouge pour une dépendance de dev-only à l'audit 004).

## Constats

**CRITIQUE :** aucun.

**MAJEUR :** aucun.

**MINEUR-1. Lectures sans borne ni limite de débit** (`members/route.ts:36`, `organizations/route.ts:43`)
- **Scénario :** un utilisateur authentifié appelle en boucle `GET /api/organizations/:id/members` ou `GET /api/organizations`. Chaque appel ouvre une transaction et rend la liste entière, sans pagination. La charge sur la base n'est donc pas bornée. La lecture reste limitée à ses propres données : il n'y a aucune fuite inter-tenant.
- **Remédiation :** étendre au périmètre de ces deux routes l'entrée déjà au backlog (audit-009 MINEUR-1, D-134).

**INFO-1. Écart `minRole: "public"` sur `listMyOrganizations`** (`docs/02-architecture/api-contracts/organizations.ts`, contrat `listMyOrganizations`)
- Le comportement est correct : 401 sans session, testé par AC1. L'écart est sémantique par rapport à `_contract.ts`. Il est déjà signalé dans D-139 point 6 et renvoyé au backlog pour décision humaine.
- **Point de vigilance :** si un outil d'autorisation générique venait un jour à lire `minRole` pour décider d'exiger une session, `"public"` ouvrirait la route. Cela renforce l'intérêt de passer ce contrat et `createOrganization` à `"authenticated"`.

**INFO-2. Exposition des adresses e-mail** (`members.ts:74-87`)
- Les adresses de tous les membres sont visibles par tout membre, member non owner compris. C'est conforme au contrat `listMembers` (US-07.1, D-138 point 3), et les invitations non acceptées sont exclues (AC9). Ce n'est pas une faille.
- **Prérequis à garder en tête :** le retrait d'un membre (tranche 008) devra bien supprimer la ligne `member`, pour qu'un ancien membre perde aussitôt la visibilité sur les adresses.

**INFO-3. En-têtes de cache** : le rappel `Cache-Control: private, no-store` (audit-009 INFO-1) s'applique aussi à ces réponses, qui contiennent des données personnelles. Il est déjà au backlog avant la mise en ligne.

## Verdict

AUDIT: PASS
