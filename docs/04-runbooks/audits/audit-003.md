> Note de l'orchestrateur (2026-10-20) : rapport rendu par `security-auditor` (sans droit d'ecriture sur le depot) sur `git diff main..HEAD` (HEAD b9e75a2), recopie tel quel. Resultat de la suite transmis a l'auditeur : `pnpm test` 30/30 fichiers, 354/354 tests, 0 echec (execute par l'orchestrateur au premier plan).

# Audit de sécurité — tranche 003, invitation d'un membre

**Périmètre :** `git diff main..HEAD`, 14 commits (a249ffe à b9e75a2). L'arbre de travail est propre : aucun changement non commité. Je n'ai pas lancé `pnpm test`. Je cite le résultat transmis par l'orchestrateur sur b9e75a2 : 30 fichiers, 354 tests passés, 0 échec, et `pnpm run check` vert. Postgres n'est pas disponible dans mon environnement : tout ce qui touche la base est un raisonnement sur le SQL et les tests, pas une exécution.

## Points vérifiés, sans constat

1. **Isolation entre clients (`0014_invitation.sql`)**
   - La RLS est activée et forcée. Les trois politiques (SELECT, INSERT, DELETE) s'appliquent seulement à `signet_app`. Elles exigent `organization_id = signet.current_org()` et que l'utilisateur de session soit owner. `current_org()` vérifie déjà que cet utilisateur est membre (ADR-0011), donc la RLS reste une vraie seconde barrière, même si l'id d'organisation vient de l'URL.
   - Droits sur la table : `signet_app` a seulement SELECT, INSERT et DELETE. Pas d'UPDATE, pas de TRUNCATE, rien pour les autres rôles.
   - `create_invitation` est en `SECURITY INVOKER`, avec un `search_path` fixé, `REVOKE ALL FROM PUBLIC` et EXECUTE pour `signet_app` seul. `invited_by_user_id` vient de `current_user_id()`, jamais d'un paramètre.
   - Le DELETE ne purge que la ligne expirée du couple (organisation, e-mail). Sous la RLS, il ne peut pas toucher une autre organisation.
   - Aucune fonction `SECURITY DEFINER` n'est ajoutée. Les tests d'AC15 le vérifient à la fois dans le texte de la migration et dans le catalogue.

2. **Route et `lib/invitations/invitations.ts`**
   - La session est vérifiée avant tout. L'entrée passe par le schéma Zod du contrat, puis l'e-mail est normalisé.
   - L'id d'organisation est mis en minuscules (`canonical`), ce qui écarte le problème de casse des UUID trouvé à l'audit 002.
   - Le corps est fusionné avec `organizationId` écrit en dernier : un champ ajouté par l'appelant ne peut pas le remplacer. Les champs inconnus sont retirés par le schéma, donc pas de mass assignment.
   - Toute la requête passe par `withTenant`, avec un filtre explicite `organization_id = $1 AND user_id = $2`. Un non-membre et une organisation inexistante reçoivent le même 404. Un member reçoit 403.
   - `ALREADY_MEMBER` ne révèle rien entre clients : la politique `app_user_visible_to_co_members` limite la lecture aux membres de l'organisation du contexte.

3. **503 et point de sauvegarde (D-092)**
   - Avant le point de sauvegarde, il n'y a que des lectures. `ROLLBACK TO SAVEPOINT` est appelé sur 23505 et sur refus de la file, puis le COMMIT valide une transaction vide : aucune invitation fantôme.
   - Les erreurs inattendues sont relancées et `withTenant` annule tout.
   - Le message du 503 est générique. Le journal ne cite que l'id de l'invitation.

4. **Jeton et scellement (`token.ts`)**
   - Le secret est tiré de `randomBytes(32)`. L'empreinte est le sha256 des 32 octets (D-090). Seule l'empreinte est en base, et un CHECK impose 32 octets.
   - AES-256-GCM : iv aléatoire de 12 octets, et les données authentifiées sont l'id de l'invitation. La longueur totale est vérifiée avant de déchiffrer, ce qui fixe aussi l'étiquette à 16 octets. Un échec est une valeur de retour sans contenu sensible.
   - Le secret en clair n'est ni dans l'événement, ni dans la réponse, ni dans un journal. Il n'apparaît pas non plus dans la valeur de retour du pas Inngest (`{kind}` seulement).
   - Le lien porte le jeton dans le fragment `#token=`.

5. **`INVITATION_TOKEN_KEY`**
   - Elle est validée au premier usage : 43 caractères base64url, soit 32 octets.
   - Le message d'erreur est fixe et ne contient jamais la valeur.
   - La valeur d'exemple dans `.env.example` est refusée par l'expression régulière, donc on ne peut pas déployer par mégarde avec elle.

