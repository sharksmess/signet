# Relecture de code — tranche 010 « durcissement de l'isolation tenant »

- **Relecteur** : `code-reviewer` (independant ; n'a pas vu le code s'ecrire)
- **Date** : 2026-09-30
- **Branche** : `slice/010-durcissement-isolation`, HEAD `7320169`, base `main`
- **Perimetre relu** : `git diff main...HEAD` (21 fichiers), `git log main..HEAD` (10 commits) ; contrat `docs/03-slices/010-durcissement-isolation.md`, journal `010-progress.md`, ADR-0011, amendements d'ADR-0004 et ADR-0007, ERD, `docs/DECISIONS.md` (D-027, D-028), `docs/04-runbooks/autonomous-run-2026-09-29.md`, migrations 0003 (etat anterieur) et 0009/0010, `apps/web/src/lib/db.ts`, `tests/isolation-hardening/*.test.ts`, `tests/helpers/db.ts`, `tests/organizations/invariants.test.ts`, `.claude/rules/drizzle-postgres.md`.
- **Hors perimetre** (autres relecteurs) : securite (`security-auditor`), contrat d'API (`contract-guardian`).

## Preuves executees par le relecteur
- `pnpm run check` (typecheck + lint) : vert.
- `pnpm test` **non relance** sur consigne de l'orchestrateur (base de test et port partages entre relecteurs paralleles). Resultat communique par l'orchestrateur sur `7320169` : `Test Files 10 passed (10)`, `Tests 82 passed (82)`. Non verifie independamment par ce relecteur.
- `git diff --stat main...HEAD -- tests/organizations tests/_factory tests/helpers/fixtures.ts` : **vide**. AC1 (« aucune assertion de `tests/organizations/**` modifiee ») est tenu ; `tests/helpers/db.ts` ne recoit qu'un ajout (`asTenantRaw`), `asTenant` est inchange.
- Recherche `TODO|FIXME|XXX` dans les lignes ajoutees : aucune.
- Sujets de commit : 10 commits, tous Conventional Commits, 35 a 65 caracteres, tests (`e3b4dff`) avant implementation (`19042a2`, `1588c66`), une couche par commit (0009, 0010, commentaires `db.ts`), journal mis a jour entre les couches.

