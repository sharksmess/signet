## Audit de securite — tranche 001 (Signet), diff `master...HEAD`

Perimetre audite : 40 fichiers / 5960 insertions (migrations 0001-0004, `apps/web/src/**`, `packages/db/src/**`, helpers de test, manifestes). Documents de reference lus : slice 001, ERD (§1, §3, §4, §7, §8.1), ADR-0001/0002/0004/0007, contrat `api-contracts/organizations.ts`.

---

## 1. Verification prioritaire — fonctions `SECURITY DEFINER`, une par une

Rappel du mecanisme : `signet_definer` est `NOLOGIN` **et** `NOBYPASSRLS` (`0001:51`). Toute fonction `SECURITY DEFINER` qu'il possede est donc soumise aux politiques RLS de `organization`/`member`/`organization_link_usage`/`subscription`, qui exigent toutes `= signet.current_org()` (ou `= signet.current_user_id()` pour les deux politiques `*_definer_self_read`). Sans contexte pose, une **lecture** ne voit rien et une **ecriture** n'affecte aucune ligne — sans erreur.

| Fonction | Contexte pose en 1re instruction ? | Bon contexte ? | Verdict |
|---|---|---|---|
| `signet.assert_owner_remains()` (0004:23-54) | Oui — `PERFORM set_config('app.organization_id', OLD.organization_id::text, true)` en `0004:36`, avant les deux `SELECT` (`0004:38`, `0004:43`) | Oui — l'organisation de la ligne supprimee, independante du contexte de l'appelant | **Correctif complet et suffisant.** Les deux lectures sont couvertes (`organization_isolation`, `member_isolation`), le cas « cascade de suppression d'organisation » reste correct (l'organisation n'existe plus → `RETURN NULL`), et le test anti-regression declenche sous role `BYPASSRLS` sans contexte reste couvert. `ALTER FUNCTION ... OWNER TO signet_definer` est bien re-pose (`0004:56`) apres le `CREATE OR REPLACE`. Rien a redire. |
| `signet.create_organization(uuid, text)` (0003:235-307) | Oui — `PERFORM set_config('app.organization_id', v_org_id::text, true)` en `0003:259`, avant le premier `INSERT` (`0003:291`) | Oui — `v_org_id` est genere par la fonction elle-meme (`0003:242`) et re-utilise explicitement comme `id` de la ligne inseree | **Conforme.** Verifie aussi : le `set_config` est place **hors** du bloc `BEGIN/EXCEPTION` de la boucle de retry (`0003:290-299`), donc un rollback de sous-transaction sur `unique_violation` ne le revoque pas. Le `INSERT INTO member` (`0003:302`) passe le `WITH CHECK` de `member_isolation`. La fonction n'a besoin d'aucun `app.user_id`. |
| `signet.organizations_for_user(uuid)` (0003:314-331) | N/A — cas multi-organisations | Oui | **Conforme au patron n°2 d'ADR-0007 Partie 2.** Elle ne pose pas `current_org()` (elle ne le peut pas), elle leve si `p_user_id <> signet.current_user_id()` **avant** tout `SELECT` (`0003:321-323`), et s'appuie sur les deux politiques additionnelles scopees par `current_user_id()` : `member_definer_self_read` (`0003:165-167`) et `organization_definer_self_read` (`0003:169-177`). Le `WHERE m.user_id = p_user_id` borne le resultat meme si un `current_org()` residuel elargissait la visibilite de `member` via `member_isolation` (politiques permissives = OR). Pas de fuite. |
| `signet.create_organization_counters()` (0003:339-353) | Non — aucun `set_config` | Herite de celui de `create_organization` | **Acceptable en l'etat** (ADR-0007 Partie 2, ligne 106 : le trigger `AFTER INSERT ON organization` ne s'execute que dans la transaction ouverte par `create_organization`). J'ai verifie qu'aucun autre chemin d'`INSERT INTO organization` n'existe aujourd'hui. Reserve : voir constat MINEUR-3 (`GRANT INSERT ... TO signet_app`) et constat MAJEUR-2 (valeur `link_quota = NULL` inseree en `0003:346`). |
| `signet.propagate_subscription_quota()` (0003:362-374) | Non — aucun `set_config` | Non couvert sur la branche `UPDATE` | **Defaut confirme — voir constat MAJEUR-2.** La justification d'ADR-0007 (« ces triggers s'executent toujours a l'interieur de la transaction ouverte par `create_organization` ») est vraie pour la branche `INSERT`, et **fausse par construction pour la branche `UPDATE OF tier`** que le trigger declare pourtant (`0003:432-434`) : un changement de palier n'a jamais lieu pendant la creation. C'est le meme mode de defaillance silencieuse que celui corrige en 0004. |
| `signet.quota_for_tier(text)` (0003:206-208) | N/A | N/A | **Correct, aucun traitement requis — confirme.** `LANGUAGE sql IMMUTABLE`, pas `SECURITY DEFINER`, aucun acces table : elle s'execute avec les privileges de l'appelant et ne peut donc rien contourner. L'absence de `SET search_path` n'est pas un defaut ici : le vecteur de detournement du `search_path` suppose une elevation de privilege (`SECURITY DEFINER`) qui n'existe pas, et le corps ne reference ni table ni fonction non qualifiee. Ne pas la signaler serait une erreur de revue ; la signaler en serait une aussi. (Note factuelle, pas un constat : le `CASE` sans `ELSE` renvoie `NULL` = illimite pour tout palier inconnu — borne par `subscription_tier_chk`, donc inatteignable.) |

**Conclusion du point prioritaire** : le correctif 0004 est complet et suffisant. Une autre fonction porte un defaut de la meme famille : `propagate_subscription_quota` (MAJEUR-2). Les trois autres sont conformes.

---

## 2. Constats

### MAJEUR-1 — `EXECUTE` sur les deux points d'entree `SECURITY DEFINER` reste acquis a `PUBLIC`
**Emplacement** : `packages/db/migrations/0003_organizations_and_policies.sql:415-422` (aucun `REVOKE EXECUTE ... FROM PUBLIC`), a lire avec `packages/db/migrations/0001_roles_schema_context.sql:61-62`.

Postgres accorde `EXECUTE` a `PUBLIC` par defaut sur toute fonction creee. La migration revoque bien `ALL ON SCHEMA signet FROM PUBLIC` (`0001:61`) mais re-accorde `USAGE` a `signet_app, signet_auth, signet_owner` (`0001:62`) — et ne revoque jamais l'`EXECUTE` implicite au niveau des fonctions. `GRANT EXECUTE ... TO signet_app` (`0003:421-422`) n'est donc pas restrictif : il est redondant.

