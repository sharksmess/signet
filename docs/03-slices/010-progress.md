# 010 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : tests verts, correctifs de relecture (review-010) appliques
- Branche : slice/010-durcissement-isolation
- Dernier commit de code/tests : 37c213f test(slice-010): utilisateurs reels AC4 et catalogue current_org (ce journal est committe juste apres)
- **Derniere suite (sur 37c213f)** : `Test Files 10 passed (10)`, `Tests 92 passed (92)`, aucun test ignore ; `pnpm run check` vert. Les 10 tests ajoutes : AC2 INSERT x4, AC3 (a) INSERT x1, AC3 tables complementaires x3, concurrence par retrait de membre x1, catalogue `current_org()` x1.
- Prochaine etape : nouvelle passe des relecteurs sur les correctifs, registre, `close-slice.sh`
- Historique :
- Etat des tests a l'ecriture : 28 echecs attendus (AC2, AC3, AC4, catalogue ADR-0011, concurrence, AC6 i-ii), 54 verts (suite 001, catalogue usine, AC5 API, AC6 iii, recursion, member non owner). Rejoue a l'implementation (baseline) : identique, 28 echecs / 54 verts.
- Apres 0009 : 78 verts / 4 echecs (AC6 i-ii : 0010 absente ; AC4 create_organization x2 : defaut de test, voir « Blocages »)
- Apres 0010 + commentaires (derniere suite) : `Test Files 1 failed | 9 passed (10)`, `Tests 2 failed | 80 passed (82)` ; les 2 echecs sont les tests AC4 defectueux (`25P02`). Aucun test ignore.
- `pnpm run check` (typecheck + lint) : vert.
- `pnpm db:generate` : « No schema changes, nothing to migrate », aucun fichier produit (`git status` propre) — preuve ADR-0011 § j.

## Couches
- [x] Migration 0009 (RLS par appartenance, fonctions `signet.*`) — 19042a2
- [x] Migration 0010 (attributs des roles) — 1588c66
- [x] Acces donnees (`withTenant` : commentaires seulement) — 42e5f83
- [x] Logique metier — sans objet (aucune)
- [x] API — sans objet (aucune route modifiee)
- [x] UI — sans objet
- [x] Suite complete verte + `pnpm run check` — `Test Files 10 passed (10)`, `Tests 82 passed (82)` apres correction des deux tests AC4 ; puis `Tests 92 passed (92)` apres correctifs de relecture (37c213f)

