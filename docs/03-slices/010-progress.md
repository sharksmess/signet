# 010 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : implementation en cours — BLOQUE partiellement (voir « Blocages » : deux tests AC4 infaisables)
- Branche : slice/010-durcissement-isolation
- Dernier commit : 19042a2 feat(db): verifier l'appartenance de session dans la RLS
- Prochaine etape : migration 0010 (attributs des roles), puis commentaires de `withUserOnly`
- Etat des tests a l'ecriture : 28 echecs attendus (AC2, AC3, AC4, catalogue ADR-0011, concurrence, AC6 i-ii), 54 verts (suite 001, catalogue usine, AC5 API, AC6 iii, recursion, member non owner). Rejoue a l'implementation (baseline) : identique, 28 echecs / 54 verts.
- Apres 0009 : 78 verts / 4 echecs (AC6 i-ii : 0010 absente ; AC4 create_organization x2 : defaut de test, voir « Blocages »)

## Couches
- [x] Migration 0009 (RLS par appartenance, fonctions `signet.*`) — 19042a2
- [ ] Migration 0010 (attributs des roles)
- [ ] Acces donnees (`withTenant` : commentaires seulement)
- [ ] Logique metier — sans objet (aucune)
- [ ] API — sans objet (aucune route modifiee)
- [ ] UI — sans objet
- [ ] Suite complete verte + `pnpm run check`

## Blocages
<!-- cause, essais, options. Vide = aucun. -->
- **Deux tests AC4 ne peuvent passer avec aucune implementation** (`tests/isolation-hardening/definer-functions.test.ts`, tests « create_organization sans app.user_id leve SG002... » l. 44-60 et « ... p_owner_user_id different ... » l. 62-75).
  - Constat : l'assertion `rejects.toMatchObject({ code: "SG002" })` **passe** (0009 leve bien `SG002`). La requete « boite blanche » qui suit (`SELECT count(*) ... FROM organization WHERE name = $1`, l. 57 et l. 72) est executee sur le **meme client, dans la meme transaction** ouverte par `asTenant` ; l'exception de la fonction a mis cette transaction en etat annule, et Postgres repond `25P02` (« la transaction est annulee, les commandes sont ignorees jusqu'a la fin du bloc »).
  - Pourquoi c'est le test : si la fonction leve, la requete suivante echoue toujours en `25P02` ; si elle ne leve pas, la premiere assertion echoue. Aucune migration ne satisfait les deux. En outre, cette lecture passe par `signet_app` (RLS), elle rendrait 0 ligne meme si une organisation avait ete creee : ce n'est pas une verification boite blanche.
  - Non fait : modifier le test (interdit a l'implementeur par l'orchestrateur), contourner par la migration (impossible).
  - Options pour le proprietaire des tests : (a) encadrer l'appel par `SAVEPOINT s` / `ROLLBACK TO SAVEPOINT s` avant la verification ; (b) faire la verification apres `asTenant`, par `asBypassRls` (vraie boite blanche ; le nom contient `Date.now()`, donc unique) ; (b) est plus fidele a « verifie en boite blanche » d'AC4.

## Decisions
- Ouverture (orchestrateur) : conception confiee a `db-architect` avant de figer le perimetre de fichiers, pour savoir si un index ou le schema Drizzle devaient changer (reponse : non). ADR-0011 acceptee, y compris la correction `pg_temp` des trois fonctions de trigger, la garde `SG002` de `create_organization` et la levee sur appartenance de role (D-027, D-028).
- 0009, implementeur : `create_organization` insere le membre owner avec `v_session_user` (valeur de `current_user_id()` deja verifiee egale a `p_owner_user_id`) plutot qu'avec le parametre ; equivalent apres la garde, et la valeur ecrite est celle de la session. La verification `p_owner_user_id IS NULL` de 0003 disparait : couverte par la garde `SG002` (`IS DISTINCT FROM` une valeur non nulle). Ecarte : garder les deux controles (code mort).
- 0009, implementeur : `v_org_id := signet.uuidv7()` deplace de la section `DECLARE` au corps, apres la garde, pour que la garde soit litteralement la premiere instruction (ADR-0011 § e). Aucun effet observable.
- 0009, implementeur : messages `SG002` distincts pour « identite absente » et « identite differente », sans aucun identifiant dans le texte (regle secrets/erreurs). Meme code, pour le test et pour ERD §0.
- 0009, implementeur : `ALTER POLICY ... TO signet_app` pour `organization_isolation` / `member_isolation` (plutot que `DROP` + `CREATE`) : l'expression est conservee a l'identique, ce qu'exige ADR-0011 § d (« texte inchange »). `REVOKE ALL FROM PUBLIC` + `GRANT` re-emis sur chaque fonction remplacee, meme si `CREATE OR REPLACE` conserve les privileges : la migration se lit seule. L'`EXECUTE` explicite accorde a `signet_definer` sur `current_org()` en 0005 n'est pas revoque : `signet_definer` en est desormais proprietaire (droit implicite, non revocable utilement).
- 0009, implementeur : `context_org()` est `STABLE`, `LANGUAGE sql`, `SECURITY INVOKER` sans `SET search_path` (comme `current_user_id()` de 0001, et conforme a ERD §1) : pas de `SECURITY DEFINER`, donc hors des exigences de `search_path` du catalogue ; elle ne reference aucune relation.