**Scenario d'exploitation** : un attaquant obtient l'execution de SQL arbitraire sous la connexion `DATABASE_URL_AUTH` (role `signet_auth`) — fuite du secret d'environnement, injection dans la surface `/api/auth/*`, ou compromission d'une dependance de better-auth. Ce role est cense etre « limite aux quatre tables d'authentification » et « ne doit jamais pouvoir lire/ecrire les tables tenant » (`0001:36-39`, ERD §2). Il execute :
1. `SET app.user_id = '<uuid d une victime quelconque>';`
2. `SELECT * FROM signet.organizations_for_user('<meme uuid>');` — la garde `p_user_id = current_user_id()` est satisfaite (le GUC `app.*` est librement positionnable par n'importe quel role), la fonction tourne en `SECURITY DEFINER` sous `signet_definer` et retourne les lignes `organization` de n'importe quel utilisateur : **lecture inter-tenant complete, table par table utilisateur**.
3. `SELECT signet.create_organization('<uuid victime>', 'x');` — ecriture dans `organization`, `member`, `organization_link_usage`, `subscription` depuis un role qui ne possede aucun `GRANT` sur ces tables.

Le meme raisonnement vaut pour `signet_owner` (`USAGE` accorde en `0001:62`, credentials presentes dans `TEST_DATABASE_URL_TABLE_OWNER`), role qui par ailleurs n'a acces a aucune table (FORCE RLS + aucune politique) — il retrouve ici une capacite d'ecriture tenant.

Ce n'est pas exploitable sans point d'appui SQL prealable, d'ou MAJEUR et non CRITIQUE ; mais la separation des roles est precisement la barriere censee limiter les degats d'un tel point d'appui, et ADR-0002 (durcissement, point 2) comme ERD §1 exigent explicitement « jamais de GRANT large en public ».

**Remediation** : revoquer explicitement l'`EXECUTE` implicite de `PUBLIC` sur chaque fonction du schema `signet` dans une nouvelle migration, puis ne re-accorder qu'aux roles reellement appelants (`signet_app` pour les deux points d'entree, `signet_definer` pour `quota_for_tier`, `signet_auth`/`signet_owner` pour `uuidv7()` seulement si un `DEFAULT` de colonne l'exige). Envisager `ALTER DEFAULT PRIVILEGES` pour que les migrations futures heritent du comportement. Ajouter au test d'ADR-0002 une assertion sur `pg_proc.proacl` au meme titre que celles deja prevues sur `proconfig`/`proowner`.

### MAJEUR-2 — `propagate_subscription_quota()` : pas de contexte tenant, pas de controle de lignes affectees, sur une branche de trigger qui s'execute hors transaction de creation
**Emplacement** : `packages/db/migrations/0003_organizations_and_policies.sql:362-374` (fonction), `:432-434` (trigger `AFTER INSERT OR UPDATE OF tier`), a lire avec `:346` (`link_quota` initialise a `NULL`) et `:108-111` (politique `organization_link_usage_definer_write`, `USING organization_id = signet.current_org()`).

La fonction fait un `UPDATE organization_link_usage ... WHERE organization_id = NEW.organization_id` puis `RETURN NULL`, sans jamais poser `app.organization_id` ni verifier `ROW_COUNT`. Sous `signet_definer` (sans `BYPASSRLS`), si `current_org()` vaut `NULL` ou une autre organisation, l'`UPDATE` porte sur **zero ligne** et la fonction retourne en succes.

**Scenario d'exploitation** (deux variantes, toutes deux silencieuses) :
1. *Aujourd'hui* — un operateur corrige un palier a la main depuis la connexion de migration (seul role capable d'ecrire `subscription` aujourd'hui : `signet_app` est revoque `0003:194`, `signet_definer` n'a que `SELECT, INSERT` `0003:199`, `signet_owner` n'a aucune politique) : `UPDATE subscription SET tier='pro', stripe_subscription_id='sub_x' WHERE organization_id='<A>';`. Le trigger s'execute sous `signet_definer`, `app.organization_id` n'est pas pose dans cette session psql, l'`UPDATE` du quota n'affecte aucune ligne, aucune erreur n'est levee. L'organisation est Pro et reste plafonnee a 50 liens. Dans l'autre sens (retrogradation Pro → Free), `link_quota` reste `NULL` = **illimite sur un palier Free** : le risque #3 du PRD est desactive en silence pour ce tenant, sans trace.
2. *Des la tranche 002* — le webhook Stripe ecrit `subscription.tier` depuis une connexion qui n'a, par nature, aucun contexte tenant (pas d'utilisateur, pas d'organisation active : c'est exactement ce que dit ERD §8.1, « le webhook Stripe, lui, n'a pas d'utilisateur »). Chaque changement de palier laisse alors `link_quota` fige. Le defaut devient declenchable a distance par tout evenement Stripe.

Aggravant : `create_organization_counters` insere volontairement `link_quota = NULL` (`0003:346`) — c'est-a-dire **illimite** — et delegue le durcissement a 50 au trigger de propagation. Le defaut par defaut est donc ouvert, pas ferme, a l'inverse du principe de fermeture par defaut d'ERD §1. Aggravant 2 : ERD §7 impose pour le trigger frere sur `link` de « lever si `ROW_COUNT <> 1` » (« une organisation sans compteur est un bug, pas un cas a absorber silencieusement ») ; ce controle n'est pas applique ici.

**Remediation** : dans une nouvelle migration, poser `set_config('app.organization_id', NEW.organization_id::text, true)` comme premiere instruction de `propagate_subscription_quota()` (patron n°1 d'ADR-0007), et faire lever la fonction si l'`UPDATE` n'a touche aucune ligne. Faire porter au `INSERT` de `create_organization_counters` la valeur `signet.quota_for_tier('free')` plutot que `NULL`, pour que l'etat sur — et non l'etat ouvert — soit celui qui survit a une propagation defaillante. Rouvrir la ligne correspondante du tableau d'ADR-0007 Partie 2, dont la justification ne couvre que la branche `INSERT`. Etendre a cette fonction le « test d'isolation croisee » deja exige par ADR-0002 pour chaque fonction `SECURITY DEFINER` (appel avec un contexte de session lie a B, ou sans contexte).

### MINEUR-1 — La RLS n'est pas une defense de dernier recours pour les routes a `organizationId` dans le chemin
**Emplacement** : `apps/web/src/lib/db.ts:65-88` (`withTenant`), `apps/web/src/lib/organizations.ts:63-69`, `apps/web/src/app/api/organizations/[organizationId]/route.ts:17-36`.

Le contexte tenant est pose a partir de l'`organizationId` de l'URL, c'est-a-dire d'une valeur entierement choisie par l'appelant, **avant** toute verification d'appartenance. Les predicats RLS `organization_id = signet.current_org()` deviennent alors tautologiques : ils valident l'organisation que l'attaquant a demandee. La seule chose qui empeche l'acces inter-tenant est le `SELECT role FROM member WHERE organization_id = $1 AND user_id = $2` de `organizations.ts:66-69`.

**Scenario** : dans l'implementation actuelle il n'y en a pas — la verification d'appartenance est bien la premiere instruction de la transaction, l'ordre 401 → 404 → 403 d'ADR-0004 est respecte, et AC5 passe. Le constat porte sur la propriete revendiquee par ADR-0004 point 4 (« le filtre `organization_id` explicite et la politique RLS restent la defense de dernier recours si une des etapes precedentes est contournee par une erreur de code ») : cette propriete **ne tient pas** avec un contexte derive du chemin. Une route future qui lirait `member`, `organization` ou `organization_link_usage` avant (ou sans) le controle d'appartenance obtiendrait un acces inter-tenant complet, sans qu'aucune politique ne s'y oppose — et cette tranche est le gabarit que toutes les suivantes copieront.

**Remediation** : soit poser `app.organization_id` seulement apres la verification d'appartenance (le controle redevient anterieur au contexte, la RLS redevient un filet), soit deriver le contexte de `session.active_organization_id` (ERD §2.2 : « c'est cette colonne qui alimente le `SET LOCAL app.organization_id` »), soit — si l'on conserve le patron d'ADR-0004 Option B — corriger le point 4 d'ADR-0004 pour ne plus presenter la RLS comme une defense independante sur ces routes, et rendre le controle d'appartenance obligatoire et teste pour chaque route. Decision d'architecture : a trancher par un humain, pas a corriger silencieusement.