## Blocages
<!-- cause, essais, options. Vide = aucun. -->
- **Deux tests AC4 ne peuvent passer avec aucune implementation** (`tests/isolation-hardening/definer-functions.test.ts`, tests « create_organization sans app.user_id leve SG002... » l. 44-60 et « ... p_owner_user_id different ... » l. 62-75).
  - Constat : l'assertion `rejects.toMatchObject({ code: "SG002" })` **passe** (0009 leve bien `SG002`). La requete « boite blanche » qui suit (`SELECT count(*) ... FROM organization WHERE name = $1`, l. 57 et l. 72) est executee sur le **meme client, dans la meme transaction** ouverte par `asTenant` ; l'exception de la fonction a mis cette transaction en etat annule, et Postgres repond `25P02` (« la transaction est annulee, les commandes sont ignorees jusqu'a la fin du bloc »).
  - Pourquoi c'est le test : si la fonction leve, la requete suivante echoue toujours en `25P02` ; si elle ne leve pas, la premiere assertion echoue. Aucune migration ne satisfait les deux. En outre, cette lecture passe par `signet_app` (RLS), elle rendrait 0 ligne meme si une organisation avait ete creee : ce n'est pas une verification boite blanche.
  - Non fait : modifier le test (interdit a l'implementeur par l'orchestrateur), contourner par la migration (impossible).
  - Options pour le proprietaire des tests : (a) encadrer l'appel par `SAVEPOINT s` / `ROLLBACK TO SAVEPOINT s` avant la verification ; (b) faire la verification apres `asTenant`, par `asBypassRls` (vraie boite blanche ; le nom contient `Date.now()`, donc unique) ; (b) est plus fidele a « verifie en boite blanche » d'AC4.

- **Leve (orchestrateur, 2026-09-30, commit 077bb1a)** : option (b) appliquee aux deux tests — verification apres la transaction, sous la connexion d'administration (hors RLS). Assertion `SG002` inchangee. Suite complete : 82/82 (sur 7320169).
  - **Rectificatif (review-010 A CORRIGER-2)** : ce comptage n'est **pas** une vraie boite blanche. `asTenant` annule toujours sa transaction : il vaut 0 quelle que soit l'implementation. La preuve que rien n'est cree est l'assertion `SG002` (l'instruction echoue atomiquement). Le comptage reste comme simple controle de coherence, commente comme tel (37c213f).

## Decisions
- Ouverture (orchestrateur) : conception confiee a `db-architect` avant de figer le perimetre de fichiers, pour savoir si un index ou le schema Drizzle devaient changer (reponse : non). ADR-0011 acceptee, y compris la correction `pg_temp` des trois fonctions de trigger, la garde `SG002` de `create_organization` et la levee sur appartenance de role (D-027, D-028).
- 0009, implementeur : `create_organization` insere le membre owner avec `v_session_user` (valeur de `current_user_id()` deja verifiee egale a `p_owner_user_id`) plutot qu'avec le parametre ; equivalent apres la garde, et la valeur ecrite est celle de la session. La verification `p_owner_user_id IS NULL` de 0003 disparait : couverte par la garde `SG002` (`IS DISTINCT FROM` une valeur non nulle). Ecarte : garder les deux controles (code mort).
- 0009, implementeur : `v_org_id := signet.uuidv7()` deplace de la section `DECLARE` au corps, apres la garde, pour que la garde soit litteralement la premiere instruction (ADR-0011 § e). Aucun effet observable.
- 0009, implementeur : messages `SG002` distincts pour « identite absente » et « identite differente », sans aucun identifiant dans le texte (regle secrets/erreurs). Meme code, pour le test et pour ERD §0.
- 0009, implementeur : `ALTER POLICY ... TO signet_app` pour `organization_isolation` / `member_isolation` (plutot que `DROP` + `CREATE`) : l'expression est conservee a l'identique, ce qu'exige ADR-0011 § d (« texte inchange »). `REVOKE ALL FROM PUBLIC` + `GRANT` re-emis sur chaque fonction remplacee, meme si `CREATE OR REPLACE` conserve les privileges : la migration se lit seule. L'`EXECUTE` explicite accorde a `signet_definer` sur `current_org()` en 0005 n'est pas revoque : `signet_definer` en est desormais proprietaire (droit implicite, non revocable utilement).
- 0009, implementeur : `context_org()` est `STABLE`, `LANGUAGE sql`, `SECURITY INVOKER` sans `SET search_path` (comme `current_user_id()` de 0001, et conforme a ERD §1) : pas de `SECURITY DEFINER`, donc hors des exigences de `search_path` du catalogue ; elle ne reference aucune relation.
- 0010, implementeur : le message d'erreur liste toutes les appartenances fautives (`<role signet_*> membre de <parent>`), triees, plus un `HINT` de remediation ; noms de roles seulement, aucun secret. SQLSTATE `P0001` par defaut (pas d'`ERRCODE` personnalise : ADR-0011 § h et le test attendent `P0001`). Tables du catalogue qualifiees `pg_catalog.` dans le bloc `DO`.
- 0010, implementeur : pas de controle d'existence des roles avant `ALTER ROLE` : 0001 les cree toujours ; un role absent ferait echouer la migration bruyamment, ce qui est le comportement voulu.
- `db.ts`, implementeur : en plus du commentaire de `withUserOnly` (ADR-0011 § i), une phrase ajoutee au commentaire de `withTenant` (la RLS verifie desormais l'appartenance ; le controle applicatif et le 404 uniforme restent requis). Commentaire seulement, dans le perimetre declare ; ecarte : laisser `withTenant` muet sur le changement de sens de la barriere.
- AC cochees dans le contrat : AC1, AC2, AC3, AC5, AC6 (tests verts). AC4 **non cochee** : ses assertions `SG002` et de catalogue passent, mais deux de ses tests echouent (defaut de test).
- AC4, orchestrateur : les deux tests « create_organization ... ne cree aucune organisation » verifient desormais l'absence d'organisation apres `asTenant`, par `asBypassRls`. Ecarte : option (a) `SAVEPOINT`, qui garde une lecture sous `signet_app` filtree par la RLS, donc aveugle a une creation erronee. AC4 cochee. (Portee de ce comptage rectifiee plus bas : controle de coherence, pas preuve.)

### Correctifs de relecture (review-010, implementeur, 2026-09-30)
- **AC2 INSERT (BLOQUANT-1), 485d2e3** : `INSERT INTO organization` sous `signet_app` avec contexte force (owner puis member de A) : (1) `id` = B, contexte B ; (2) `id` neuf, `app.organization_id` pose sur ce meme id. Plus AC3 (a) : id neuf pose comme contexte, sans `app.user_id`. **Code exige : `42501`**, constate a l'execution. Justification : c'est le SQLSTATE de « new row violates row-level security policy » ; il sert aussi pour un `GRANT` manquant, donc chaque test verifie d'abord `has_table_privilege('signet_app', 'organization', 'INSERT') = true`, pour qu'un `42501` ne puisse venir que du `WITH CHECK`. Pour (1), Postgres evalue le `WITH CHECK` RLS avant l'insertion dans l'index d'unicite : on obtient `42501` et non `23505`. Avec l'ancienne `current_org()` brute, (1) aurait rendu `23505` et (2) aurait insere : les deux assertions discriminent. Pas de lecture « hors RLS » apres coup : `asTenant` annule toujours, elle serait toujours vraie (meme defaut que l'AC4 initial). Ecarte : `rejects.toThrow()` (n'importe quelle erreur), et tester le message (depend de `lc_messages`, francais sur l'instance locale).
- **Concurrence (A CORRIGER-1), 485d2e3** : le test initial changeait `app.user_id` entre deux instructions au lieu de **retirer un membre**, et son commentaire tenait a tort le vrai scenario pour non reproductible. Nouveau test : une seule transaction sur la connexion d'administration, toujours annulee : `SET LOCAL ROLE signet_app` + contexte + lecture (B visible) ; `RESET ROLE` + `DELETE` du membre non owner (1 ligne) ; `SET LOCAL ROLE signet_app` (verifie par `current_user`) + relecture de `organization` et `member` : 0 ligne. Seules les lectures sous `signet_app` sont jugees. L'ancien test est conserve en complement, avec un commentaire corrige. Ecarte : le supprimer (couverture gratuite du changement de contexte en cours de transaction).
- **Catalogue `current_org()` (A CORRIGER-1), 37c213f** : `provolatile = 's'`, `prosecdef = true`, proprietaire `signet_definer`. Seul moyen de distinguer `STABLE` d'`IMMUTABLE` : sur des requetes non preparees, un test comportemental passe dans les deux cas.
- **AC4 utilisateurs reels (A CORRIGER-2, audit INFO-3), 37c213f** : session sans `app.user_id` avec un owner reel (`signUp`) ; session d'un utilisateur reel qui demande comme owner l'owner reel d'une autre fixture. Sans la garde, l'appel reussirait (FK satisfaite), donc `SG002` discrimine. Comptage conserve avec un commentaire honnete (controle de coherence). Ecarte : le retirer (il documente que rien ne fuit hors de la transaction, a cout nul).
- **Politiques `TO PUBLIC` (SUGGESTION-1, audit INFO-2), 37c213f** : les deux invariants `current_org(` / `context_org(` incluent `0::oid = ANY(pol.polroles)`.
- **AC3 (c) UUID malforme (SUGGESTION-2), 485d2e3** : `22P02` exige (lecture `organization`, lecture `member`, `UPDATE`) ; « 0 ligne » n'est plus accepte (ADR-0011 § g). Constate : les trois levent `22P02`.
- **AC3 tables complementaires (SUGGESTION-3), 485d2e3** : (a) sans `app.user_id`, (b) inconnu, (c) vide : aucune ligne `organization_link_usage`, `subscription`, `app_user` (co-appartenance) avec un contexte A valide. Ecarte : le cas malforme ici, deja couvert par `22P02`.
- Aucun defaut revele dans 0009 ni 0010 : aucun INSERT accepte, aucun code inattendu. Migrations non modifiees.
- Journal du run (`docs/04-runbooks/autonomous-run-2026-09-29.md`, review-010 A CORRIGER-3) : non modifie par l'implementeur (fichier de l'orchestrateur, deja modifie et non committe dans l'arbre de travail).
