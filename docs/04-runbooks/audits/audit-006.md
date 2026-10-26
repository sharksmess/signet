# Audit de sécurité, tranche 006 : acceptation d'une invitation

**Périmètre** : `git diff eb0dae0..HEAD`, sans le commit `1bb5acd`. L'arbre de travail est propre (seul `.gates/current-slice` n'est pas suivi par git), donc le code audité est celui des commits. J'ai lu en entier `packages/db/migrations/0015_accept_invitation.sql`, `apps/web/src/lib/invitations/accept.ts`, `token.ts`, `apps/web/src/app/api/invitations/accept/route.ts`, `errors.ts`, les contrats, ADR-0018 et les intitulés des 55 tests. J'ai aussi relu les politiques `signet_definer` des migrations 0003, 0009 et 0012, `withTenant`/`withUserOnly` (`apps/web/src/lib/db.ts`) et `apps/web/src/lib/auth.ts`.

**Limite** : je n'ai exécuté aucun SQL. Ce que je dis du comportement de Postgres est un raisonnement, appuyé sur les résultats de tests que tu m'as transmis (418 passés, 55 verts dans `tests/invitation-acceptance`).

## Points vérifiés, sans constat

1. **Isolation tenant des deux fonctions SECURITY DEFINER** (`0015:94-152`, `0015:188-265`) :
   - La première instruction est la garde SG002 sur `current_user_id()`.
   - Les réglages `app.organization_id` et `app.invitation_token_hash` reçus de l'appelant sont effacés tout de suite.
   - `app.organization_id` est ensuite posé depuis `invitation.organization_id`, lu par empreinte : c'est une valeur de confiance, ce qui respecte D-033.
   - Ces réglages sont remis à vide avant chaque retour normal.
   - Si une exception survient (SG008), le `ROLLBACK TO SAVEPOINT` de `accept.ts:93` restaure aussi les réglages.
   - Les tests AC5 (b) et (c) couvrent le cas d'un contexte étranger imposé.
2. **search_path, TimeZone, propriétaire, EXECUTE** :
   - `SET search_path = pg_catalog, signet, public, pg_temp` (pg_temp en dernier) et `SET TimeZone = 'UTC'`.
   - Propriétaire `signet_definer`, avec `REVOKE ALL FROM PUBLIC` puis `GRANT EXECUTE TO signet_app` seul. Les tests de catalogue AC12 le vérifient.
3. **Écriture de `signet_definer` sur `invitation`, bornée (D-103)** :
   - Il n'a que le privilège UPDATE sur `accepted_at` et `accepted_by_user_id`, et ni INSERT, ni DELETE, ni TRUNCATE.
   - La politique `invitation_definer_accept` impose `accepted_at IS NULL` en USING, et `accepted_by_user_id = current_user_id()` en WITH CHECK.
   - Le test AC13 (d) le vérifie sous `SET ROLE`.
4. **Lecture de `app_user`** : seules les colonnes `(id, email)`, et seulement la ligne où `id = signet.current_user_id()` (`0015:33`, `0015:71-73`).
5. **Les nouvelles politiques n'ouvrent aucune autre porte** :
   - Les autres fonctions et déclencheurs `signet_definer` ne lisent pas `invitation`.
   - Si `signet_app` pose lui-même `app.invitation_token_hash`, cela ne sert à rien : les deux seules fonctions qui lisent la table le remettent à vide en entrant.
6. **Consommation atomique** :
   - La décision tient dans un seul UPDATE conditionnel (`0015:230-237`), qui vérifie l'empreinte, `accepted_at IS NULL`, `expires_at > now()` et l'adresse.
   - La lecture préalable ne sert qu'à poser le contexte.
   - Sous READ COMMITTED, une seconde transaction attend le verrou de ligne, réévalue la condition et ne modifie rien.
   - SG008 annule l'UPDATE avec le reste de l'appel. Les tests AC6 (deux transactions, et deux POST simultanés) couvrent ce cas.