### MINEUR-2 — `GRANT INSERT ON organization TO signet_app` inutile
**Emplacement** : `packages/db/migrations/0003_organizations_and_policies.sql:185`.

`signet.create_organization` est `SECURITY DEFINER` : son `INSERT` s'execute sous `signet_definer`, qui possede son propre `GRANT` (`0003:196`). `signet_app` n'a donc aucun besoin d'`INSERT` sur `organization`. Ce privilege ouvre, au niveau SQL, un chemin de creation d'organisation parallele a celui que l'anti-regression de la tranche declare unique (« `signet.create_organization()` reste l'unique chemin de creation d'organisation »). Aucun exploit concret aujourd'hui (le `WITH CHECK id = current_org()` exige que l'appelant insere une ligne dont l'`id` est deja le contexte courant, ce qui entre en collision avec la PK existante dans tous les chemins actuels), d'ou MINEUR.

**Remediation** : revoquer `INSERT ON organization FROM signet_app` dans une nouvelle migration ; conserver `SELECT, UPDATE` (renommage).

### MINEUR-3 — `create_organization` reecrit silencieusement le contexte tenant de la transaction appelante
**Emplacement** : `packages/db/migrations/0003_organizations_and_policies.sql:259`.

`set_config(..., is_local => true)` ecrase `app.organization_id` pour **toute la suite de la transaction**, pas seulement pour la duree de la fonction. Aucun appelant actuel n'en souffre (`withUserOnly` ne pose pas d'organisation, `organizations.ts:30-38` ne fait rien d'autre dans la transaction). Mais un appel futur de `create_organization` depuis une transaction `withTenant({organizationId: A})` ferait basculer toutes les requetes suivantes de cette transaction sur la nouvelle organisation, sans erreur. Meme remarque, plus benigne, pour `assert_owner_remains` (`0004:36`), qui s'execute au COMMIT.

**Remediation** : documenter la post-condition dans le commentaire de la fonction, ou restaurer l'ancienne valeur avant le `RETURN`. A defaut, interdire par convention l'appel de `create_organization` depuis une transaction deja contextualisee.

### MINEUR-4 — Le message d'erreur Zod est renvoye tel quel au client
**Emplacement** : `apps/web/src/app/api/organizations/route.ts:16-18`, `apps/web/src/app/api/organizations/[organizationId]/route.ts:27-29` (`validationFailed(parsed.error.message)`).

`parsed.error.message` est le JSON serialise des `issues` Zod : chemins de champs, contraintes internes, et selon le cas la valeur recue. Ce n'est ni un secret ni une donnee d'un autre tenant, mais c'est un detail d'implementation renvoye en clair et non maitrise (il changera de forme avec la version de Zod). Aucune route n'a par ailleurs de `try/catch` : une exception inattendue (`organizations.ts:41`, ou le `RAISE` apres 50 collisions de slug en `0003:296-297`) remonte au gestionnaire d'erreur de Next — masque en production, verbeux en developpement.

**Remediation** : renvoyer un message stable et une liste de champs invalides derivee des `issues`, plutot que `error.message` brut. Ajouter une frontiere d'erreur explicite sur les deux routes qui traduit tout echec non typé en 500 generique sans corps de diagnostic.

### MINEUR-5 — Aucune limitation de debit sur `POST /api/organizations`
**Emplacement** : `apps/web/src/app/api/organizations/route.ts` (aucun garde), `apps/web/src/lib/auth.ts:30-43` (aucune configuration `rateLimit`).

Le contrat declare la route non-idempotente : chaque appel reussi cree une organisation + un membership + un compteur + un abonnement, et la boucle de slug peut emettre jusqu'a 50 tentatives d'`INSERT`. Aucun plafond du nombre d'organisations par utilisateur n'existe (ni en base, ni dans le PRD).

**Scenario** : un compte authentifie (l'inscription est ouverte) boucle sur `POST /api/organizations` et cree un nombre arbitraire d'organisations — 4 lignes par appel, plus la saturation de l'espace de noms global des slugs, qui est la seule ressource partagee entre tenants du schema (ERD §3). Cout d'entree : un compte.

Sur `/api/auth/*`, better-auth applique son limiteur par defaut, mais seulement lorsque `NODE_ENV=production` (`enabled: options.rateLimit?.enabled ?? isProduction`) et avec un stockage `memory` par processus — donc inefficace derriere plusieurs instances ou en runtime serverless. Aucune route de reinitialisation de mot de passe dans cette tranche.

**Remediation** : configurer explicitement `rateLimit` de better-auth avec un stockage partage, et ajouter une limitation sur `POST /api/organizations`. Le plafond du nombre d'organisations par utilisateur est une **decision produit manquante** (le PRD n'en parle pas) : a remonter, pas a inventer (CLAUDE.md, « si une decision metier manque, arrete-toi et demande »).

### MINEUR-6 — Variables d'environnement non validees par un schema
**Emplacement** : `apps/web/src/lib/db.ts:23-31`, `apps/web/src/lib/auth.ts:22-28`, `packages/db/src/migrate.ts:37-46`.