## Ce qui est solide (constate, pas suppose)
- **Conformite a ADR-0011** : 0009 realise exactement A3 + R1 + `STABLE` ; `context_org()` sans `GRANT`, `PUBLIC` revoque ; `current_org()` cedee a `signet_definer` (le piege « `CREATE OR REPLACE` conserve le proprietaire » est traite et teste) ; politiques `signet_app`/`signet_definer` separees par `ALTER POLICY ... TO` (texte conserve) ; `organization_link_usage_definer_write` et `subscription_definer_insert` sur `context_org()` ; gardes `SG002` en premiere instruction, `IS DISTINCT FROM` fermant le cas `NULL` ; `pg_temp` en dernier sur les cinq fonctions `SECURITY DEFINER` + la primitive. 0010 conforme a § h (leve sur appartenance, `ALTER ROLE` inconditionnel, `NOREPLICATION`, aucun mot de passe, aucun `BEGIN`).
- **Rouge avant vert documente** : le journal consigne 28 echecs « fonctionnalite absente » avant 0009, puis 82/82. J'ai verifie a la main, contre les politiques de 0003, que les tests AC2 (4 tables + `app_user` + `UPDATE`), AC3 (a)(b)(c) et AC4 `organizations_for_user` echouaient bien sur l'ancienne `current_org()` brute : ils discriminent.
- **AC6** : le test rejoue le **fichier reel** 0010 (pas une copie), dans une transaction toujours annulee (`finally ROLLBACK`), cas (i) derive d'attribut, (ii) appartenance a un role `SUPERUSER` -> `P0001` citant `signet_app`, (iii) etat persistant.
- **Catalogue** : proprietaire `signet_definer` de toute fonction `prosecdef` de `signet`, invariants `current_org(`/`context_org(` par role, `pg_temp` en dernier, `context_org()` non executable par `signet_app`/`PUBLIC`, `current_org()` sans contexte -> `NULL`.
- **Documentation** : ADR-0011 tres complete (options ecartees et pourquoi, modele de menace, limites assumees, signaux de reexamen) ; ERD mis a jour dans la meme PR que les migrations (§0 `SG002`, §1 primitives et regles d'usage, §3, §4, §7, §8.1, matrice, table des migrations) ; D-027/D-028 au registre avec options ecartees ; decisions locales de l'implementeur au journal avec l'option ecartee a chaque fois ; `pnpm db:generate` sans difference consigne (ADR-0011 § j).
- **Correction de l'orchestrateur `e3b4dff`/`077bb1a`** : l'assertion discriminante (`code: "SG002"`) n'a pas ete touchee ; la correction de `077bb1a` rend executable un test qui ne pouvait passer avec aucune implementation (lecture en `25P02`). Elle n'affaiblit pas la preuve — mais voir A CORRIGER-2 sur ce que la lecture de controle prouve reellement.

## Constats

### BLOQUANT-1 — AC2 : l'`INSERT` sous contexte force n'est pas teste, alors que le critere l'exige et qu'il est coche
- **Emplacement** : `tests/isolation-hardening/rls-membership.test.ts` l. 48-109 (bloc AC2) ; contrat l. 64 (AC2 coche `[x]`) ; `packages/db/migrations/0003_organizations_and_policies.sql` l. 185 (`GRANT SELECT, INSERT, UPDATE ON "organization" TO signet_app`).
- **Constat** : AC2 exige que « toute ecriture (`UPDATE organization`, `INSERT`/`UPDATE`/`DELETE` la ou un privilege existe) touche 0 ligne ou est refusee ». `signet_app` detient `INSERT` sur `organization` (seul privilege d'ecriture avec `UPDATE`). Le bloc AC2 ne teste que `UPDATE`. Le seul test d'`INSERT INTO organization` du depot (`tests/organizations/invariants.test.ts` l. 22-30) s'execute **sans aucun contexte** et accepte n'importe quelle erreur (`rejects.toThrow()`). ADR-0011 (« Consequences acceptees ») affirme en outre que l'`INSERT` direct par `signet_app` « devient structurellement impossible » : aucune preuve ne l'etablit.
- **Consequence** : le trou exact que la tranche ferme (une politique tautologique qui valide le contexte choisi par l'appelant) resterait invisible pour l'`INSERT` : une regression qui remettrait le `WITH CHECK` d'`organization_isolation` sur la valeur brute du contexte laisserait `signet_app`, avec `app.organization_id = X` (nouvel id) et un `app.user_id` quelconque, creer une organisation hors de `create_organization` (sans owner) — et toute la suite resterait verte. L'implementation actuelle refuse tres probablement cet `INSERT` (`current_org()` vaut `NULL` faute d'appartenance), mais un critere coche doit etre prouve, pas deduit.
- **Direction** : ajouter au bloc AC2 (owner et member de A) un `INSERT INTO organization` sous contexte force (id de B, et id neuf pose comme contexte) attendu refuse avec le code precis de violation RLS (`42501`), puis une lecture de controle hors RLS montrant qu'aucune ligne n'a ete creee. Ne cocher AC2 qu'ensuite.

### A CORRIGER-1 — Cas limite « concurrence » : le test ne distingue pas `STABLE` d'`IMMUTABLE`, et l'ecart au contrat n'est pas consigne
- **Emplacement** : `tests/isolation-hardening/rls-membership.test.ts` l. 300-337 ; contrat l. 71 ; journal `010-progress.md` § Decisions.
- **Constat** : le contrat demande qu'un **changement d'appartenance** dans la transaction soit vu par l'instruction suivante. Le test change `app.user_id` a la place. Or chaque `client.query` sans nom est planifie a nouveau : meme une `current_org()` declaree `IMMUTABLE` (le cas qu'ADR-0011 declare interdit parce qu'il fuiterait par plan prepare) ferait passer ce test. Aucun test ne verifie la volatilite de `current_org()` dans le catalogue. Par ailleurs, l'argument du commentaire (« non reproductible sans tricher ») est inexact : sous la connexion d'administration, `SET LOCAL ROLE signet_app`, lecture, `RESET ROLE`, `DELETE FROM member` (superutilisateur), `SET LOCAL ROLE signet_app`, relecture, dans **une** transaction annulee, reproduit le scenario sans affaiblir la garantie verifiee (c'est la lecture sous `signet_app` qui est jugee, pas l'ecriture).
- **Consequence** : la propriete « pas de cache d'appartenance au-dela de l'instruction » et l'interdiction d'`IMMUTABLE` reposent sur la seule relecture de 0009 ; une migration future qui changerait la volatilite ne serait pas detectee. Le remplacement du scenario du contrat par un substitut est une decision de test qui n'existe que dans un commentaire, pas au journal (regle `documentation.md` : une hypothese est une decision).
- **Direction** : ajouter une assertion de catalogue (`provolatile = 's'`, `prosecdef`, proprietaire) sur `signet.current_org()` ; idealement, reproduire le scenario du contrat par la voie decrite ci-dessus ; consigner au journal le choix retenu et l'option ecartee.

### A CORRIGER-2 — AC4 : la « verification en boite blanche » de `create_organization` est structurellement toujours vraie ; le journal la presente comme une preuve
- **Emplacement** : `tests/isolation-hardening/definer-functions.test.ts` l. 44-81 ; journal l. 123 et l. 136 (« vraie boite blanche »).
- **Constat** : `asTenant` fait **toujours** `ROLLBACK` (`tests/helpers/db.ts`, `finally`). Toute ecriture faite dans `asTenant` est donc annulee avant `countOrganizationsNamed` : ce compte vaut `"0"` quelle que soit l'implementation, y compris si la fonction avait cree l'organisation sans lever. De plus, les identifiants utilises (`...dd`, `...ee`, `...ff`) n'ont aucune ligne `app_user` : sans la garde, l'ancienne fonction echouerait en `23503` (FK de `member`) et ne creerait rien non plus. La seule assertion qui discrimine est `code: "SG002"` — elle suffit, et elle est intacte. La correction de `077bb1a` n'affaiblit donc rien (la version precedente ne pouvait pas passer, et sa lecture sous `signet_app` etait aveugle), mais elle ne renforce rien non plus.
- **Consequence** : un auditeur qui lit « verifie en boite blanche, vraie boite blanche » croit a une preuve independante qui n'existe pas. L'absence de creation decoule en realite de l'atomicite de l'instruction une fois `SG002` levee.
- **Direction** : corriger le commentaire du test et la phrase du journal (l'absence de creation est garantie par `SG002` + atomicite + annulation de la transaction) ; pour que le scenario soit celui de la menace decrite en ADR-0011 § e (creation au nom d'un tiers), utiliser deux utilisateurs **reels** (session X, owner Y) : sans la garde, l'appel reussirait, et le test echouerait sur l'absence de `SG002`.

### A CORRIGER-3 — Journaux non a jour a HEAD
- **Emplacement** : `docs/03-slices/010-progress.md` l. 4-6 et l. 12 ; `docs/04-runbooks/autonomous-run-2026-09-29.md` l. 21-22 (etape 4) et l. 12 (etat « en cours »).
- **Constat** : « Dernier commit : 42e5f83 » alors que HEAD est `7320169` (deux commits apres, dont la correction de tests `077bb1a`) ; la ligne « Apres 0010 + commentaires (derniere suite) : 2 failed » cotoie la ligne de couches « 82 passed » sans que l'etat final soit en tete. Le journal du run s'arrete a « Implementation : `slice-implementer` lance » : ni la fin de l'implementation, ni le blocage `25P02`, ni la correction de tests par l'orchestrateur n'y figurent.
- **Consequence** : `rules/git.md` (« apres chaque commit, mets a jour le journal ») n'est pas tenu ; un repreneur ou un auditeur lit un etat perime, et l'intervention de l'orchestrateur sur des tests ecrits par un autre agent (fait notable pour la confiance dans la preuve) n'est tracee que dans le journal de tranche.
- **Direction** : mettre `010-progress.md` § Etat a HEAD (dernier commit, resultat final en tete) ; completer le journal du run (fin d'implementation, blocage AC4 et sa levee, relectures).

### SUGGESTION-1 — Tests de catalogue d'invariants : les politiques `TO PUBLIC` echappent au filtre
- **Emplacement** : `tests/isolation-hardening/definer-functions.test.ts` l. 99-135.
- **Constat** : le filtre `polroles @> ARRAY[<oid du role>]` ignore les politiques sans clause `TO` (`polroles = {0}`, donc `PUBLIC`), qui s'appliquent a `signet_definer` comme a `signet_app`. Aucune n'existe aujourd'hui ; une politique future ecrite sans `TO` (le defaut de Postgres) contournerait l'invariant R1 que ce test est cense garder mecaniquement.
- **Direction** : inclure `0 = ANY(polroles)` dans les deux requetes.

### SUGGESTION-2 — AC3 (c) : le comportement confirme par l'ADR n'est pas epingle
- **Emplacement** : `tests/isolation-hardening/rls-membership.test.ts` l. 188-230.
- **Constat** : ADR-0011 § g « confirme » que `app.user_id = 'not-a-uuid'` leve `22P02`. Le test accepte « 0 ligne » **ou** `22P02`. Il reste correct (une ligne rendue fait echouer le `catch`), mais un changement de comportement (par exemple un `exception when others then return null` ajoute a `current_org()`, option explicitement ecartee par l'ADR) passerait sans signal.
- **Direction** : exiger `22P02`, conformement a la decision ecrite.

### SUGGESTION-3 — AC3 couvre `organization` et `member` seulement
- **Emplacement** : `tests/isolation-hardening/rls-membership.test.ts` l. 111-272.
- **Constat** : AC3 dit « aucune ligne visible » ; `organization_link_usage`, `subscription` et `app_user` ne sont exerces qu'en AC2. Le risque est faible (memes primitives), mais `app_user` a une politique propre.
- **Direction** : reutiliser `READS_ON_B` (et la lecture `app_user`) pour les cas (a), (b), (c).

### SUGGESTION-4 — Tracabilite de la version d'origine des tests et de l'etat « accepte » d'ADR-0011
- **Emplacement** : commit `e3b4dff` ; ADR-0011 l. 3 ; D-027 ; contrat AC6 (« vert en local et en CI »).
- **Constat** : (a) la sortie de `test-writer` n'a jamais ete committee seule : l'affirmation « typage corrige, aucune assertion modifiee » n'est pas verifiable dans l'historique (j'ai relu les assertions actuelles : elles sont coherentes avec les AC, hors constats ci-dessus). (b) ADR-0011 est « accepte » alors que D-027 porte « A valider par l'humain » pour trois points dont un restreint le comportement (`create_organization` au nom d'un tiers). (c) AC6 est coche en affirmant la CI verte, qui n'a pas encore tourne sur cette branche.
- **Direction** : a l'avenir, committer la sortie d'un agent avant toute retouche ; dans la PR (`ship-slice.sh`), lister D-027 comme **validation humaine attendue** ; ne tenir AC6 pour prouve qu'apres la CI.

## Bilan
- **Solide** : conception (ADR-0011) et migrations 0009/0010 fideles a la decision, suite 001 intacte, catalogue et roles bien couverts, documentation (ADR, ERD, registre, options ecartees) au niveau exige.
- **Fragile** : deux preuves qui paraissent plus fortes qu'elles ne sont (concurrence par substitut non discriminant, « boite blanche » AC4 toujours vraie) ; journaux en retard sur HEAD.
- **Manquant** : le test de l'`INSERT INTO organization` sous contexte force, exige par AC2 et deja coche.

REVIEW: CHANGES

## Second passage — 2026-09-30

- **Relecteur** : `code-reviewer`, meme agent, sans avoir vu les correctifs s'ecrire.
- **Branche** : `slice/010-durcissement-isolation`, HEAD `8dfdefd` (premier passage sur `7320169`).
- **Perimetre relu** : `git diff 7320169..HEAD` (commits `485d2e3`, `37c213f`, `bda76f9`, `8dfdefd`), `tests/isolation-hardening/rls-membership.test.ts` et `definer-functions.test.ts` en entier pour les parties modifiees, `tests/helpers/fixtures.ts`, `010-progress.md` (Etat, Blocages, Decisions), `000-backlog.md`, `autonomous-run-2026-09-29.md`, `audit-010.md`, `docs/DECISIONS.md`, fonctions de 0003/0005 qui creent `organization_link_usage` et `subscription`.

### Preuves executees par le relecteur
- `pnpm test` lance par le relecteur sur `8dfdefd` (aucun autre agent actif) : `Test Files 10 passed (10)`, `Tests 92 passed (92)`. Chiffre de l'implementeur confirme.
- `pnpm run check` (typecheck + lint) : vert. Arbre de travail propre.
- `git diff --stat 7320169..HEAD -- tests/organizations tests/_factory tests/helpers packages/db apps docs/02-architecture docs/03-slices/010-durcissement-isolation.md` : **vide**. `git diff --stat main...HEAD -- tests/organizations` : **vide**. Les migrations 0009/0010, les helpers, l'ERD, les ADR et le contrat n'ont pas change depuis le premier passage ; seuls les deux fichiers de `tests/isolation-hardening/` et des documents ont bouge.
- `git grep TODO|FIXME` dans `tests/isolation-hardening` : aucun.
- Commits : quatre, Conventional Commits, un par nature (tests, tests, journal, rapports), corps expliquant le pourquoi pour les deux commits de tests.

### Suivi des constats du premier passage

| Constat | Statut | Verification |
|---|---|---|
| BLOQUANT-1 (AC2 `INSERT` non teste) | **Traite** | Quatre tests AC2 (owner et member de A ; id de B, et id neuf pose comme contexte) + un AC3 (a) exigent `42501` exact. Precondition `has_table_privilege('signet_app','public.organization','INSERT') = true` avant chaque essai : le `42501` ne peut pas venir d'un `GRANT` manquant. Discrimination verifiee contre l'ancienne `current_org()` brute : l'id neuf aurait ete insere (`err` indefini, echec du `toBeDefined`), l'id de B aurait rendu `23505`. Slug unique a chaque essai : aucune contrainte d'unicite parasite. |
| Ecart assume : pas de lecture de controle hors RLS apres l'`INSERT` refuse | **Justification acceptee** | `asTenant` annule toujours sa transaction : une lecture apres coup vaudrait 0 quelle que soit l'implementation (le defaut exact releve en A CORRIGER-2). La preuve tient a l'instruction qui echoue avec un code exact, atomiquement. Consigne au journal avec les options ecartees (`rejects.toThrow()`, test du message dependant de `lc_messages`). |
| A CORRIGER-1 (concurrence, `STABLE`) | **Traite** | Scenario du contrat reproduit : une transaction sur la connexion d'administration, lectures sous `SET LOCAL ROLE signet_app` (verifie par `current_user`), `DELETE` du membre non owner entre deux (1 ligne), relecture `organization` et `member` vides ; `ROLLBACK` en `finally`. Test de catalogue `provolatile = 's'`, `prosecdef`, proprietaire `signet_definer` sur `signet.current_org()`. Ancien test conserve, commentaire corrige ; choix et option ecartee au journal. |
| A CORRIGER-2 (AC4 « boite blanche » toujours vraie) | **Traite** | Utilisateurs reels (`signUp`, owner reel d'une autre fixture) : sans la garde, l'ancienne fonction reussirait, donc `SG002` discrimine. Le comptage est explicitement commente « controle de coherence, pas preuve » ; rectificatif ecrit au journal (§ Blocages et § Decisions) sans effacer l'historique. |
| A CORRIGER-3 (journaux en retard) | **Traite** | `010-progress.md` § Etat : statut, dernier commit de code/tests, derniere suite 92/92 en tete, historique conserve. Journal du run : etapes 4 a 7 ajoutees (fin d'implementation, blocage `25P02` et sa levee par l'orchestrateur, relectures, renvoi des correctifs). |
| SUGGESTION-1 (politiques `TO PUBLIC`) | Appliquee | `OR 0::oid = ANY(pol.polroles)` dans les deux invariants. |
| SUGGESTION-2 (`22P02` exige) | Appliquee | Les trois tests AC3 (c) exigent `22P02` ; « 0 ligne » n'est plus accepte. Durcissement, pas affaiblissement. |
| SUGGESTION-3 (AC3 sur les autres tables) | Appliquee | (a), (b), (c vide) sur `organization_link_usage`, `subscription`, `app_user`. Les lignes existent bien pour A : `create_organization` (0003 l. 345-348, 0005 l. 72-75) cree l'usage et l'abonnement. Voir SUGGESTION-1 ci-dessous. |
| SUGGESTION-4 (tracabilite) | Ouverte, hors code | (b) et (c) restent a traiter a la livraison : D-027 « a valider par l'humain » a lister dans la PR ; AC6 ne vaut preuve CI qu'apres la CI. |

**Aucune assertion affaiblie.** J'ai relu chaque hunk supprime : les seules assertions retirees sont les branches « 0 ligne ou `22P02` » d'AC3 (c), remplacees par une exigence plus stricte, et les identifiants fictifs d'AC4, remplaces par des utilisateurs reels. L'assertion `SG002` est intacte ; les assertions AC2/AC3 existantes sont inchangees.

### Nouveaux constats

#### A CORRIGER-1 — Backlog : deux constats deja traites y sont inscrits comme a faire
- **Emplacement** : `docs/03-slices/000-backlog.md` l. 51 (audit-010 INFO-2) et l. 52 (audit-010 INFO-3), ajoutes par `8dfdefd`.
- **Constat** : INFO-2 (politiques `TO PUBLIC` dans les invariants) et INFO-3 (owner reel dans le test AC4) sont realises par `37c213f`, commit anterieur a `8dfdefd`, et consignes comme tels au journal de tranche (§ Correctifs de relecture). Le backlog les presente pourtant comme travail restant.
- **Consequence** : une tranche future reprendra un travail fait, ou un auditeur conclura que deux constats de securite sont ouverts alors qu'ils sont fermes et testes. Le backlog et le journal se contredisent.
- **Direction** : barrer ces deux lignes avec renvoi a `37c213f` (convention deja utilisee l. 47 et l. 54 du backlog). Cout : deux lignes.

#### A CORRIGER-2 — Le report des constats d'audit-010 au backlog, dont une priorite qui engage 002, n'a pas de ligne au registre
- **Emplacement** : `docs/DECISIONS.md` (derniere entree D-028) ; `000-backlog.md` l. 48-53 ; `autonomous-run-2026-09-29.md` etape 6.
- **Constat** : l'orchestrateur a decide de ne pas traiter dans 010 les MINEUR-1/MINEUR-2 et INFO-1/INFO-4 d'audit-010, et de placer MINEUR-2 « avant ou dans la tranche 002 ». C'est une decision de priorite qui contraint la tranche suivante. Elle est ecrite (backlog, journal du run) mais n'a pas de ligne D-NNN, alors que `documentation.md` exige « une ligne dans `docs/DECISIONS.md` » pour toute decision, avec decideur et options ecartees.
- **Consequence** : l'humain qui fusionne sur preuves, ou un auditeur qui part du registre, ne voit pas qu'un risque residuel de securite (contexte brut vu par les fonctions definer) a ete accepte pour cette tranche, ni par qui, ni l'option ecartee (le traiter dans 010).
- **Direction** : ajouter une ligne au registre (decideur orchestrateur, portee tranche 010 et 002, options : traiter dans 010 / reporter ; lien audit-010 et backlog), marquee « a valider par l'humain » comme D-027. Rien de bloquant : la decision est tracable dans le depot, c'est son entree au registre qui manque.

#### SUGGESTION-1 — Tests AC3 sur les tables complementaires : pas de controle positif
- **Emplacement** : `tests/isolation-hardening/rls-membership.test.ts`, test `AC3 %s : aucune ligne organization_link_usage, subscription ni app_user visible`.
- **Constat** : le test verifie `[]` sans etablir que les lignes existent. Aujourd'hui elles existent (creees par `create_organization`), donc le test discrimine. Mais si une tranche future (002, Stripe) cesse de creer l'abonnement a la creation, le test resterait vert sans rien prouver.
- **Direction** : lire les memes lignes par `asBypassRls` ou sous un contexte valide (owner de A) et exiger une ligne avant d'exiger `[]`, sur le modele de `expectAppCanInsertOrganization`.

#### SUGGESTION-2 — Couplage a documenter entre la precondition `INSERT` et le backlog audit-010 MINEUR-1
- **Emplacement** : `rls-membership.test.ts` (`expectAppCanInsertOrganization`) ; `000-backlog.md` l. 49.
- **Constat** : la precondition exige que `signet_app` detienne `INSERT` sur `organization`. Le backlog prevoit de le revoquer. La tranche qui le fera verra cinq tests echouer sur la precondition. C'est le bon comportement (le test ne doit pas passer en silence), mais rien ne le signale a cette tranche.
- **Direction** : ajouter a la ligne l. 49 du backlog que ces tests devront alors attendre `42501` par absence de privilege (ou etre remplaces par l'assertion de catalogue prevue).

### Bilan du second passage
- **Solide** : les cinq constats BLOQUANT/A CORRIGER du premier passage sont traites par des tests qui echoueraient sur l'ancienne implementation (code exact, precondition de privilege, utilisateurs reels, vrai retrait de membre, volatilite epinglee). Aucune assertion affaiblie, migrations et suite 001 intactes, 92/92 et `check` verts constates par le relecteur.
- **Fragile** : les tests AC3 des tables complementaires reposent sur un effet de bord non verifie de `create_organization`. La precondition `INSERT` est couplee a une revocation prevue au backlog.
- **Manquant** : backlog en contradiction avec le journal (INFO-2/INFO-3 marques ouverts) ; pas de ligne au registre pour le report des constats d'audit-010 ; validation humaine de D-027 et preuve CI d'AC6 a porter dans la PR.

REVIEW: PASS