7. **Rapprochement d'adresse fait par la base** : la condition `i.email = lower(app_user.email)` se trouve dans l'UPDATE lui-même. La route ne compare l'adresse que pour choisir entre 401 et 403, après le refus de la base (D-108). Le test AC7 côté fonctions prouve que la base refuse seule.
8. **Pas d'énumération** :
   - Les messages sont fixes, sans adresse, nom d'organisation, identifiant ni code SQL (D-107).
   - Un jeton malformé et un jeton inconnu renvoient le même corps 404, et un jeton malformé ne déclenche aucune requête (`token.ts:linkTokenToHash`, décodage strict selon D-106).
   - `accept.ts` ne lit pas `organization_name` dans le résultat de `lookup_invitation`.
   - La différence entre 410, 409 et 403 n'est visible que pour qui détient un jeton de 256 bits.
9. **Le jeton ne fuit pas** :
   - Le seul `console.error` (`accept.ts:67`) journalise l'étape et le code SQL, rien d'autre.
   - L'erreur levée ensuite ne contient ni l'erreur `pg`, ni ses paramètres, ni de `cause`.
   - `withTenant` relance l'erreur sans la journaliser.
   - Seule l'empreinte part vers Postgres. Le jeton n'est jamais dans le chemin de l'URL, et `?token=` est ignoré.
10. **Validation des entrées** :
    - `z.string().max(256)` sur `token`, et le champ `password` est retiré.
    - L'objet Zod n'est pas strict : les champs en trop sont retirés, donc pas de mass assignment.
    - Le rôle inséré est la constante `'member'`.
    - La route ne lit aucune variable d'environnement et aucun secret n'est écrit en dur.
11. **Authentification et autorisation** : la session better-auth est exigée avant toute lecture du corps. L'utilisateur vient de la session, jamais de la requête (P-2).

## Constats

Aucun constat CRITIQUE, MAJEUR ou MINEUR.

### INFO-1 : adresse non vérifiée, limite acceptée par ADR-0018
- **Emplacement** : `packages/db/migrations/0015_accept_invitation.sql:236` et `apps/web/src/lib/auth.ts:34-36`. `requireEmailVerification` n'est pas activé, `email_verified` n'est pas lu.
- **Scénario** : quelqu'un obtient le lien (par exemple un e-mail transféré). Avant que le vrai destinataire ait un compte, il s'inscrit avec l'adresse invitée, puis accepte. Ensuite, l'index unique empêche le vrai destinataire de s'inscrire.
- **Pourquoi ce n'est pas plus grave aujourd'hui** :
  - Il faut cumuler deux conditions : détenir le lien et devancer l'inscription.
  - La limite est écrite et acceptée dans ADR-0018.
  - Il n'y a pas encore de fournisseur d'e-mails réel (D-083).
  - `changeEmail` n'est pas activé dans better-auth.
- **Correctif proposé** : à la tranche du fournisseur réel ou de la vérification d'adresse, exiger `email_verified` dans la condition de l'UPDATE (c'est le signal de réexamen d'ADR-0018). Il faudra alors réévaluer ce point au même titre que les deux prérequis déjà notés à l'audit 003.

### INFO-2 : pas de limiteur de débit sur la route d'acceptation (P-6)
- **Emplacement** : `apps/web/src/app/api/invitations/accept/route.ts:27`.
- **Scénario** : un compte connecté envoie des requêtes en boucle, et chacune ouvre une transaction. Deviner un jeton de 256 bits est impossible, donc il n'y a pas de force brute exploitable. Il reste seulement une pression de charge, comparable à celle des autres routes authentifiées.
- **Correctif proposé** : rouvrir P-6 en même temps que P-4 à la tranche 012, comme le prévoit déjà ADR-0018.

### INFO-3 : dépendances
- **Constat** : `pnpm audit` signale 2 critiques et 2 élevées, toutes sur des copies anciennes en dépendance de développement : `next` 16.3.8 sous `@inngest/test>inngest`, et `zod` 4.6.5 sous `eslint-plugin-react-hooks`.
- **Contexte** : ce reste est déjà accepté et documenté (D-100). L'application elle-même utilise `next` 16.4.3 et `zod` 4.6.7. La tranche n'ajoute ni ne modifie aucune dépendance.
- **Correctif proposé** : aucun dans cette tranche. Suivre la levée du reste prévue par D-100.

AUDIT: PASS
