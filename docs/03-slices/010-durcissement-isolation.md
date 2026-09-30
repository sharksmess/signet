# 010 — Durcissement de l'isolation tenant (tranche technique)

## Capacite
Tranche technique transverse (US-09), sans capacite utilisateur nouvelle. En tant qu'exploitant de Signet, je veux que la RLS soit une seconde barriere reelle : une ligne d'une organisation n'est visible ou modifiable sous `signet_app` que si **l'utilisateur de session** (`app.user_id`, pose par le serveur depuis la session authentifiee, jamais depuis la requete) est **membre** de l'organisation du contexte (`app.organization_id`). Ainsi une route future qui oublierait le controle d'appartenance applicatif n'obtiendrait aucun acces inter-tenant.

Origine : audit-001 MINEUR-1, tranche par l'humain en option A (D-022) ; audit-001 MINEUR-10 inclus (D-024). Cadrage : `docs/03-slices/000-backlog.md` § Tranche 010.

## Perimetre
- **Touche** :
  - politiques RLS de `signet_app` sur les tables a `organization_id` (`organization`, `member`, `organization_link_usage`, `subscription`) et sur `app_user` (politique `app_user_visible_to_co_members`, scopee aujourd'hui par `current_org()` seul) ;
  - fonctions de contexte du schema `signet` et fonctions `SECURITY DEFINER` existantes, seulement la ou elles dependent de l'utilisateur de session (AC4) ;
  - attributs des quatre roles `signet_*` (MINEUR-10) ;
  - `withTenant` (`apps/web/src/lib/db.ts`) seulement si la conception l'exige ;
  - ADR-0011 (conception, par `db-architect`), amendement du point 4 d'ADR-0004, ERD.
- **NE touche PAS** :
  - aucune capacite utilisateur nouvelle, aucune route nouvelle, aucune forme de requete ou de reponse modifiee : `docs/02-architecture/api-contracts/organizations.ts` reste identique, `contract-guardian` doit rendre PASS ;
  - Stripe, abonnement, `billing_event` (tranche 002) ; invitations (003, 006) ; collections et liens (004, 005, 007, 009) ; retrait de membre (008) ;
  - les tables d'authentification (`session`, `account`, `verification`) et le role `signet_auth` au-dela de ses attributs ;
  - le limiteur de debit better-auth et MINEUR-11 (avant tout choix d'hebergement, backlog § Notes) ;
  - les migrations 0001 a 0008, deja dans `main`, donc immuables : tout changement passe par une migration nouvelle ;
  - les assertions des tests de la tranche 001 (`tests/organizations/**`) : AC1 exige qu'elles restent vertes **sans modification** ;
  - le test de catalogue de l'usine (`tests/_factory/**`) : il appartient a l'usine, pas a la tranche.

## Perimetre de fichiers
Declare dans `.gates/scope-010.txt` (source de verite pour le hook `gate-check.sh` ; copie ci-dessous pour qu'il survive aux sessions). Fige apres la conception de `db-architect`.

```
packages/db/migrations/0009_rls_session_user_membership.sql
packages/db/migrations/0010_reimpose_role_attributes.sql
apps/web/src/lib/db.ts
tests/isolation-hardening/*
tests/helpers/db.ts
```

`apps/web/src/lib/db.ts` : commentaires seulement (ADR-0011 § i, `withTenant` inchange). `tests/helpers/db.ts` : ajout eventuel d'un helper, sans changer le comportement des helpers existants (AC1). `pnpm db:generate` ne doit produire **aucune** difference (ADR-0011 § j) : un fichier genere dans `packages/db/migrations/meta/` ou `packages/db/src/schema/` serait hors perimetre, donc un signal d'arret.

## Dependances
- Tranches devant etre closes avant celle-ci : 001 (close, PR #1 fusionnee).
- Executee avant 002 (D-024) : toutes les tranches suivantes copient le patron `withTenant` et les politiques RLS.

## Contrat de donnees
Aucune table, colonne ni index nouveau (ADR-0011 § c, § j : `member_org_user_idx (organization_id, user_id)` suffit). Detail dans ADR-0011 et l'ERD (§0, §1, matrice d'isolation, ordre des migrations) :

| Objet | Changement (migration) | Contraintes |
|---|---|---|
| `signet.context_org()` (nouvelle) | valeur brute de `app.organization_id` (0009) | `sql STABLE`, proprietaire `signet_definer`, aucun `EXECUTE` hors `signet_definer` |
| `signet.current_org()` (remplacee) | ne renvoie l'organisation du contexte que si `current_user_id()` en est membre, sinon `NULL` (0009) | `SECURITY DEFINER STABLE`, proprietaire `signet_definer` (explicite : `CREATE OR REPLACE` garde le proprietaire superutilisateur de 0001), `search_path = pg_catalog, signet, public, pg_temp`, tables qualifiees, `EXECUTE` a `signet_app` seul |
| politiques `signet_app` (`organization_isolation`, `member_isolation`, `organization_link_usage_read_only`, `subscription_owner_only`, `app_user_visible_to_co_members`) | texte inchange ; heritent de la verification via `current_org()` ; `organization_isolation`/`member_isolation` restreintes a `signet_app` (0009) | aucune recursion sur `member` |
| politiques `signet_definer` | `organization_definer_context`, `member_definer_context` (nouvelles), `organization_link_usage_definer_write`, `subscription_definer_insert` sur `context_org()` (0009) | invariant teste : aucune politique `signet_definer` n'appelle `current_org(` ; aucune politique `signet_app` n'appelle `context_org(` |
| `signet.organizations_for_user`, `signet.create_organization` | levent `SG002` si `app.user_id` absent ou different du parametre (0009) | `pg_temp` en fin de `search_path`, tables qualifiees |
| `create_organization_counters`, `propagate_subscription_quota`, `assert_owner_remains` | `search_path` complete par `pg_temp` (0009), corps inchange | — |
| roles `signet_owner`, `signet_app`, `signet_auth`, `signet_definer` | leve si l'un est membre d'un autre role ; `ALTER ROLE ... NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, `LOGIN` / `NOLOGIN` (`signet_definer`) (0010, idempotente) | test de catalogue de l'usine + test de tranche |

## Contrat d'API
Aucun changement. Routes existantes, formes inchangees :

| Route | Methode | Entree | Sorties | Role minimal | Idempotent sur |
|---|---|---|---|---|---|
| `/api/organizations` | POST | `{ name }` | inchangees | `public` (authentifie) | inchange |
| `/api/organizations/:organizationId` | PATCH | `{ organizationId, name }` | inchangees | `owner` | inchange |

## Criteres d'acceptation
- [x] AC1 — Non-regression : un membre accede a son organisation exactement comme avant ; toute la suite de la tranche 001 (`tests/organizations/**`) reste verte **sans modifier ses assertions**.
- [x] AC2 — Contexte force (isolation en base) : sous `signet_app`, avec `app.organization_id` = organisation B et `app.user_id` = un membre de A seulement, toute lecture de `organization`, `member`, `organization_link_usage`, `subscription` et de `app_user` (via la co-appartenance a B) renvoie 0 ligne, et toute ecriture (`UPDATE organization`, `INSERT`/`UPDATE`/`DELETE` la ou un privilege existe) touche 0 ligne ou est refusee. Teste directement en base, **sans** passer par le controle d'appartenance applicatif. Cas couverts : owner de A, member (non owner) de A.
- [x] AC3 — Echec ferme : (a) sans `app.user_id`, (b) avec un `app.user_id` inconnu (UUID sans ligne `app_user`), (c) avec un `app.user_id` qui n'est pas un UUID ou est vide — aucune ligne visible et aucune ecriture, meme avec un `app.organization_id` valide ; un contexte malforme peut lever une erreur, jamais rendre une ligne.
- [x] AC4 — Fonctions a privileges : les fonctions `SECURITY DEFINER` gardent leurs garanties (tests d'invariants de 001 verts : creation par `signet.create_organization()` seul chemin, dernier owner protege, propagation du palier sans contexte ambiant) et **echouent bruyamment** (exception, jamais 0 ligne silencieuse) la ou elles dependent d'un utilisateur de session absent : `signet.organizations_for_user(p)` sans `app.user_id` pose, ou avec `p` different, leve `SG002` (aujourd'hui `p <> NULL` vaut NULL et la garde ne leve pas) ; `signet.create_organization(owner, name)` sans `app.user_id`, ou avec `owner` different d'`app.user_id`, leve `SG002` et ne cree aucune organisation (verifie en boite blanche). Catalogue : toute fonction `SECURITY DEFINER` du schema `signet` a pour proprietaire `signet_definer` ; invariants de politiques `current_org(`/`context_org(` (ADR-0011 § Tests exiges).
- [x] AC5 — **Isolation tenant** par l'API : `PATCH /api/organizations/:idB` par un membre de A seulement (owner de A) donne la meme reponse qu'une organisation inexistante (`404 ORGANIZATION_NOT_FOUND`, meme corps) et rien ne change en base (nom de B verifie par lecture de controle). Un utilisateur du tenant B ne peut ni lire ni modifier les donnees du tenant A via cette capacite.
- [x] AC6 — Roles : les attributs des quatre roles sont reimposes par la migration 0010, y compris sur un cluster ou un role preexistait avec des attributs errones (teste sous la connexion d'administration, dans une transaction toujours annulee : un role altere puis le contenu de 0010 execute le corrige ; un role privilegie accorde a `signet_app` fait lever 0010) ; le test de catalogue de l'usine (`tests/_factory/db-catalog.test.ts`) est vert en local et en CI.

### Cas limites
- **Concurrence** : dans une meme transaction, un changement d'appartenance (retrait, tranche 008) doit etre pris en compte par les requetes suivantes de la transaction (pas de cache d'appartenance au-dela de l'instruction). A trancher et justifier dans ADR-0011 si la fonction de contexte est `STABLE`.
- **Valeur absente** : `app.user_id` absent ou vide, `app.organization_id` absent (AC3, et fermeture par defaut ERD §1 deja testee).
- **Permission insuffisante** : un member (non owner) de B, contexte B, garde sa visibilite d'avant sur `organization`/`member`/`organization_link_usage` et ne voit toujours pas `subscription` (US-08.2).
- **Recursion** : une politique de `member` qui interroge `member` ne doit ni boucler ni lever `infinite recursion detected in policy`.
- **Doublon, expiration** : sans objet (aucune ressource creee ni a duree de vie limitee).

## Anti-regression
- Toute la suite de 001 (`tests/organizations/**`) verte sans modification d'assertion (AC1).
- `FORCE ROW LEVEL SECURITY` reste actif sur toutes les tables applicatives (test de catalogue).
- `signet.create_organization()` reste l'unique chemin de creation ; `member_keep_last_owner` et `propagate_subscription_quota` gardent leur comportement (invariants de 001).
- Toute fonction `SECURITY DEFINER` nouvelle ou remplacee : `search_path` fige, non executable par `PUBLIC` (test de catalogue).
- Contrat `docs/02-architecture/api-contracts/organizations.ts` inchange (`contract-guardian`).

## Notes d'implementation
- **Conception arretee : ADR-0011** (`db-architect`, acceptee D-027). Elle fait foi ; ce contrat en reprend les points testables. En cas d'ecart entre l'ADR et ce qui est realisable, s'arreter et le signaler, ne pas improviser.
- Cas limite concurrence : `current_org()` est `STABLE` ; un retrait de membre est pris en compte a l'instruction suivante de la meme transaction (ADR-0011 § c).
- Les politiques de `signet_definer` : les fonctions `SECURITY DEFINER` posent elles-memes un contexte d'organisation derive d'une valeur de confiance (id genere, `OLD`/`NEW` d'un trigger), parfois sans utilisateur de session (webhook Stripe, tranche 002 ; test d'invariant sous `BYPASSRLS`). Exiger l'appartenance de l'utilisateur de session dans leurs politiques casserait `create_organization` (le membership owner n'existe pas encore au moment de l'`INSERT INTO organization`) et `propagate_subscription_quota` sans contexte. Le traitement de `signet_definer` doit etre explicite dans ADR-0011.
- `signet.organizations_for_user` : la garde `p_user_id IS NULL OR p_user_id <> signet.current_user_id()` ne leve pas quand `current_user_id()` est NULL (comparaison a NULL). AC4 exige une exception.
- Migrations 0001 a 0008 immuables ; `migrate.ts` ne rejoue jamais un fichier deja applique.
- Une migration ajoutee impose la mise a jour de `docs/02-architecture/ERD.md` dans la meme tranche (`close-slice.sh`).
