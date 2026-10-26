# Audit de sécurité — tranche 004 (création d'une collection)

- **Date** : 2026-10-26
- **Branche** : `slice/004-creation-collection`, diff `main...HEAD` (255fd28 à f9744db), arbre de travail propre (aucun fichier non committé).
- **Méthode** : lecture du SQL, du code et des tests. Pas de Postgres lancé par l'auditeur : je raisonne sur le SQL et sur les tests, et je reprends les résultats de l'orchestrateur (suite complète 487 passés, 1 ignoré ; `tests/collections` 57/57 ; `pnpm run check` vert).

## CRITIQUE
Aucun.

## MAJEUR
Aucun.

## MINEUR

### MINEUR-1 — Aucun plafond ni limite de débit sur la création de collections
- **Emplacement** : `apps/web/src/app/api/organizations/[organizationId]/collections/route.ts:37-58`. Aucun limiteur ; le limiteur d'ADR-0010 ne couvre que `/api/auth/*`.
- **Scénario d'exploitation** :
  1. Un `member` invité, éventuellement malveillant, ou un compte compromis, boucle sur `POST .../collections` avec des noms distincts.
  2. Il crée des milliers de lignes dans l'organisation.
  3. Résultat : la liste de la tranche 009 est polluée et le stockage grossit sans borne.
- **Portée** : l'effet reste dans le tenant de l'appelant, qui doit déjà en être membre. Aucune fuite ni impact sur un autre tenant.
- **Remédiation** : traiter avec audit-001 MINEUR-5 et audit-002 MINEUR-1 (backlog), par un limiteur à stockage partagé par utilisateur et par organisation. Un plafond du nombre de collections par organisation (ou par palier) est une **décision produit manquante** : il faut la remonter à l'humain, pas l'inventer.

## INFO

### INFO-1 — `pnpm audit` complet en rouge, hors périmètre de la tranche et en dépendances de développement uniquement
- `pnpm audit` remonte 2 critiques et 2 hautes :
  - `next` 16.3.8 (GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr, GHSA-p3m5-59mp-jv5r), seconde copie tirée par `@inngest/test > inngest` (devDependency de la racine) ;
  - `zod` < 4.6.6 (GHSA-mrhx-c7xc-m3w5) via `eslint-config-next`.
- L'application sert `next@16.4.3` et `zod@4.6.7` (`pnpm -C apps/web why next`). `pnpm audit --prod --audit-level=high`, le critère de la CI, renvoie « No known vulnerabilities found ».
- La tranche ne modifie aucun manifeste ni le lockfile.
- **Suite suggérée** : une branche `chore/` pour aligner la copie de développement de `next` (via `overrides`, comme dans D-050), afin que l'audit complet redevienne lisible.

### INFO-2 — Contenu libre du nom de collection
- Le nom accepte tout caractère Unicode (balises, caractères de contrôle, bidi, zéro-largeur) dans la limite de 1 à 100 caractères.
- Côté API, il est renvoyé en JSON, sans risque.
- À vérifier à la tranche 012 (UI) : affichage échappé (pas de `dangerouslySetInnerHTML`, pas d'insertion dans un attribut `href`).
- Les caractères zéro-largeur permettent des noms visuellement identiques à un existant. Ce n'est pas une faille : c'est un choix produit éventuel.

## Points vérifiés sans constat

1. **Isolation tenant.**
   - **Appartenance** : la requête filtre explicitement sur `organization_id = $1 AND user_id = $2` (`collections.ts:72-77`).
   - **Insertion** : `organization_id` est explicite, `created_by_user_id` vient de la session. Aucun `findMany` ni aucune requête sans prédicat tenant.
   - **RLS** : activée **et** forcée, propriétaire `signet_owner`. Une seule politique `FOR ALL TO signet_app`, avec `USING` et `WITH CHECK` sur `organization_id = signet.current_org()`. Aucune politique `PUBLIC` ni `signet_definer`.
   - **Privilèges** : `SELECT, INSERT` seulement.
   - **Tests** : AC5 (c) prouve le refus par la RLS seule (`42501`), avec une précondition sur le `GRANT` et des témoins positifs : contexte étranger, `WITH CHECK` croisé, absence de `app.user_id`.
2. **Origine du contexte tenant.** `app.organization_id` vient du chemin, mais `current_org()` (0009, `SECURITY DEFINER`, propriétaire `signet_definer`, `EXECUTE` à `signet_app` seul) exige que l'utilisateur de session soit membre. La RLS reste donc une vraie seconde barrière. `app.user_id` vient de la session better-auth, jamais de la requête.
3. **Autorisation.** `minRole: member` est conforme au contrat : owner et member sont acceptés. Le 404 est identique pour une organisation inexistante, un non-membre et un utilisateur sans organisation (corps comparés octet pour octet, AC5 a).
4. **Validation des entrées.**
   - Le paramètre de chemin et le corps passent par le schéma du contrat. Un corps non JSON ou non objet donne 422.
   - Pas de mass assignment : `{ ...body, organizationId }` laisse le chemin écraser le corps, et `z.object` élimine les clés inconnues ; AC5 (b) le vérifie avec `organizationId` et `createdByUserId` injectés. Une clé `__proto__` issue de `JSON.parse` est recopiée comme propriété propre : pas de pollution de prototype.
   - UUID en majuscules : il est remis en minuscules avant usage, et toutes les comparaisons se font en type `uuid` (point de vigilance de l'audit 002 respecté).
5. **Injection.** Toutes les valeurs sont paramétrées. Le seul texte interpolé est le nom de point de sauvegarde, une constante.
6. **Fuites.**
   - Les messages 422 et 409 sont fixes (ni la valeur soumise, ni le message Zod, ni le nom de contrainte, ni le code SQL).
   - Une erreur inattendue journalise uniquement le code SQL, puis relève une erreur sans détail (500 générique).
   - Pas de secret en dur ni dans les logs.
7. **Concurrence.** L'unicité est décidée par l'index unique `collection_org_name_ci_idx` sur `(organization_id, lower(btrim(name)))`, sans lecture préalable. Un `23505` sur cet index précis est traité par `ROLLBACK TO SAVEPOINT` puis 409. Les autres violations remontent en 500. AC6 couvre les requêtes simultanées, y compris avec des casses différentes.
8. **Fonctions à privilèges.** Aucune fonction `SECURITY DEFINER` nouvelle ; l'ensemble `prosecdef` inchangé est vérifié par AC8.
9. **Webhooks.** Hors périmètre, aucun ajout.

AUDIT: PASS