`requiredEnv` ne verifie que la presence d'une chaine non vide. CLAUDE.md exige que « toute entree externe passe par un schema de validation avant usage : body, query, params, headers, webhooks, **variables d'environnement** », et la regle `nextjs.md` le repete. Consequence concrete : un `BETTER_AUTH_SECRET` de 3 caracteres, ou un `DATABASE_URL_APP` pointant par erreur sur le role de migration (donc superuser, donc `BYPASSRLS`, donc toute l'isolation desactivee), est accepte sans broncher.

**Remediation** : un schema Zod unique pour les variables serveur, valide au demarrage, imposant au minimum une longueur plancher sur le secret et une forme d'URL Postgres. Une assertion de demarrage verifiant que la connexion applicative n'a ni `rolsuper` ni `rolbypassrls` fermerait le mode de defaillance le plus couteux.

---

## 3. Points verifies sans constat

- **Injection** : aucune concatenation SQL. Toutes les requetes applicatives sont parametrees (`organizations.ts:36`, `:67`, `:84`, `db.ts:74`, `:78`). Aucune construction dynamique (`format`/`EXECUTE`) dans les fonctions PL/pgSQL. La derivation du slug passe par `regexp_replace`/`left` sur une valeur deja bornee par Zod puis par `organization_slug_format_chk`.
- **Mass assignment** : la route PATCH fusionne le corps puis **ecrase** `organizationId` par celui du chemin (`[organizationId]/route.ts:22-25`) avant validation, et les schemas Zod `z.object` ne conservent que `name` et `organizationId`. Aucun objet de requete n'atteint la couche SQL.
- **Ordre authn/authz** : conforme a ADR-0004 (401 avant tout, puis 404 sur non-appartenance, puis 403 sur role insuffisant) — `organizations.ts:70-81`. Le 404 est bien indistinguable entre « inexistante » et « appartient a autrui » (US-09.2).
- **Secrets** : aucune valeur en dur. Les migrations ne fixent volontairement aucun mot de passe (`0001:9-16`). Aucun `console.log` de secret (les deux occurrences de `migrate.ts:79`/`:100` ne loguent que des noms de fichiers). `.env` et `.env.local` sont ignores par git. Le seul litteral de type connexion est le `postgresql://placeholder:placeholder@...` de `packages/db/drizzle.config.ts`, qui n'est pas un secret.
- **CSRF** : better-auth 1.7.5 pose `sameSite: "lax"` par defaut sur le cookie de session (verifie dans `dist/cookies/index.mjs:35`), et la validation d'origine sur `/api/auth/*` est active (les helpers de test ont ete corriges pour envoyer `Origin` plutot que pour la desactiver cote serveur — bon reflexe). Les deux routes mutantes ne sont donc pas atteignables par un formulaire cross-site.
- **Webhooks** : aucun dans cette tranche (hors perimetre, tranche 002). Rien a auditer. Note pour la tranche 002 : l'index unique partiel `billing_event_stripe_idx` porteur de l'idempotence n'existe pas encore, et le constat MAJEUR-2 ci-dessus concerne directement le chemin webhook.
- **`FORCE ROW LEVEL SECURITY`** present sur les huit tables (`0002:81-88`, `0003:68-75`), propriete transferee a `signet_owner` sur toutes les tables et a `signet_definer` sur toutes les fonctions `SECURITY DEFINER` (`0003:415-419`, `0004:56`) — aucun objet ne reste la propriete du role bootstrap.
- **`search_path` fixe** (`SET search_path = pg_catalog, signet, public`) sur les cinq fonctions `SECURITY DEFINER`, sans exception.
- **Dependances** : `pnpm audit` → **0 vulnerabilite** (info 0, low 0, moderate 0, high 0, critical 0 ; 227 dependances totales). Aucune dependance non declaree par ADR-0008 reperee dans les manifestes.
- **Conventions CLAUDE.md** : aucun `any`, aucune suppression de verification de type, aucun `// TODO` dans le diff.

---

## 4. Synthese

| Gravite | Nombre |
|---|---|
| CRITIQUE | 0 |
| MAJEUR | 2 (`EXECUTE` a `PUBLIC` sur les points d'entree `SECURITY DEFINER` ; `propagate_subscription_quota` sans contexte tenant ni controle de lignes affectees) |
| MINEUR | 6 |

Le correctif de la migration 0004 est valide : complet, correctement place, et suffisant. La recherche systematique demandee a mis au jour une seule autre fonction affectee par la meme famille de defaut, `signet.propagate_subscription_quota()`, dont la branche `UPDATE OF tier` echappe a la justification d'ADR-0007 — c'est le constat le plus proche du bug d'origine et celui que je recommande de traiter en premier, avec la reouverture de la ligne correspondante du tableau d'ADR-0007 Partie 2.

AUDIT: FAIL

---
---

# Re-audit de securite — tranche 001 (Signet), 2e passe

## 0. Avertissement de perimetre (a lire en premier)

`git diff master...HEAD` et `git diff --stat master...HEAD` retournent **exactement le meme resultat qu'au premier audit** : 40 fichiers, 5960 insertions, migrations 0001-0004 seulement. Les correctifs ne sont pas dans ce diff. Ils sont **non committes** :

```
 M tests/organizations/invariants.test.ts
?? packages/db/migrations/0005_execute_grants_and_quota_context.sql
?? docs/04-runbooks/audits/
```

J'ai donc audite l'arbre de travail. Consequence operationnelle a remonter : tant que ces fichiers ne sont pas committes, `scripts/close-slice.sh` et tout auditeur qui se fierait au seul `master...HEAD` verraient une tranche non corrigee.

**Environnement** : ni Postgres, ni `psql`, ni `docker` disponibles ici (`which psql` / `which docker` → absents, aucune variable `TEST_DATABASE_URL_*` dans la session, `.env` bloque en lecture par un hook). **Je n'ai execute aucun test.** Tout ce qui suit est une analyse par lecture. Je le signale explicitement la ou c'est determinant, et j'indique sur quels points d'appui internes au depot je m'adosse plutot que de deviner.

---

## 1. MAJEUR-1 (`EXECUTE` a `PUBLIC`) — **correctif valide, complet**

`packages/db/migrations/0005_execute_grants_and_quota_context.sql:96-106`.

Inventaire exhaustif des fonctions du schema `signet` (il y en a neuf, aucune autre migration n'en cree) et couverture par le correctif :

| Fonction | Definie | Proprietaire | Re-grant en 0005 | Appelants reels | Verdict |
|---|---|---|---|---|---|
| `uuidv7()` | 0001:73 | role bootstrap | `signet_owner, signet_app, signet_auth, signet_definer` (:101) | DEFAULT de PK sur les 8 tables | OK |
| `current_org()` | 0001:103 | role bootstrap | `signet_app, signet_definer` (:102) | expressions RLS | OK |
| `current_user_id()` | 0001:107 | role bootstrap | `signet_app, signet_definer` (:103) | expressions RLS | OK |
| `quota_for_tier(text)` | 0003:206 | role bootstrap | `signet_definer` (:104) | les deux triggers definer | OK |
| `create_organization(uuid,text)` | 0003:235 | `signet_definer` | `signet_app` (:105) | `organizations.ts:36` (pool `signet_app`) | OK |
| `organizations_for_user(uuid)` | 0003:314 | `signet_definer` | `signet_app` (:106) | `creation.test.ts:151` via `asTenant` (pool `signet_app`) | OK |
| `create_organization_counters()` | 0003:339 | `signet_definer` | aucun (volontaire) | trigger seulement | OK |
| `propagate_subscription_quota()` | 0003:362 | `signet_definer` | aucun (volontaire) | trigger seulement | OK |
| `assert_owner_remains()` | 0003:383 | `signet_definer` | aucun (volontaire) | trigger seulement | OK |

Points verifies un par un :

- **Rien oublie.** `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA signet FROM PUBLIC` couvre les neuf ; le bloc de re-grants couvre les six qui en ont besoin.
- **Rien sur-accorde.** Aucun re-grant ne depasse ce qui existait deja en 0001:96/0001:116-117/0003:213/0003:421-422. Le seul grant discutable, `uuidv7()` a `signet_owner`, est **pre-existant** (0001:96), pas introduit ici ; `signet_owner` n'a de toute facon aucune politique RLS sur aucune table, et `uuidv7()` ne touche aucune donnee.
- **Aucun acces legitime perdu.** Les trois fonctions de trigger ne sont volontairement pas re-accordees, et le commentaire :107-111 est **techniquement exact** : PostgreSQL controle `EXECUTE` sur une fonction de trigger au `CREATE TRIGGER`, jamais au declenchement. Le role a l'origine du DML n'a besoin d'aucun `GRANT`.
- **`signet_auth` non casse.** J'ai verifie 0002:92-99 : ses quatre politiques sont `USING (true) WITH CHECK (true)`, elles n'appellent ni `current_org()` ni `current_user_id()`. Le retrait de ces deux fonctions a `PUBLIC` ne lui enleve donc rien. Il conserve `uuidv7()` (:101), indispensable aux DEFAULT de PK de `account`/`app_user`/`session`/`verification`. **Pas de regression sur le chemin d'authentification.**
- **Ordre des instructions correct.** Les deux `CREATE OR REPLACE` precedent le `REVOKE`. `CREATE OR REPLACE FUNCTION` preserve l'ACL existante et ne re-accorde pas `PUBLIC` : l'ordre inverse aurait aussi fonctionne, mais celui-ci est sans ambiguite.
- **`ALTER FUNCTION ... OWNER TO signet_definer`** re-pose apres chaque `CREATE OR REPLACE` (:55, :82) — defensif, coherent avec 0004:56.

**Constat MAJEUR-1 : leve.**

---

## 2. MAJEUR-2 (contexte tenant + `ROW_COUNT`) — **correctif du code valide ; son test d'anti-regression est faux (nouveau constat MAJEUR)**

### 2a. Le correctif SQL lui-meme : correct

`0005:22-53`.

- `PERFORM set_config('app.organization_id', NEW.organization_id::text, true)` est bien la **premiere instruction executable** (:34), avant l'`UPDATE` (:36). Rien ne lit ni n'ecrit avant.
- **Bonne valeur** : `NEW.organization_id` est la PK de `subscription`, donc identique sur la branche `INSERT` et sur la branche `UPDATE OF tier` (elle ne change jamais). C'est bien l'organisation de la ligne traitee, independante du contexte de l'appelant.
- **`GET DIAGNOSTICS v_updated = ROW_COUNT` immediatement apres l'`UPDATE`** (:45), aucune instruction intercalee qui ecraserait `ROW_COUNT`. `IF v_updated <> 1` attrape le 0 comme le >1 (le >1 est impossible, `organization_id` est PK de `organization_link_usage`) — c'est la formulation exigee par ERD §7.
- **Chemins de declenchement passes en revue**, aucune regression :
  - branche `INSERT` (creation) : `create_organization_counters` insere la ligne `organization_link_usage` (:72-73) *avant* d'inserer `subscription` (:75-76), donc l'`UPDATE` du trigger trouve exactement 1 ligne ;
  - branche `UPDATE OF tier` hors transaction de creation : desormais couverte ;
  - `TRUNCATE ... CASCADE` de `resetDatabase` : ne declenche pas de trigger `FOR EACH ROW` ;
  - `DELETE` d'organisation : cascade, pas d'`UPDATE OF tier`.
- **Fermeture par defaut** : `create_organization_counters` insere maintenant `signet.quota_for_tier('free')` = 50 au lieu de `NULL` (:73). `signet_definer` a bien `EXECUTE` sur `quota_for_tier` (0003:213, re-accorde 0005:104) et la contrainte `organization_link_usage_quota_chk` (50 > 0) passe. L'assertion existante `creation.test.ts:52` (`link_quota: 50`) reste vraie.
- Le message du `RAISE EXCEPTION` (:47-48) ne contient qu'un UUID d'organisation que l'appelant vient de manipuler : pas de fuite inter-tenant.

### 2b. CONSTAT MAJEUR-3 (nouveau) — le test d'anti-regression de MAJEUR-2 asserte l'inverse du correctif et ne peut pas passer

**Gravite** : MAJEUR — a corriger avant cloture de tranche.

**Emplacement** : `tests/organizations/invariants.test.ts:71-95` (test « propagate_subscription_quota (SECURITY DEFINER) echoue bruyamment sans contexte tenant »), a lire avec `packages/db/migrations/0005_execute_grants_and_quota_context.sql:34-49` et `tests/helpers/db.ts:154-162` (`asBypassRls` : ni `BEGIN`, ni `set_config`).

**Le probleme.** Le test execute, sous role `BYPASSRLS`, sans poser `app.organization_id` :

```sql
UPDATE subscription SET tier = 'pro', stripe_subscription_id = 'sub_test_no_context' WHERE organization_id = $1
```

et attend `.rejects.toThrow()`, puis `expect(usage?.link_quota).toBe(50)`.

Or c'est exactement le scenario que le correctif **fait desormais reussir**. Deroule :

1. Le trigger `subscription_after_insert_or_tier_update_propagate_quota` se declenche, la fonction s'execute en `SECURITY DEFINER` sous `signet_definer`.
2. `0005:34` pose lui-meme `app.organization_id = NEW.organization_id`. C'est tout l'objet du correctif : la fonction **n'a plus besoin** d'un contexte ambiant.
3. La politique `organization_link_usage_definer_write` (0003:108-111, `USING organization_id = signet.current_org()`) est donc satisfaite, `signet_definer` a `GRANT UPDATE` (0003:198), l'`UPDATE` touche **1 ligne**.
4. `v_updated = 1` → aucune exception. La transaction commit. `link_quota` devient `signet.quota_for_tier('pro')` = **`NULL`** (0003:208).

Les deux assertions echouent donc : pas de `throw`, et `link_quota` vaut `NULL`, pas `50`. Aucune contrainte ne sauve le test par accident — j'ai verifie `subscription_pro_is_backed_chk` (satisfaite, `stripe_subscription_id` fourni), `subscription_free_has_no_period_chk` (non applicable), `organization_link_usage_quota_chk` (`NULL` autorise), et les unicites partielles sur `stripe_subscription_id`.

**Pourquoi j'en suis sur sans base Postgres.** Le seul maillon qui demanderait une verification empirique est « `set_config(..., is_local => true)` prend-il effet a l'interieur d'une transaction implicite mono-instruction ? ». Deux points d'appui internes au depot le tranchent, et ils forment une alternative fermee :

- `tests/organizations/creation.test.ts:52` asserte `link_quota = 50` apres creation. Avant 0005, `create_organization_counters` inserait `NULL` : cette valeur 50 ne peut venir que de l'`UPDATE` de `propagate_subscription_quota`, qui n'a trouve sa ligne que parce que le `set_config` de `create_organization` (0003:259) etait effectif. → le mecanisme fonctionne, et le trigger trouve bien sa ligne quand le contexte est pose.
- `tests/organizations/invariants.test.ts:46-57` (anti-regression de 0004) fait un `DELETE` nu sous `asBypassRls`, **sans `BEGIN`**, et attend un `throw`. Ce `throw` n'advient que si le `set_config` de `assert_owner_remains` (0004:36) est effectif dans cette transaction implicite.

Donc : si `set_config` local fonctionne en transaction implicite, le nouveau test 1 echoue (l'`UPDATE` reussit). Et s'il ne fonctionnait pas, alors le correctif 0004 serait lui-meme inoperant et son propre test serait deja rouge. **Dans les deux branches, le nouveau test 1 n'est pas un test d'anti-regression valide.**

**Scenario d'exploitation** (au sens « ce que ce defaut laisse passer ») : la suite est livree rouge, ou n'a pas ete executee. Dans les deux cas, le correctif MAJEUR-2 — celui qui ferme la porte du webhook Stripe de la tranche 002 — part en production **sans aucune couverture d'anti-regression**. Une tranche future qui retirerait le `set_config` de `0005:34` (par exemple en reinlinant la fonction, ou en la remplacant depuis une migration generee) retablirait la derive silencieuse de `link_quota` que MAJEUR-2 decrivait, sans qu'aucun test ne rougisse. C'est precisement le mode de defaillance qui a produit ce cycle d'audit.

**Remediation** : reformuler le test pour qu'il verifie la propriete reellement apportee par le correctif — sous `BYPASSRLS` et sans contexte ambiant, l'`UPDATE ... SET tier='pro'` **reussit** et `link_quota` prend la valeur de `signet.quota_for_tier('pro')` ; puis, en sens inverse (`'pro'` → `'free'`), reprend 50. C'est ce qui tombe en panne si le `set_config` disparait. Couvrir separement le garde-fou `ROW_COUNT <> 1` par un cas ou la ligne `organization_link_usage` est reellement absente (supprimee sous `BYPASSRLS` avant l'`UPDATE` du palier) : c'est le seul etat qui doit encore lever. Corriger au passage le commentaire `:84-86` et l'intitule du test, qui propagent la meme confusion (« doit echouer sans contexte » alors que la fonction pose desormais son propre contexte).

### 2c. Les deux tests de MAJEUR-1 : **valides**

- `invariants.test.ts:105-115` (`signet_owner`) : `asTableOwner` ouvre bien une connexion `TEST_DATABASE_URL_TABLE_OWNER` = `signet_owner`, role `NOBYPASSRLS` (0001:30) et non proprietaire des fonctions (elles appartiennent a `signet_definer`, 0003:415). Apres le `REVOKE` de 0005, `SELECT signet.create_organization(...)` echoue en `permission denied for function create_organization`. **Et ce test aurait bien echoue avant le correctif** : `PUBLIC` avait `EXECUTE`, la fonction se serait executee, aurait insere l'organisation, puis aurait bute sur `member_user_id_app_user_id_fk` (l'UUID `00000000-0000-7000-8000-000000000001` n'existe pas dans `app_user`) — une erreur de cle etrangere, qui **ne matche pas** `/permission denied/i`. Le test discrimine donc reellement les deux etats. Pas de faux-positif.
- `invariants.test.ts:117-131` (`signet_auth`) : meme raisonnement. `SET ROLE signet_auth` depuis la connexion superuser fait bien retomber les controles de privileges sur `signet_auth` (un superuser qui prend un role non-superuser perd ses privileges). Avant le correctif : meme violation de FK, regex non matchee. Apres : `permission denied`. Valide. Le `try/finally` avec `RESET ROLE` est correct — une erreur de permission n'invalide pas la connexion, le `RESET ROLE` s'execute bien avant le retour au pool (`asBypassRls` ne reinitialise pas l'etat de session au `release()`).

Reserve mineure sur ces deux tests : l'assertion `/permission denied/i` depend du `lc_messages` du serveur. Sur une instance non anglophone, ils passeraient au vert pour la mauvaise raison, ou rougiraient a tort. Une assertion sur `error.code === '42501'` serait insensible a la locale. Non bloquant, mentionne pour la tranche suivante.

---

## 3. Passe complete sur le reste — regressions et etat des MINEUR

Aucun fichier d'`apps/web/**`, `packages/db/src/**`, `packages/db/migrations/0001-0004`, ni aucun autre test n'a bouge (`git status` ci-dessus). Les migrations deja appliquees sont intactes : 0005 ne fait que `CREATE OR REPLACE` + `REVOKE`/`GRANT`, conformement a CLAUDE.md.

Nouveau point de controle passe en revue, sans constat :
- **`REVOKE` et role de migration** : le `REVOKE ... FROM PUBLIC` porte sur des fonctions appartenant pour partie a `signet_definer`, pour partie au role bootstrap. Il est joue par le role de migration, decrit en 0001:3-7 comme superuser de l'instance : il a autorite dans les deux cas.
- **Aucun appel applicatif oublie** : j'ai grepe `signet\.[a-z_]+\(` sur tout le `.ts` du depot. Les seuls appels runtime sont `organizations.ts:36` (`create_organization`, pool `signet_app`) et `creation.test.ts:151` (`organizations_for_user`, via `asTenant`, donc pool `signet_app`). Les deux sont couverts par les re-grants.

### Etat des six MINEUR du premier audit

| # | Etat |
|---|---|
| MINEUR-1 (RLS non-filet sur les routes a `organizationId` dans le chemin) | **Inchange.** `apps/web` intact. Decision d'architecture toujours ouverte. |
| MINEUR-2 (`GRANT INSERT ON organization TO signet_app`, 0003:185) | **Inchange.** 0005 ne le revoque pas. |
| MINEUR-3 (`create_organization` reecrit le contexte tenant de la transaction appelante) | **CHANGE DE NATURE — elargi.** Voir ci-dessous. |
| MINEUR-4 (message Zod brut renvoye au client) | **Inchange.** |
| MINEUR-5 (aucun rate limiting sur `POST /api/organizations`) | **Inchange.** |
| MINEUR-6 (variables d'environnement sans schema) | **Inchange.** |

**MINEUR-3, elargi** — Emplacement : `0005:34`. Le `set_config(..., is_local => true)` de `propagate_subscription_quota` ecrase `app.organization_id` pour **toute la suite de la transaction appelante**, et pas seulement pour la duree du trigger. C'est la meme post-condition que `create_organization` (0003:259), mais elle s'applique desormais a un trigger declenchable par n'importe quel `UPDATE ... OF tier`, y compris multi-lignes. Aucun exploit dans la tranche 001 (`signet_app` n'a aucun droit d'ecriture sur `subscription`, 0003:194). Le risque est pour la tranche 002 : un handler de webhook Stripe qui traiterait plusieurs evenements dans une meme transaction, ou qui ferait une lecture `withTenant` apres avoir mis a jour un palier, verrait son contexte silencieusement bascule sur la derniere organisation traitee par le trigger. **Remediation** : sauvegarder et restaurer l'ancienne valeur du GUC avant le `RETURN NULL`, ou documenter la post-condition dans le commentaire de la fonction et interdire par convention l'`UPDATE` de palier depuis une transaction deja contextualisee. Reste MINEUR, mais sa surface a grandi avec ce correctif — a traiter au plus tard avec la tranche 002.

**MINEUR-7 (nouveau, dette)** — `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA signet FROM PUBLIC` (`0005:96`) est un coup unique : il ne porte que sur les fonctions existant a cet instant. Le premier audit recommandait `ALTER DEFAULT PRIVILEGES` **et** une assertion sur `pg_proc.proacl` ; ni l'un ni l'autre n'a ete mis en place. La tranche 002 annonce deja de nouvelles fonctions `SECURITY DEFINER` (`signet.create_invitation()`, `signet.accept_invitation()`, `signet.lookup_invitation()` — cf. `docs/02-architecture/api-contracts/invitations.ts:38,72-73`) : elles naitront `EXECUTE TO PUBLIC`, rouvrant MAJEUR-1 sans qu'aucun test ne le detecte. **Remediation** : `ALTER DEFAULT PRIVILEGES IN SCHEMA signet REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` (pour chaque role createur de fonctions), plus un test d'invariant qui balaye `pg_proc.proacl` du schema `signet` et echoue si `=X/` apparait sur une entree. MINEUR parce que l'etat actuel du schema est bien ferme ; a traiter avant que la tranche 002 n'ajoute ses fonctions.

**MINEUR-8 (nouveau, documentation)** — `docs/02-architecture/ADR/0007-roles-postgres.md:106` affirme toujours, pour `propagate_subscription_quota`, « Aucune action supplementaire necessaire : ces triggers s'executent toujours a l'interieur de celle ouverte par `create_organization` ». C'est desormais faux deux fois : la justification ne couvrait deja pas la branche `UPDATE OF tier` (c'etait MAJEUR-2), et le correctif fait maintenant l'inverse de ce que l'ADR decrit. Le premier audit demandait explicitement la reouverture de cette ligne ; elle ne l'a pas ete. Un lecteur de l'ADR en tranche 002 reproduira le patron errone sur une nouvelle fonction. **Remediation** : mettre a jour la ligne du tableau d'ADR-0007 Partie 2 pour y decrire le patron n°1 (contexte pose par la fonction + controle `ROW_COUNT`), et retirer la justification « transaction de creation ».

### Points re-verifies sans constat

Injection (aucune concatenation SQL, tout parametre), mass assignment, ordre 401 → 404 → 403, secrets, CSRF, `FORCE ROW LEVEL SECURITY`, `SET search_path` sur les cinq fonctions `SECURITY DEFINER` (les deux fonctions remplacees en 0005 le re-declarent bien, `:25` et `:69`) : identiques au premier audit, rien n'a bouge. Aucun `any`, aucune suppression de verification de type, aucun `// TODO` dans les fichiers modifies.

---

## 4. Dependances

`pnpm audit` → **`No known vulnerabilities found`**. Aucune dependance ajoutee par ce tour de correctifs (aucun manifeste ni `pnpm-lock.yaml` modifie).

---

## 5. Synthese

| Gravite | Nombre | Detail |
|---|---|---|
| CRITIQUE | 0 | |
| MAJEUR | 1 | MAJEUR-3 (nouveau) : le test d'anti-regression de MAJEUR-2 asserte l'inverse du correctif et ne peut pas passer |
| MINEUR | 8 | MINEUR-1,2,4,5,6 inchanges ; MINEUR-3 elargi ; MINEUR-7 et MINEUR-8 nouveaux |

MAJEUR-1 et MAJEUR-2 du premier audit sont **leves** : les deux correctifs SQL de `0005_execute_grants_and_quota_context.sql` sont corrects, complets, bien places, et n'enlevent aucun acces legitime. Les deux tests de MAJEUR-1 sont de vrais tests d'anti-regression.

Ce qui bloque, c'est le troisieme test : ecrit pour proteger le correctif MAJEUR-2, il code la comprehension **inverse** de ce que ce correctif fait. Le correctif rend la fonction autonome en contexte ; le test exige qu'elle echoue faute de contexte. Ce n'est pas un detail de formulation — c'est le signe que la suite n'a pas ete executee contre une base reelle avant d'etre remise a l'audit, et que MAJEUR-2 repart en production sans filet. Deux elements a remonter avec : les correctifs ne sont pas committes, et je n'ai pas pu executer la suite (aucun Postgres dans cet environnement), donc la confirmation empirique de MAJEUR-3 reste a faire par quelqu'un qui dispose de la base — mon analyse s'appuie sur deux tests existants du depot qui ferment l'alternative, mais un `pnpm test` vaudra toujours mieux qu'un raisonnement.

Recommandation d'ordre de traitement : MAJEUR-3, puis MINEUR-8 (l'ADR egare la tranche suivante), puis MINEUR-7 avant que la tranche 002 n'ajoute ses fonctions `SECURITY DEFINER`.

AUDIT: FAIL

---
---

## Audit de securite — tranche 001 (Signet), 3e passe

Perimetre reel audite : arbre de travail (`git status --porcelain`), pas seulement `git diff master...HEAD`. Fichiers effectivement changes depuis la passe 2 : `docs/02-architecture/ADR/0007-roles-postgres.md` (M), `tests/organizations/invariants.test.ts` (M). `packages/db/migrations/0005_execute_grants_and_quota_context.sql` (??) inchangee, `apps/web/**` et `0001-0004` inchanges — confirme.

Reserve de methode : pas de Postgres/psql/docker dans cet environnement. Les verdicts ci-dessous sont obtenus par deroulement ligne a ligne des tests contre le SQL reel (0001, 0003, 0005) et les fixtures, pas par execution.

---

### 1. MAJEUR-3 — RESOLU

**Test (a)** `C:\dev\mon-saas\.claude\worktrees\agent-a219314fe88bd941b\tests\organizations\invariants.test.ts:73-108` — teste maintenant exactement, et uniquement, ce que 0005 garantit.

Deroulement dans les deux etats :
- *Apres 0005* : `create_organization_counters` insere `link_quota = quota_for_tier('free')` = **50** (`0005:73`), le trigger branche INSERT repasse 50. Etat initial = 50. `UPDATE ... tier='pro'` sous `asBypassRls` : `SECURITY DEFINER` bascule `current_user` sur `signet_definer`, qui est bien `NOBYPASSRLS` (verifie `0001:51`) — la RLS s'applique donc reellement dans la fonction, le test exerce le vrai chemin. La fonction pose `app.organization_id = NEW.organization_id` (`0005:34`), `organization_link_usage_definer_write` (USING **et** WITH CHECK `= current_org()`, `0003:107-110`) est satisfaite, 1 ligne → `link_quota = NULL`. Puis `tier='free'` → 50. Les deux assertions passent.
- *Avant 0005* : aucun contexte ambiant sur une connexion `asBypassRls` hors transaction → `UPDATE` sur zero ligne, `link_quota` reste 50 → `expect(afterUpgrade).toBeNull()` **echoue**. Le test discrimine bien les deux etats.

**Pas de faux-positif par contrainte** : la seule CHECK sur la colonne est `organization_link_usage_quota_chk` = `link_quota IS NULL OR link_quota > 0` (`0003` DDL). Elle n'impose jamais `NULL` sur un palier `pro` ni `50` sur `free` — elle ne peut donc pas sauver l'assertion. L'ADR-0002 confirme que la CHECK reliant `link_count`/`link_quota` a ete explicitement abandonnee. Et la structure en deux temps (50 → NULL → 50) est auto-verrouillante : un trigger inerte laisserait 50 partout, ce qui casse la 1re assertion ; un trigger qui ne ferait que nuller casserait la 2e. Aucune valeur constante ne satisfait les deux.

**Test (b)** `...invariants.test.ts:118-135` — isole correctement le garde-fou `ROW_COUNT`. La ligne `organization_link_usage` est reellement supprimee (aucune FK entrante vers cette table, aucun trigger sur elle : la suppression aboutit), l'organisation reste existante, et la fonction posant toujours son propre contexte, la **seule** cause possible de `v_updated <> 1` est l'absence reelle du compteur. Aucune dependance a un etat de contexte residuel : `set_config(..., is_local => true)` dans une transaction implicite est revoque en fin d'instruction, donc rien ne fuit d'un test a l'autre sur la connexion mutualisee du pool. Avant 0005 (pas de `GET DIAGNOSTICS`), l'`UPDATE` a zero ligne ne levait pas → le test echouerait. Discrimination correcte.

Les deux tests `signet_owner`/`signet_auth` (`:150-175`) : `.toMatchObject({ code: "42501" })` est le bon resserrage. Verifie qu'ils discriminent toujours : avant 0005, `EXECUTE` acquis a `PUBLIC`, l'appel entrerait dans la fonction et echouerait plus loin sur la FK `member_user_id_app_user_id_fk` (UUID inexistant) → SQLSTATE `23503`, pas `42501`. Le resserrage n'a pas rendu le test complaisant.

### 2. ADR-0007 — correction fidele

`docs/02-architecture/ADR/0007-roles-postgres.md` (tableau Partie 2) : la ligne scindee decrit `PERFORM set_config('app.organization_id', NEW.organization_id::text, true)` en premiere instruction puis la verification `GET DIAGNOSTICS ... ROW_COUNT`. C'est litteralement `0005:34` et `0005:45-49`. La colonne « perimetre » (« une seule organisation, connue par `NEW.organization_id`, independamment du contexte de la session appelante ») decrit correctement le patron reellement implemente. La ligne restante pour `create_organization_counters` (« aucune action supplementaire ») reste exacte : 0005 ne lui ajoute pas de `set_config`, il ne change que la valeur inseree. MINEUR-8 est clos.

Observation sans constat : le commentaire de `0003:105-106` (« contexte pose par `signet.create_organization` avant l'INSERT qui declenche ces triggers ») est desormais perime pour la branche UPDATE. Migration deja appliquee → non modifiable par regle projet, et ADR-0007 porte maintenant l'enonce correct. Aucune action.

### 3. Coherence 0005 / tests
Aucune incoherence relevee entre les tests corriges et la migration. Pas de re-audit detaille de 0005, conformement a la consigne.

### 4. Constats MINEUR — statut

| # | Statut |
|---|---|
| MINEUR-1 (contexte tenant derive du chemin, RLS tautologique) | Inchange — `apps/web/**` non modifie. Decision d'architecture, a trancher par un humain. |
| MINEUR-2 (`GRANT SELECT, INSERT, UPDATE ON organization TO signet_app`, `0003:185`) | Inchange, verifie : 0005 ne contient aucun `REVOKE` de table. |
| MINEUR-3 elargi (reecriture silencieuse de `app.organization_id` pour le reste de la transaction) | Inchange, et desormais porte par trois fonctions : `create_organization` (`0003:259`), `assert_owner_remains` (`0004:36`), `propagate_subscription_quota` (`0005:34`). Consequence concrete la plus probable : un script d'exploitation qui changerait le palier de plusieurs organisations dans une seule transaction laisserait `app.organization_id` pointe sur la derniere traitee. Aucun appelant actuel n'en souffre. |
| MINEUR-4 (message Zod brut renvoye, absence de frontiere d'erreur) | Inchange. |
| MINEUR-5 (aucune limitation de debit sur `POST /api/organizations`; plafond d'organisations par utilisateur = decision produit manquante) | Inchange. |
| MINEUR-6 (variables d'environnement sans schema) | Inchange. |
| MINEUR-7 | **Je ne peux pas le re-verifier a l'identique** : le rapport persiste (`docs/04-runbooks/audits/audit-001.md`) ne porte que MINEUR-1 a 6 ; les numeros 7 et 8 sont nes de la passe 2, qui n'a pas ete persistee. Le perimetre ou il vivait (0001-0004, `apps/web/**`) n'a pas bouge, donc il tient par construction. A recuperer aupres du rapport de passe 2 si son libelle exact est requis par la cloture. |

Point qui relevait probablement de MINEUR-7 et que je re-constate en tout etat de cause : `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA signet FROM PUBLIC` (`0005:96`) est un instantane, pas une regle. Aucun `ALTER DEFAULT PRIVILEGES` n'existe dans `packages/db/migrations/` (verifie). Toute fonction creee par une migration future naitra a nouveau avec `EXECUTE` acquis a `PUBLIC`. MINEUR, non bloquant, mais c'est le meme defaut qui reapparaitra a la tranche 002.

### Nouveau constat

**MINEUR-9 — Le test (b) accepte n'importe quelle erreur, pas celle du garde-fou**
- **Emplacement** : `C:\dev\mon-saas\.claude\worktrees\agent-a219314fe88bd941b\tests\organizations\invariants.test.ts:134` — `.rejects.toThrow()`.
- **Scenario** : le `RAISE EXCEPTION` de `0005:47` n'a pas d'`ERRCODE` explicite, il remonte donc en `P0001`. Le test ne verifie ni le code ni le message. Si une migration future revoquait `UPDATE ON organization_link_usage FROM signet_definer` (`0003:197`), la fonction echouerait en `42501` : la propagation de quota serait cassee sur tout le chemin, et ce test resterait vert en croyant observer le garde-fou. C'est le meme angle mort que celui qui vient d'etre ferme sur les deux tests `42501`, laisse ouvert sur celui-ci.
- **Remediation** : aligner l'assertion sur le resserrage deja fait dans ce fichier — verifier le SQLSTATE attendu (et donner un `ERRCODE` explicite au `RAISE` de `propagate_subscription_quota` pour que ce SQLSTATE soit un contrat stable plutot que le `P0001` par defaut). Les trois premiers tests du fichier (`:29`, `:43`, `:56`) portent la meme imprecision : dette assumee, hors perimetre de ce constat.

### 5. Dependances
`pnpm audit` → **No known vulnerabilities found**. Inchange.

---

### Synthese

| Gravite | Nombre |
|---|---|
| CRITIQUE | 0 |
| MAJEUR | 0 |
| MINEUR | 7 confirmes (1, 2, 3-elargi, 4, 5, 6, 9) + MINEUR-7 non re-verifiable faute de libelle persiste |

MAJEUR-1, MAJEUR-2 et MAJEUR-3 sont clos. Les deux nouveaux tests protegent la bonne garantie, dans le bon sens, et echoueraient tous deux sans le correctif 0005. La correction d'ADR-0007 est fidele a l'implementation.

AUDIT: PASS
