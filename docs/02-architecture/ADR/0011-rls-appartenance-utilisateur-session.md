# ADR-0011 — La RLS de `signet_app` exige l'appartenance de l'utilisateur de session a l'organisation du contexte

- **Statut** : accepte (2026-09-29, orchestrateur en mode autonome, D-027 ; realise la decision humaine D-022 sans engager le produit — contestable par l'humain a la revue de la PR)
- **Date** : 2026-09-29
- **Phase** : 3 — tranche 010 (durcissement de l'isolation tenant)
- **Realise** : D-022 (decision humaine, option A). Ne rouvre pas les options B et C de D-022.
- **Amende** : ADR-0004 point 4 ; ADR-0007 Partie 2 (tableau des politiques elargies a `signet_definer`, voir « Consequences »).
- **Inclut** : audit-001 MINEUR-10 (attributs des roles), D-024.

## Contexte

Jusqu'a la migration 0008, toutes les politiques RLS des tables a `organization_id` comparent la
ligne a `signet.current_org()`, c'est-a-dire a la valeur brute de `app.organization_id`. Cette
valeur est posee par `withTenant` (`apps/web/src/lib/db.ts`) a partir d'un identifiant que
l'appelant HTTP choisit (parametre d'URL). La politique valide donc ce que l'appelant demande :
elle est tautologique (audit-001 MINEUR-1). Seul le `SELECT ... FROM member WHERE user_id = $2`
de `renameOrganization` empeche aujourd'hui l'acces inter-tenant ; une route future qui
l'oublierait n'aurait aucun filet.

D-022 tranche : les politiques doivent aussi verifier que **l'utilisateur de session**
(`app.user_id`, pose par le serveur depuis la session better-auth, jamais depuis la requete) est
membre de l'organisation du contexte.

Ce qui serait faux de faire simplement :

1. **Ajouter `EXISTS (SELECT 1 FROM member ...)` a la politique de `member`.** Postgres refuse
   (« infinite recursion detected in policy for relation member ») ; en passant par une fonction
   `SECURITY INVOKER`, la recursion se deplace a l'execution (`stack depth limit exceeded`).
2. **Redefinir `signet.current_org()` sans toucher aux politiques de `signet_definer`.** Les
   fonctions `SECURITY DEFINER` posent leur contexte depuis une valeur de confiance, parfois sans
   aucun utilisateur de session (`propagate_subscription_quota` declenchee par un webhook Stripe,
   tranche 002, ou sous `BYPASSRLS` dans le test d'invariant ; `assert_owner_remains`), ou avant
   que le membership existe (`create_organization` : l'`INSERT INTO organization` et le trigger
   `create_organization_counters` precedent l'`INSERT INTO member` owner). Exiger l'appartenance
   dans leurs politiques les casse toutes.
3. **Faire de la fonction de contexte une fonction `SECURITY DEFINER` possedee par le role de
   migration.** `CREATE OR REPLACE` conserve le proprietaire : `current_org()` a ete creee en 0001
   par le role bootstrap (superutilisateur). Une fonction `SECURITY DEFINER` possedee par un
   superutilisateur s'execute hors RLS. Le test de catalogue de l'usine ne le verrait pas : il
   exclut `current_user`, c'est-a-dire precisement ce role.

## Modele de menace retenu

La barriere protege contre **un oubli du code applicatif** (route qui ne verifie pas
l'appartenance, ou qui la verifie apres avoir lu). Elle ne protege **pas** contre l'execution de
SQL arbitraire sous `signet_app` (injection SQL, connexion compromise) : un tel attaquant peut
poser `app.user_id` a la valeur de son choix par `set_config`. C'est une limite assumee du
mecanisme `SET LOCAL`, deja implicite dans ADR-0001, et non une regression. L'option qui la
leverait est ecartee plus bas (option A5).

## Options envisagees

### a) Mecanisme

**A1 — Predicat d'appartenance explicite dans chaque politique**
(`... AND EXISTS (SELECT 1 FROM member m WHERE m.organization_id = current_org() AND m.user_id = current_user_id())`).
Lisible table par table. Ecartee : (1) recursion sur `member`, qui exige de toute facon une
fonction dediee ; (2) chaque politique future doit recopier le predicat : l'oublier sur une table
de la tranche 005 rend cette table tautologique sans aucun signal — c'est exactement la faiblesse
de l'option B de D-022 deplacee dans les migrations ; (3) `subscription` et `app_user` passeraient
a deux sous-requetes, contre la regle de lisibilite d'ADR-0001.

**A2 — Nouvelle fonction `signet.current_member_org()` pour les politiques `signet_app`,
`current_org()` inchangee (brute).** Nom explicite. Ecartee : `current_org()` reste executable par
`signet_app` et reste le motif ecrit partout dans l'ERD ; une politique future qui recopie
`organization_id = signet.current_org()` perd la verification d'appartenance en silence. La rendre
sure imposerait de revoquer `current_org()` a `signet_app` et de reecrire toutes les politiques
applicatives : c'est A3 avec les noms inverses et davantage de diff.

**A3 — `signet.current_org()` devient la primitive verifiee ; une primitive brute
`signet.context_org()` est reservee a `signet_definer`.** Retenue.
- `current_org()` : `SECURITY DEFINER`, proprietaire `signet_definer`, renvoie `app.organization_id`
  **seulement si** `(current_user_id(), app.organization_id)` existe dans `member`, sinon `NULL`.
- `context_org()` : lecture brute de `app.organization_id` (l'ancienne `current_org()`),
  executable **uniquement** par `signet_definer` (proprietaire ; aucun `GRANT`, `PUBLIC` revoque).
- Les politiques `signet_app` gardent leur texte a l'identique (`organization_id = signet.current_org()`) :
  elles heritent de la verification par l'OID de la fonction, sans reecriture. Le motif de l'ERD,
  recopie par les tranches futures, est sur par construction.
- Les politiques `signet_definer` passent a `context_org()`.
- Une politique `signet_app` qui utiliserait par erreur `context_org()` echoue bruyamment
  (`permission denied for function context_org`, 42501) des la premiere requete : le mauvais
  usage de la primitive brute ne peut pas passer inapercu.

**A4 — Politique `AS RESTRICTIVE` d'appartenance ajoutee a chaque table.** Les politiques
existantes restent intactes, la condition est combinee en ET. Ecartee : meme discipline par table
qu'A1 (une table nouvelle sans sa politique restrictive n'a aucune verification), une politique
restrictive est facile a manquer en relecture, et elle exige quand meme la fonction non recursive
d'A3 pour `member`.

**A5 — Deriver l'utilisateur en base depuis le jeton de session** (fonction `SECURITY DEFINER`
qui lit `session.token`). Leverait la limite du modele de menace. Ecartee : couple la couche tenant
aux tables d'authentification (carve-out ERD §2), fait transiter un secret porteur dans un
parametre de session (lisible dans `pg_stat_activity` et dans les journaux), depend du format de
better-auth, et depasse le perimetre de D-022, dont la menace est l'oubli applicatif.

### b) Recursion sur `member`

**R1 — `current_org()` en `SECURITY DEFINER`, proprietaire `signet_definer`.** Retenue. La
politique `signet_app` de `member` appelle `current_org()` ; la requete interne de la fonction
s'execute sous `signet_definer`, dont les politiques sur `member` (`member_definer_context` sur
`context_org()`, `member_definer_self_read` sur `current_user_id()`) n'appellent pas
`current_org()`. La chaine s'arrete a la deuxieme marche. La ligne cherchee
(`user_id = current_user_id()`) est visible par `member_definer_self_read`.
**Invariant qui en decoule** : aucune politique applicable a `signet_definer` n'appelle
`signet.current_org()`. Le violer rouvre la recursion. Il est verifie mecaniquement (test de
catalogue de la tranche, voir « Tests »).

**R2 — Proprietaire avec `BYPASSRLS`.** Ecartee : contredit ADR-0007 Partie 2 (D-009, refus
humain).

**R3 — Proprietaire `signet_owner`.** Ecartee : `FORCE ROW LEVEL SECURITY` s'applique a lui et il
n'a aucune politique, il ne verrait rien ; lui en donner une ferait d'un role `LOGIN` un lecteur de
`member`.

**R4 — Table d'appartenance denormalisee sans RLS.** Ecartee : une copie de `member` que rien ne
garde honnete, et une table sans RLS dans `public` (test de catalogue rouge).

**Pourquoi R1 ne rouvre pas de contournement.** `current_org()` ne prend **aucun parametre** : elle
ne repond que pour le couple `(current_user_id(), context_org())` deja pose dans la session, et ne
renvoie que la valeur que l'appelant a lui-meme posee, ou `NULL`. Elle n'est pas un oracle
d'appartenance d'autrui par parametre libre. Ce qu'un code qui forgerait `app.user_id` pourrait en
apprendre, il l'obtient deja en lisant les tables sous ce contexte forge (modele de menace
ci-dessus) : la fonction n'ajoute aucune capacite. Durcissement obligatoire du corps : noms
qualifies (`public.member`) et `SET search_path = pg_catalog, signet, public, pg_temp` avec
`pg_temp` **en dernier**. Sans `pg_temp` explicite, Postgres cherche le schema temporaire **en
premier** pour les relations ; `signet_app` a par defaut le droit `TEMPORARY` sur la base et
pourrait creer une table temporaire `member` qui masquerait la vraie a l'interieur de la fonction.

### c) Cout et volatilite

**Index** : `member_org_user_idx UNIQUE (organization_id, user_id)` (migration 0003) sert
exactement la recherche de `current_org()` (egalite sur les deux colonnes, une ligne au plus).
`member_user_idx (user_id)` reste utile a `organizations_for_user`. **Aucun index nouveau.**

**Evaluation** : une sonde d'index unique par appel. Dans une politique `organization_id =
signet.current_org()`, le planificateur utilise l'appel comme cle d'index a l'execution (fonction
`STABLE`), donc une seule evaluation par parcours d'index. Dans un plan ou le predicat reste un
filtre (parcours sequentiel, ou index sur une autre colonne), la fonction est evaluee par ligne :
une sonde par ligne, acceptable a la charge du PRD. Levier documente si un plan le montre un
jour : ecrire `(SELECT signet.current_org())` dans les politiques concernees, qui force une
evaluation unique par instruction (InitPlan). Non applique ici : il imposerait de reecrire les
politiques, ce que A3 evite.

**Volatilite : `STABLE`.** Retenue.
- `STABLE` garantit un resultat constant **au sein d'une instruction** ; Postgres ne met aucun
  resultat en cache d'une instruction a l'autre. Chaque instruction de la transaction relit
  `member` sur son propre instantane, qui inclut les modifications deja faites par la transaction
  elle-meme. Un retrait de membre (tranche 008) suivi d'une lecture dans la **meme transaction**
  est donc pris en compte par l'instruction suivante : c'est le cas limite « concurrence » du
  contrat.
- `VOLATILE` ecartee : n'apporte rien sur la visibilite entre instructions (deja garantie), et
  empeche d'utiliser l'appel comme cle d'index (evaluation par ligne systematique).
- `IMMUTABLE` exclue : Postgres pourrait pre-evaluer la fonction a la planification et figer son
  resultat dans un plan prepare, reutilise d'une transaction a l'autre sur une connexion du pool.
  Ce serait une fuite d'appartenance entre requetes.

**Limite assumee** : entre transactions concurrentes, la barriere n'est pas plus forte que
`READ COMMITTED`. Une instruction commencee avant le `COMMIT` d'un retrait de membre s'acheve avec
l'ancien etat ; la suivante voit le retrait. Si la tranche 008 exige davantage (revocation
instantanee y compris pour une instruction en vol), elle le traitera par verrou sur la ligne
`member`, pas en changeant cette fonction.

### d) Politiques de `signet_definer`

**Retenu : politiques `signet_app` et `signet_definer` separees ; celles de `signet_definer`
restent fondees sur le contexte brut (`context_org()`), sans condition d'appartenance.**

Raison : `signet_definer` n'est atteignable que par l'execution d'une fonction de la liste fermee
(ERD §1), et chacune de ces fonctions derive son contexte d'une valeur de confiance qu'elle
controle, pas d'une valeur de l'appelant HTTP :

| Fonction | Source du contexte |
|---|---|
| `create_organization` | identifiant qu'elle genere elle-meme (`signet.uuidv7()`), apres verification de l'identite (e ci-dessous) |
| `create_organization_counters` | contexte de `create_organization`, seul chemin d'`INSERT INTO organization` (l'`INSERT` direct par `signet_app` est desormais impossible, voir « Consequences ») |
| `propagate_subscription_quota` | `NEW.organization_id` |
| `assert_owner_remains` | `OLD.organization_id` |
| `organizations_for_user` | aucune organisation : axe `current_user_id()`, garde d'identite (e) |
| `current_org` (nouvelle) | lecture seule, bornee au couple de la session |

Exiger l'appartenance ici n'ajouterait aucune securite (la valeur n'est pas choisie par
l'attaquant) et casserait trois invariants de 001. Politiques concernees :

| Politique | Avant | Apres |
|---|---|---|
| `organization_isolation` | `TO signet_app, signet_definer`, `current_org()` | `TO signet_app`, texte inchange (verifie par construction) |
| `organization_definer_context` (nouvelle) | — | `TO signet_definer`, `id = context_org()` en `USING` et `WITH CHECK` |
| `member_isolation` | `TO signet_app, signet_definer`, `current_org()` | `TO signet_app`, texte inchange |
| `member_definer_context` (nouvelle) | — | `TO signet_definer`, `organization_id = context_org()` |
| `organization_link_usage_definer_write` | `current_org()` | `context_org()` |
| `subscription_definer_insert` | `current_org()` | `context_org()` |
| `member_definer_self_read`, `organization_definer_self_read` | `current_user_id()` | inchangees |

### e) Fonctions dependant de l'utilisateur de session (AC4)

**`signet.organizations_for_user(p_user_id)`.** La garde actuelle `p_user_id IS NULL OR p_user_id
<> signet.current_user_id()` vaut `NULL` quand `app.user_id` est absent, donc ne leve pas. Nouvelle
garde, premieres instructions : lire `current_user_id()` ; s'il est `NULL`, lever ; si
`p_user_id IS DISTINCT FROM` cette valeur, lever. `IS DISTINCT FROM` et le test explicite du `NULL`
ferment les deux cas.

**`signet.create_organization(p_owner_user_id, p_org_name)` : lier `p_owner_user_id` a
l'utilisateur de session.** Retenu : premiere instruction, lever si `current_user_id()` est `NULL`
ou si `p_owner_user_id IS DISTINCT FROM current_user_id()`.
- Sans cela, tout code `signet_app` peut creer une organisation dont **un autre** utilisateur est
  owner : une erreur de variable dans une route future fabriquerait une organisation au nom d'un
  tiers, sans signal. Le PRD ne connait aucun cas de creation pour autrui (US-01 : l'utilisateur
  cree sa propre organisation ; aucune fonction d'administration).
- Compatible sans changement de code : `createOrganization` passe le meme `userId` a
  `withUserOnly` (qui pose `app.user_id`) et a la fonction. Les fixtures de test creent leurs
  organisations par HTTP, donc par ce chemin.
- Option ecartee : supprimer le parametre et lire `current_user_id()` seul. Meme garantie, mais
  change la signature (`DROP FUNCTION`, nouveaux `GRANT`, modification de `organizations.ts`) pour
  un gain nul : le parametre redondant est inoffensif des qu'il est verifie.
- Option ecartee : statu quo. Laisse une fonction `SECURITY DEFINER` agir pour un utilisateur que
  la session n'a pas authentifie, a l'inverse de `organizations_for_user`.

**Code d'erreur des deux gardes : `SG002`** (classe utilisateur, a cote de `SG001`, ERD §0),
« identite de session absente ou differente de l'identite demandee ». Pas `42501` : les tests
d'invariant de 001 (`signet_owner`/`signet_auth` ne peuvent pas executer `create_organization`)
attendent `42501` pour le **refus d'`EXECUTE`**. Si la garde levait aussi `42501`, un `GRANT
EXECUTE` accorde par erreur a `signet_owner` serait masque : l'appel echouerait a la garde (aucun
`app.user_id` dans ce test) avec le meme code, et le test resterait vert pour la mauvaise raison
(meme famille que MINEUR-9). `SG002` garde les deux causes distinguables.

### f) `app_user_visible_to_co_members`

Texte inchange : `EXISTS (SELECT 1 FROM member m WHERE m.user_id = app_user.id AND
m.organization_id = signet.current_org())`. Comme `current_org()` est desormais verifiee, la
politique n'expose un compte que si l'utilisateur de session est lui-meme membre de l'organisation
du contexte. La sous-requete sur `member` passe en outre par `member_isolation`, qui verifie la
meme chose : double couverture, sans recursion (la sous-requete est evaluee sous `signet_app`,
`current_org()` sous `signet_definer`).

### g) Contexte malforme (AC3 c)

**Confirme** : `app.user_id` ou `app.organization_id` non UUID fait lever le cast `::uuid`
(`22P02 invalid_text_representation`) des la premiere politique evaluee. C'est une erreur, jamais
une ligne : conforme a AC3. Une valeur vide est ramenee a `NULL` par `nullif` (fermeture par
defaut, 0 ligne). Option ecartee : attraper l'erreur de cast et renvoyer `NULL`. Elle masquerait un
defaut du serveur (une valeur non UUID ne peut venir que d'un bogue de `withTenant` ou de son
appelant) en le transformant en « acces refuse » silencieux, ce que la regle « echouer
bruyamment » interdit.

### h) Roles (MINEUR-10)

**Retenu : migration separee `0010`**, distincte de 0009. Les roles sont communs au cluster, la
RLS est propre a la base : deux sujets, deux revues, et le test d'AC6 rejoue le fichier 0010 seul.

Contenu attendu :
1. **Appartenances : lever si l'un des quatre roles est membre d'un role quelconque**
   (`pg_auth_members.member` parmi les quatre). ADR-0007 n'en accorde aucune. Une appartenance
   permet `SET ROLE` vers le role parent : membre de `signet_owner`, `signet_app` pourrait
   `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` ; membre d'un superutilisateur, tout. Les attributs
   `SUPERUSER`/`BYPASSRLS` ne s'heritent pas, mais `SET ROLE` suffit.
   On **leve** plutot que de revoquer : une appartenance a ete accordee deliberement par un
   administrateur sur un etat commun au cluster ; la retirer en silence cacherait la mauvaise
   configuration et pourrait casser un autre usage. Le message nomme les roles, jamais de secret.
2. **Attributs : `ALTER ROLE` inconditionnel**, idempotent :
   `signet_owner`, `signet_app`, `signet_auth` : `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` ;
   `signet_definer` : `NOLOGIN` et les memes `NO*`. Ici on **reimpose** plutot que de lever : ADR-0007
   definit ces attributs de facon exhaustive, l'etat cible n'est pas ambigu (regle
   `drizzle-postgres.md` § Roles). `NOREPLICATION` est ajoute a la liste d'ADR-0007 : un role
   `REPLICATION` lit toutes les donnees par le protocole de replication, hors RLS ; c'est deja la
   valeur par defaut a la creation (aucun changement sur une base neuve).
3. Aucun mot de passe, aucune instruction de transaction (`BEGIN`/`COMMIT`) : `migrate.ts`
   enveloppe le fichier, et le test le rejoue dans sa propre transaction.

**Test (AC6)**, sans modifier `tests/_factory/db-catalog.test.ts` (qui reste vert et detecte deja
les quatre roles : proprietaires ou beneficiaires d'objets de `signet`/`public`) : un test de la
tranche, sous la connexion d'administration de la base de test (superutilisateur, seule autorisee
a modifier des roles), dans une transaction **toujours annulee** (`ALTER ROLE` et `CREATE ROLE`
sont transactionnels, le cluster n'est jamais laisse altere, meme si le test echoue) :
- (i) `ALTER ROLE signet_app BYPASSRLS; ALTER ROLE signet_definer LOGIN;` puis execution du contenu
  du fichier `0010`, puis lecture de `pg_roles` : attributs corriges ; `ROLLBACK`.
- (ii) creation d'un role temporaire, `GRANT` de ce role a `signet_app`, execution de `0010` :
  exception attendue (code `P0001`, message citant `signet_app`) ; `ROLLBACK`.
- (iii) hors transaction : les quatre roles ont leurs attributs cibles et aucune ligne dans
  `pg_auth_members` comme membre.

### i) `withTenant`

**Aucun changement fonctionnel.** `userId` est deja obligatoire par le type `TenantContext`, et un
`organizationId` sans utilisateur est donc impossible a exprimer. Un `userId` vide est ramene a
`NULL` par `nullif` et ferme tout. La barriere est desormais en base : une verification
supplementaire dans `withTenant` serait redondante. Seul le commentaire de `withUserOnly`
(« `app.user_id` reste pose, utile pour d'eventuelles politiques futures ») devient inexact :
`create_organization` l'exige desormais. Mise a jour du commentaire recommandee, sans effet sur le
comportement.

### j) Schema Drizzle

**Aucune colonne, aucune table, aucun index nouveau.** `packages/db/src/schema/*` ne change pas ;
`pnpm db:generate` ne doit produire aucune difference (a verifier et consigner comme preuve). 0009
et 0010 sont des migrations SQL ecrites a la main, comme 0004 a 0008.

## Decision

- **A3** : `signet.current_org()` devient la primitive verifiee (`SECURITY DEFINER`, `STABLE`,
  proprietaire `signet_definer`, `search_path` fige avec `pg_temp` en dernier, `EXECUTE` a
  `signet_app` seul) ; `signet.context_org()` est la primitive brute, reservee a `signet_definer`.
  Critere qui tranche : **le motif recopie par les tranches futures doit etre sur par defaut**,
  et le mauvais usage de la primitive brute doit echouer bruyamment.
- **R1** pour la recursion, avec l'invariant « aucune politique de `signet_definer` n'appelle
  `current_org()` », verifie par test.
- **`STABLE`**, aucun index nouveau.
- **Politiques `signet_app` et `signet_definer` separees** ; `signet_definer` sur `context_org()`.
- **`create_organization` et `organizations_for_user` levent `SG002`** si l'utilisateur de session
  est absent ou different du parametre.
- **Contexte malforme : erreur `22P02`**, acceptee.
- **Migration 0009** (RLS et fonctions) et **migration 0010** (roles : leve sur appartenance,
  reimpose les attributs).
- **`withTenant` et le schema Drizzle inchanges.**
- **Incluse dans 0009 (retenue par l'orchestrateur, D-027, contestable)** : `ALTER FUNCTION ... SET search_path = pg_catalog,
  signet, public, pg_temp` pour les trois fonctions de trigger existantes
  (`create_organization_counters`, `propagate_subscription_quota`, `assert_owner_remains`). Meme
  defaut `pg_temp` que ci-dessus ; aucune n'est aujourd'hui atteignable par `signet_app` (il n'a
  ni `INSERT` possible sur `organization`, ni ecriture sur `subscription`/`member`), d'ou une
  correction preventive, sans changement de comportement.

## Tests exiges (en plus d'AC1 a AC6)

- **Catalogue, tranche** : toute fonction `prosecdef` du schema `signet` a pour proprietaire
  `signet_definer` (le test de l'usine ne voit pas un proprietaire superutilisateur, voir
  « Contexte » point 3).
- **Catalogue, tranche** : aucune politique dont `polroles` contient `signet_definer` n'a
  d'expression (`pg_get_expr(polqual)`, `pg_get_expr(polwithcheck)`) mentionnant
  `current_org(` ; aucune politique dont `polroles` contient `signet_app` ne mentionne
  `context_org(`.
- **Recursion** : lecture de `member` sous `signet_app` avec un contexte valide renvoie les lignes
  attendues, sans erreur (couvert par AC1, explicite ici).
- **`current_org()` sans contexte** : renvoie `NULL`, ne leve pas. C'est une exception assumee a la
  regle `drizzle-postgres.md` point 3/6 (« sans contexte, exiger une erreur ») : cette fonction est
  une primitive de politique, pas une operation ; lever casserait la fermeture par defaut que
  `isolation.test.ts` verifie (0 ligne, pas d'erreur).
- **`SG002`** : `organizations_for_user` sans `app.user_id` ; `create_organization` sans
  `app.user_id` ; `create_organization` avec `p_owner_user_id` different d'`app.user_id` (aucune
  organisation creee, verifie en boite blanche).

## Consequences acceptees

- **`current_org()` change de sens.** Ce n'est plus « la valeur posee » mais « la valeur posee, si
  l'utilisateur de session y est membre ». Le commentaire de la fonction, l'ERD §1 et ce document le
  disent. Quiconque ecrit une politique pour `signet_definer` doit utiliser `context_org()` ;
  utiliser `current_org()` y reintroduit la recursion (et casse les fonctions sans utilisateur),
  et le test de catalogue le refuse.
- **Toute politique `signet_app` future sur une table tenant s'ecrit `organization_id =
  signet.current_org()`** et beneficie de la verification sans rien ajouter. Une politique qui
  ne se fonde pas sur `current_org()` (autre axe) doit etre justifiee dans un ADR.
- **La RLS verifie l'appartenance, pas le role**, sauf pour `subscription` (owner). Un member
  (non-owner) dont la route oublierait le controle de role pourrait `UPDATE organization` : la
  garde de role reste applicative (ADR-0004, etape 3). Durcir `UPDATE organization` en RLS au role
  owner est possible mais hors de D-022 ; a porter au backlog si souhaite.
- **La liste fermee des fonctions `SECURITY DEFINER` gagne une entree** (`current_org`), d'une
  nature nouvelle : primitive de politique, pas point d'entree pre-tenant. Cette ADR est la revue
  d'architecture exigee par l'ERD §1.
- **`INSERT INTO organization` par `signet_app` devient structurellement impossible** : le
  `WITH CHECK id = current_org()` exigerait un membership sur une organisation qui n'existe pas
  encore (FK). Le `GRANT INSERT` superflu (audit-001 MINEUR-2) reste en place, inoffensif ; sa
  revocation n'est pas dans le perimetre de 010.
- **ADR-0007 Partie 2** : le tableau qui decrit `organization_isolation`/`member_isolation`
  « elargies a `signet_definer` » est remplace, pour ces deux politiques, par les politiques
  separees ci-dessus. Le principe (definer sans `BYPASSRLS`, contexte pose depuis une valeur de
  confiance) est inchange.
- **Chaque evaluation de politique coute une sonde d'index sur `member`.** Negligeable a la charge
  du PRD ; voir le signal de reexamen.
- **Limite du modele de menace** : une execution de SQL arbitraire sous `signet_app` peut forger
  `app.user_id`. La barriere couvre l'oubli applicatif, pas la compromission du role.

## Signal de reexamen

- Un plan d'execution montre `signet.current_org()` evaluee par ligne sur une table volumineuse
  (`link`, tranche 005/009), ou le temps passe dans les sondes `member` devient mesurable : passer
  les politiques concernees a `(SELECT signet.current_org())`.
- Une fonctionnalite exige qu'un utilisateur agisse sur une organisation dont il n'est pas membre
  (support, administration, transfert de propriete) : elle passe par une fonction `SECURITY DEFINER`
  dediee et revue, jamais par un assouplissement de `current_org()`.
- Les migrations sont jouees un jour par un role non superutilisateur (hebergement gere) : 0010
  (`ALTER ROLE ... NOBYPASSRLS`) et la propriete des fonctions sont a revoir avec ADR-0007.
- La tranche 008 (retrait de membre) exige une revocation effective pour une instruction deja en
  cours.
