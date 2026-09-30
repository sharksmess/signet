# ADR-0007 — Roles Postgres et acces des fonctions `SECURITY DEFINER` sans `BYPASSRLS`

- **Statut** : accepte
- **Date** : 2026-09-22
- **Phase** : 3 — tranche 001 (creation d'organisation et compte owner)
- **Amende le 2026-09-29 par ADR-0011** (tranche 010) : les politiques `organization_isolation` et `member_isolation`, decrites en Partie 2 comme « elargies a `signet_definer` », sont desormais separees — `signet_app` sur `current_org()` (verifiee par appartenance de l'utilisateur de session), `signet_definer` sur `context_org()` (contexte brut pose depuis une valeur de confiance). Le principe de cette ADR (definer sans `BYPASSRLS`) est inchange. Les attributs des quatre roles sont reimposes par la migration 0010 (audit-001 MINEUR-10).

## Contexte

L'ERD (§0, §1) fixe le principe `shared-schema-rls` (ADR-0001) et liste quatre fonctions
`SECURITY DEFINER` pre-tenant, dont deux sont implementees par la tranche 001 :
`signet.create_organization(owner_user_id, org_name)` et `signet.organizations_for_user(user_id)`.
Il fixe aussi deux triggers internes `SECURITY DEFINER` supplementaires pour cette tranche :
`signet.create_organization_counters()` (instancie `organization_link_usage`/`subscription` a la
creation d'une organisation) et `signet.assert_owner_remains()` (invariant « au moins un owner »,
trigger `member_keep_last_owner`).

L'ERD ne nomme pas explicitement le role qui possede les tables (« le role proprietaire », ERD §1)
ni ne tranche si les fonctions `SECURITY DEFINER` doivent porter l'attribut `BYPASSRLS`. La tranche
001 devait donc trancher ces deux points d'implementation avant d'ecrire la premiere migration.

## Partie 1 — Un role `signet_owner` distinct du role qui joue les migrations

### Options envisagees

**Option A — Le role qui joue les migrations (`DATABASE_URL_MIGRATE`) est aussi le proprietaire
des tables.** Le plus simple : une seule connexion, un seul role, `CREATE TABLE` en fait
automatiquement le proprietaire. Ecartee : sur une instance Postgres locale ou jetable de
developpement/test, le role qui a le droit de jouer des migrations DDL (`CREATE ROLE`, `CREATE
SCHEMA`) est en pratique un superuser. Or **un superuser Postgres contourne toujours RLS, y
compris `FORCE ROW LEVEL SECURITY`** — ce n'est pas un attribut qu'on peut lui retirer sans lui
retirer le statut de superuser lui-meme. Si ce role est aussi le proprietaire des tables, le test
anti-regression « `FORCE ROW LEVEL SECURITY` s'applique meme au proprietaire »
(`tests/organizations/isolation.test.ts`, `TEST_DATABASE_URL_TABLE_OWNER`) ne testerait plus rien :
il passerait toujours, `FORCE` soit-il present ou retire par erreur dans une migration future.

**Option B — Un role `signet_owner` dedie, non superuser, sans `BYPASSRLS`, proprietaire des
tables ; les migrations sont jouees par une connexion bootstrap distincte (typiquement le
superuser par defaut d'une instance locale/jetable), qui transfere la propriete a `signet_owner`
en fin de chaque migration (`ALTER TABLE ... OWNER TO signet_owner`).** Retenue.

### Decision

Option B. Quatre roles applicatifs, tous crees par
`packages/db/migrations/0001_roles_schema_context.sql` :

| Role | LOGIN | Attributs | Role |
|---|---|---|---|
| `signet_owner` | oui | ni superuser, ni `BYPASSRLS` | Proprietaire de toutes les tables (`ALTER TABLE ... OWNER TO`), atteint uniquement par `TEST_DATABASE_URL_TABLE_OWNER` pour le test anti-regression `FORCE ROW LEVEL SECURITY`. Ne sert jamais aux requetes applicatives (ADR-0001). |
| `signet_app` | oui | ni superuser, ni `BYPASSRLS` | Role applicatif non privilegie (Route Handlers / Server Actions), seul role sous lequel l'application execute ses requetes tenant. |
| `signet_auth` | oui | ni superuser, ni `BYPASSRLS` | Role dedie a better-auth, limite aux quatre tables d'authentification (ERD §2). |
| `signet_definer` | non (`NOLOGIN`) | ni superuser, ni `BYPASSRLS` (voir Partie 2) | Proprietaire des fonctions `SECURITY DEFINER` et de leurs triggers internes. Inatteignable par connexion directe. |

Le role qui joue effectivement `pnpm db:migrate` (`DATABASE_URL_MIGRATE`) n'apparait dans aucune
ligne de ce tableau : c'est une connexion bootstrap externe (superuser d'une instance locale/jetable
de developpement ou de test), documentee en tete de `packages/db/migrations/0001_roles_schema_context.sql`
et `packages/db/src/migrate.ts`, qui cree les quatre roles ci-dessus puis leur transfere la propriete
des objets qu'elle a crees pour leur compte.

### Consequences acceptees

- Chaque migration qui cree une table ou une fonction `SECURITY DEFINER` doit se terminer par un
  transfert de propriete explicite (`ALTER TABLE ... OWNER TO signet_owner`, `ALTER FUNCTION ...
  OWNER TO signet_definer`) — un oubli laisserait l'objet appartenir au role bootstrap (superuser),
  qui contournerait silencieusement RLS dessus.
- `TEST_DATABASE_URL_TABLE_OWNER` doit pointer vers `signet_owner`, jamais vers le role bootstrap
  utilise par `DATABASE_URL_MIGRATE` : sinon le test anti-regression `FORCE ROW LEVEL SECURITY`
  redevient un test qui ne peut jamais echouer.
- `public._signet_migrations` (historique tenu par `packages/db/src/migrate.ts`) a RLS activee et
  forcee sans aucune politique, et aucun privilege pour PUBLIC (migration 0007) : seules les
  migrations lancees en superutilisateur peuvent la lire ou l'ecrire. Jouer les migrations sous un
  role non superuser exigerait de rouvrir cette ADR.
- Un role supplementaire a documenter et dont il faut fixer le mot de passe (cf. CLAUDE.md :
  aucun mot de passe n'est genere ni ecrit en dur dans les migrations, c'est une operation humaine
  hors version control).

## Partie 2 — `signet_definer` sans `BYPASSRLS`

### Contexte du refus initial

Une premiere version de cette tranche donnait l'attribut `BYPASSRLS` a `signet_definer`, au motif
que les fonctions `SECURITY DEFINER` pre-tenant « operent avant qu'un contexte tenant existe »
(ERD §1). Refuse : `BYPASSRLS` est un contournement total et permanent, au niveau du role, de
toute politique RLS sur toute table, pour toute requete executee par ce role — y compris une
requete qu'une future fonction `SECURITY DEFINER` mal ecrite emettrait par erreur sans le predicat
de perimetre attendu (ADR-0002, « politique de durcissement »). C'est exactement le mode de
defaillance silencieux que RLS est cense empecher.

Le point cle, deja implicite dans le mecanisme de contexte tenant (ERD §1) : `SET LOCAL
app.organization_id` est un parametre de **session**, pas un privilege de **role**. Une fonction
`SECURITY DEFINER` change l'identite d'execution (donc les privileges verifies par RLS) mais **ne
change pas la session** : `current_setting('app.organization_id', true)` reste lisible et
modifiable a l'interieur de la fonction. Les politiques RLS fondees sur
`signet.current_org()`/`signet.current_user_id()` peuvent donc continuer a s'appliquer a
`signet_definer` sans `BYPASSRLS`, a condition que chaque fonction pose (ou lise) ce contexte de
maniere correcte pour l'operation qu'elle effectue.

### Solution retenue, fonction par fonction

Les politiques RLS existantes de `organization` et `member` (`organization_isolation`,
`member_isolation`) sont **elargies** : `TO signet_app` devient `TO signet_app, signet_definer`,
predicat inchange (`organization_id = signet.current_org()` / `id = signet.current_org()`). Des
politiques d'ecriture dediees, du meme type, sont **ajoutees** pour `signet_definer` sur
`organization_link_usage` et `subscription` (qui n'avaient jusqu'ici qu'une politique de lecture
`TO signet_app`).

| Fonction | Cible RLS | Mecanisme |
|---|---|---|
| `signet.create_organization` | Une seule organisation, dont l'identifiant est genere **par la fonction elle-meme** avant tout INSERT. | La fonction genere `v_org_id := signet.uuidv7()`, puis appelle `PERFORM set_config('app.organization_id', v_org_id::text, true)` **avant** d'inserer la ligne `organization` (avec cet `id` explicite, plus le `DEFAULT` n'est pas sollicite). Le reste de la transaction (INSERT `member`, triggers `create_organization_counters`/`propagate_subscription_quota`) herite du meme contexte `SET LOCAL`, donc des memes politiques `organization_id = current_org()` que `signet_app`. |
| `signet.assert_owner_remains` (trigger `member_keep_last_owner`) | Une seule organisation, connue par la ligne du trigger (`OLD.organization_id`), independamment du contexte de la session qui a declenche le `DELETE` (le test anti-regression declenche volontairement ce `DELETE` sous un role `BYPASSRLS` de test, sans avoir pose `app.organization_id`). | La fonction appelle `PERFORM set_config('app.organization_id', OLD.organization_id::text, true)` comme toute premiere instruction, avant ses `SELECT` sur `organization` et `member`. |
| `signet.create_organization_counters` (trigger `AFTER INSERT ON organization`) | Meme organisation que celle deja fixee par `create_organization` plus haut dans la meme transaction. | Aucune action supplementaire necessaire : `SET LOCAL` reste valide jusqu'a la fin de la transaction, et ce trigger ne peut s'executer qu'a l'interieur de celle ouverte par `create_organization` (`AFTER INSERT ON organization`, et `create_organization` est l'unique chemin d'insertion). |
| `signet.propagate_subscription_quota` (trigger `AFTER INSERT OR UPDATE OF tier ON subscription`) | Une seule organisation, connue par la ligne du trigger (`NEW.organization_id`), independamment du contexte de la session appelante. | **Corrige en migration 0005** suite a l'audit de securite de la tranche 001 (docs/04-runbooks/audits/audit-001.md, MAJEUR-2) : la justification initiale (« s'execute toujours dans la transaction de `create_organization` ») ne couvrait que la branche `INSERT` — fausse par construction pour la branche `UPDATE OF tier`, qui ne se declenche jamais pendant une creation (changement de palier manuel, ou webhook Stripe des la tranche 002, ERD §8.1 : « le webhook Stripe n'a pas d'utilisateur »). La fonction appelle desormais `PERFORM set_config('app.organization_id', NEW.organization_id::text, true)` comme toute premiere instruction (meme patron qu'`assert_owner_remains`), puis verifie via `GET DIAGNOSTICS ... ROW_COUNT` que l'`UPDATE` du compteur a bien touche exactement une ligne (ERD §7 : « une organisation sans compteur est un bug, pas un cas a absorber silencieusement »), sinon elle leve. |
| `signet.organizations_for_user` | **Plusieurs** organisations a la fois (un utilisateur appartient a plusieurs organisations, PRD). Aucune valeur unique de `current_org()` ne peut couvrir ce cas — poser `app.organization_id` tour a tour dans une boucle contournerait la garantie d'atomicite d'un `SELECT` unique. | Deux politiques **additionnelles**, scopees non pas par `current_org()` mais par `signet.current_user_id()` — exactement l'exception deja documentee par ADR-0002 (« Seule exception documentee : `signet.organizations_for_user()`, dont le perimetre legitime est l'utilisateur appelant... elle reste bornee, mais sur un autre axe ») : `member_definer_self_read` (`FOR SELECT TO signet_definer USING (user_id = signet.current_user_id())`) et `organization_definer_self_read` (`FOR SELECT TO signet_definer USING (EXISTS (SELECT 1 FROM member m WHERE m.organization_id = organization.id AND m.user_id = signet.current_user_id()))`). La fonction verifie deja `p_user_id = signet.current_user_id()` (sinon elle leve) avant tout `SELECT` : le perimetre reste donc strictement « les organisations de l'utilisateur authentifie courant », jamais plus large. |

Aucune des quatre fonctions de cette tranche n'a besoin d'un acces non borne aux tables : chacune
opere soit sur une organisation unique et connue (posee explicitement dans la session le temps de
l'operation), soit sur le perimetre de l'utilisateur appelant (deja verifie par la fonction
elle-meme). `BYPASSRLS` n'est donc necessaire pour aucune d'entre elles.

### Consequences acceptees

- Toute future fonction `SECURITY DEFINER` ajoutee au schema (invitations, quota, facturation)
  doit suivre le meme patron : soit elle pose explicitement `app.organization_id` sur
  l'organisation unique qu'elle traite avant d'agir, soit — si elle a legitimement besoin de voir
  plusieurs organisations a la fois — elle s'appuie sur une politique additionnelle scopee par
  `signet.current_user_id()` (jamais une politique `USING (true)` non bornee, jamais `BYPASSRLS`).
  Un signal de revue d'architecture (ERD §1) reste du si une telle fonction ne rentre dans aucun
  des deux patrons.
- `signet_definer` reste `NOLOGIN` : meme sans `BYPASSRLS`, il n'est jamais atteignable par une
  connexion directe, uniquement par l'execution d'une fonction qu'il possede.
- Les `GRANT` de table a `signet_definer` restent strictement necessaires a l'operation effectuee
  (`SELECT, INSERT` sur `organization`/`member`, `INSERT, UPDATE` sur `organization_link_usage`,
  `INSERT` sur `subscription`) : la RLS filtre les lignes, le `GRANT` autorise l'operation, les deux
  defenses restent independantes et toutes deux necessaires (ADR-0002).
- Le test anti-regression `member_keep_last_owner` (`tests/organizations/invariants.test.ts`), qui
  declenche le `DELETE` sous un role `BYPASSRLS` de test sans poser de contexte tenant, continue de
  passer : c'est precisement le scenario que le `set_config` interne a `assert_owner_remains`
  couvre, independamment du contexte (ou de l'absence de contexte) de l'appelant.

## Signal de reexamen

Une fonction `SECURITY DEFINER` future doit legitimement lire ou ecrire plusieurs organisations
**sans** qu'un axe `current_user_id()` (ou un axe equivalent, explicite et etroit) ne borne le
perimetre — par exemple un job de reconciliation inter-organisations. Le cas echeant, cette ADR
doit etre rouverte plutot que de reintroduire `BYPASSRLS` par defaut.