6. **Fonction Inngest et expéditeur**
   - Aucun accès à la base.
   - L'événement est revalidé avec un schéma `strict`.
   - `onFailure` et les autres journaux ne citent que l'id (filtré par une expression régulière) et le nom de l'erreur.
   - `EMAIL_CAPTURE_URL` est refusée hors `APP_ENV=test` (`env.ts`). Les tests couvrent la production et un `APP_ENV` absent.
   - Sans fournisseur, l'envoi échoue en `NonRetriableError` : jamais de succès silencieux.
   - Sujet fixe. Le nom d'organisation n'apparaît que dans le corps texte, avec les caractères de contrôle retirés. Le destinataire est validé sans espace ni retour à la ligne : pas d'injection d'en-tête.
   - Délais : 5 s pour la mise en file, 8 s pour l'envoi.

7. **Tests modifiés (D-094)**, déroulés avant et après le changement :
   - `rolname::text` : avant, `roles` arrivait comme la chaîne `'{signet_app}'`. Dans cet état, `includes("public")` testait une sous-chaîne et `toEqual(["signet_app"])` échouait. Après, c'est un vrai tableau, ce qui rend le test plus strict.
   - `tests/billing/environment.test.ts` : la simulation de production retire une variable propre aux tests. L'assertion est la même. Rien n'est affaibli.

8. **Limite d'envois (D-086 Q-4)** : elle est bien dans `docs/03-slices/000-backlog.md`, écrite comme « limite d'envois par organisation et par owner, préalable au fournisseur réel ».

## Constats

### MINEUR-1 — Texte libre de l'owner dans l'e-mail et aucune limite d'envoi : risque de spam et d'hameçonnage depuis le domaine Signet le jour où un fournisseur réel sera branché
- **Emplacement :**
  - `apps/web/src/lib/invitations/email.ts:43`, où le nom d'organisation est repris dans le corps ;
  - `apps/web/src/app/api/organizations/[organizationId]/invitations/route.ts:27`, où la route n'a aucune limite de débit.
- **Scénario :**
  1. Un inscrit crée une organisation et en devient owner.
  2. Il la nomme par exemple « Compte suspendu — vérifiez sur evil.example » (120 caractères, les URL sont acceptées).
  3. Il invite N adresses quelconques, une par appel. Rien ne limite le nombre d'adresses différentes.
  4. Chaque destinataire reçoit, depuis le domaine d'envoi de Signet, un e-mail qui contient le texte de l'attaquant.
- **Pourquoi ce n'est pas exploitable aujourd'hui :** aucun fournisseur réel n'existe (`EMAIL_PROVIDER_NOT_CONFIGURED`) et `EMAIL_CAPTURE_URL` est refusée hors tests.
- **Correctif :** dans la tranche qui branche le fournisseur réel, traiter deux préalables :
  - la limite d'envois, déjà au backlog ;
  - le contenu du nom d'organisation, qui n'est pas au backlog : citation clairement délimitée comme contenu fourni par un utilisateur, ou filtrage des URL et domaines dans le nom.

  Ces deux points deviennent MAJEUR à cette tranche-là. Ajouter le second au backlog dès maintenant.

### MINEUR-2 — Une connexion Postgres reste ouverte pendant la mise en file, jusqu'à 5 s, sans limite de débit
- **Emplacement :** `apps/web/src/lib/invitations/invitations.ts:121`. `sendEventWithDeadline` est appelé à l'intérieur de `withTenant`.
- **Scénario :**
  1. Inngest devient lent ou injoignable (incident chez le fournisseur).
  2. Un owner, ou un script avec une session valide, lance des émissions en parallèle.
  3. Chacune garde une connexion du pool `signet_app` (10 par défaut avec `pg`) pendant 5 s. Les autres routes de l'application attendent une connexion libre.
- **Limite du constat :** l'attaquant ne peut pas provoquer lui-même la lenteur d'Inngest. Il ne fait qu'amplifier un incident. Ce choix est voulu (D-086 Q-3, mise en file avant le COMMIT).
- **Correctif :** l'inclure dans la limite par organisation et par owner du backlog. Envisager aussi un plafond de mises en file simultanées sur cette route.

### INFO
- Les clés de test de `.env.test.example` et `ci.yml` sont publiques et lisibles (texte ASCII encodé), ce qui est voulu. Le schéma de la clé n'interdit pas de les réutiliser en production. Une garde « valeur connue de test refusée hors `APP_ENV=test` » serait du durcissement, pas une faille.
- `pnpm audit` remonte une seule vulnérabilité « high » : `braces <=3.0.3`, qui n'a pas de version corrigée. Elle passe par `eslint-config-next > ... > micromatch`, donc l'outillage de lint seulement. Elle existait avant la tranche, qui n'ajoute aucune dépendance.
- Cas résiduel déjà documenté (ADR-0017) : si la file accepte l'événement après le délai, un e-mail part avec un lien inerte, puisque l'empreinte n'est pas en base. C'est sans danger pour l'accès. Ce n'est pas compté dans une future limite d'envois basée sur les lignes : à prendre en compte quand on concevra cette limite.

## Bilan
Aucun constat CRITIQUE ni MAJEUR. Les deux MINEUR dépendent du fournisseur réel ou de la limite d'envois, qui est déjà au backlog. Seul le contenu du nom d'organisation reste à y ajouter.

AUDIT: PASS
