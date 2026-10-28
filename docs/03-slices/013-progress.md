# 013 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : implementation terminee, AC1 a AC11 verts (AC12 : verification ponctuelle de l'orchestrateur)
- Branche : slice/013-consultations-ecrans
- Dernier commit : c3ae367 feat(slice-013): routes GET organisations et membres
- Prochaine etape : orchestrateur — trois relecteurs, registre, `bash scripts/close-slice.sh` (fiche de preuves, AC12)
- Resultats (2026-10-28) : `tests/screen-reads` 4 fichiers, 30/30 en 90,95 s ; `pnpm run check` vert (typecheck + eslint) ; `pnpm test` 62 fichiers, 748 passes, 1 ignore (AC16 de 003, `runIf` de branche `slice/003-`, preexistant), 0 echec, 196,58 s

## Couches
- [ ] Migration — sans objet (D-138 point 5 : aucune migration)
- [x] Acces donnees — c3a85a2 (typecheck vert ; preuve fonctionnelle par les tests HTTP de la couche API)
- [x] Logique metier — c3a85a2
- [x] API — c3ae367 (`tests/screen-reads` 30/30)
- [ ] UI — sans objet (tranche 012)
- [x] Suite complete verte + `pnpm run check`

## Blocages

## Decisions
- Ouverture (orchestrateur) : contrat `listMyOrganizations` ajoute a `docs/02-architecture/api-contracts/organizations.ts` au texte de D-138 point 1 (decision humaine), dans le commit d'ouverture pour que les tests l'importent ; lectures de forme D-139 (contrat de tranche, section « Lectures de l'orchestrateur »), dont l'ecart `minRole: "public"` / D-109 (point 6).
- Verifie avant contrat (orchestrateur) : `signet_app` a `SELECT` sur `member` et `app_user` (0003), `EXECUTE` sur `signet.organizations_for_user` (0009) ; `member.created_at` existe (0003) : aucune migration ni privilege necessaire (D-138 point 5 tenu).
- Tests (test-writer) : un helper unique `tests/helpers/screen-reads.ts` ; 4 fichiers dans `tests/screen-reads/` (my-organizations, members-read, members-isolation, read-only). Etat attendu avant implementation : 28 echecs (405 sur GET /api/organizations, 404 HTML sur /members), 2 reussites (AC4 base `organizations_for_user` sous signet_app, AC8 c RLS : l'infrastructure existe deja, ces deux preuves gardent le comportement apres implementation).
- Tests : le member d'AC3/AC5/AC6/AC8/AC9/AC10 passe par le parcours d'invitation reel (`joinByInvitation`) ; la messagerie factice est videe avant chaque parcours car `issueInvitation` lit le premier message de l'adresse (un membre de deux organisations lirait sinon un jeton deja consomme).
- Tests : horodatage egal des organisations (AC3) force avec `session_replication_role = replica` dans la seule transaction d'insertion, car les declencheurs `SECURITY DEFINER` de creation exigent un contexte de membre verifie impossible avant l'existence de la ligne (erreur 42501 constatee) ; la lecture testee ne depend que de `organization` et `member`. Les membres a date d'arrivee egale (AC6) n'ont pas besoin de cette suspension.
- Tests : ordre d'arrivee (AC6) discriminant : m2 s'inscrit avant m1 (id plus petit) mais rejoint apres ; ordre d'AC3 discriminant : l'organisation creee par l'appelant est plus recente que celle rejointe, alors que son arrivee dans la rejointe est la plus tardive (distingue `organization.created_at` de `member.created_at`).
- Tests : seul message fige : « Identifiant d'organisation invalide. » (cite au contrat, D-124) ; les autres 422/404 sont verifies fixes, sans valeur soumise ni fragments Zod/SQL (`expectCleanErrorBody`).
- Implementation : `listMyOrganizations` et `listMembers` enveloppent leur transaction dans un `try/catch` qui journalise le seul code SQL et releve une erreur sans detail (patron D-133 point 3, comme `listCollections`). Ecarte : laisser remonter l'erreur brute (son message peut porter une valeur) ; une fonction commune `pgErrorOf` partagee (aucun module commun hors `errors.ts`, qui ne change pas) : extraction du code ecrite localement, en une ligne.
- Implementation : `role` de `listMembers` reduit a `"owner" | "member"` par une garde qui `throw` hors domaine (invariant : contrainte `member_role_chk` de 0003). Ecarte : un transtypage `as` (masquerait une derive du schema) ; une validation par `listMembers.output.parse` a l'execution (le contrat n'est utilise cote serveur que pour l'entree, patron 009).
- Implementation : la couche donnees n'a pas de test unitaire propre ; elle est committee apres `pnpm typecheck` vert et prouvee par les tests HTTP de `tests/screen-reads/` au commit API (les tests de la tranche sont tous de bout en bout, aucun test n'a ete ajoute).
- Implementation : `GET /api/organizations` ajoute au fichier existant ; seule ligne existante modifiee : l'import de `@/lib/organizations` (ajout de `listMyOrganizations`), le corps du `POST` est inchange ligne pour ligne. Le `GET` reprend le style de reponse du `POST` (corps `{ code, message }` construit en ligne) plutot qu'un `errorResponse` local, pour ne pas toucher au `POST`. Ecarte : une seconde ligne d'import du meme module (doublon d'import) ; refactoriser le `POST` vers un helper commun (interdit par le contrat).
- Implementation : la route `.../members` reprend a l'identique le patron de la route `GET .../collections` (009) : message de repli « Requete invalide. » si le schema refusait un champ autre que `organizationId` (inatteignable aujourd'hui, le seul champ est `organizationId`), forme canonique `toLowerCase()` locale. Ecarte : importer `canonical` depuis la route 009 (couplage entre routes) ; `lib/uuid.ts` (hors perimetre, non verifie).
- Tests : AC10 compare `to_jsonb` des lignes completes de organization/member/app_user/invitation (filtrees par identifiants du test) ; AC11 = test de coexistence POST/GET, l'assertion de fond reste `tests/organizations/**` inchange ; AC12 : aucun test permanent (D-099).
