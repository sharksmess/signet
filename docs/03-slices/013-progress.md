# 013 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : tests ecrits
- Branche : slice/013-consultations-ecrans
- Dernier commit : 35520e5 test(slice-013): criteres d'acceptation de la tranche 013
- Prochaine etape : `slice-implementer` — routes `GET /api/organizations` et `GET .../members` ; les tests de `tests/screen-reads/` doivent passer

## Couches
- [ ] Migration — sans objet (D-138 point 5 : aucune migration)
- [ ] Acces donnees
- [ ] Logique metier
- [ ] API
- [ ] UI — sans objet (tranche 012)
- [ ] Suite complete verte + `pnpm run check`

## Blocages

## Decisions
- Ouverture (orchestrateur) : contrat `listMyOrganizations` ajoute a `docs/02-architecture/api-contracts/organizations.ts` au texte de D-138 point 1 (decision humaine), dans le commit d'ouverture pour que les tests l'importent ; lectures de forme D-139 (contrat de tranche, section « Lectures de l'orchestrateur »), dont l'ecart `minRole: "public"` / D-109 (point 6).
- Verifie avant contrat (orchestrateur) : `signet_app` a `SELECT` sur `member` et `app_user` (0003), `EXECUTE` sur `signet.organizations_for_user` (0009) ; `member.created_at` existe (0003) : aucune migration ni privilege necessaire (D-138 point 5 tenu).
- Tests (test-writer) : un helper unique `tests/helpers/screen-reads.ts` ; 4 fichiers dans `tests/screen-reads/` (my-organizations, members-read, members-isolation, read-only). Etat attendu avant implementation : 28 echecs (405 sur GET /api/organizations, 404 HTML sur /members), 2 reussites (AC4 base `organizations_for_user` sous signet_app, AC8 c RLS : l'infrastructure existe deja, ces deux preuves gardent le comportement apres implementation).
- Tests : le member d'AC3/AC5/AC6/AC8/AC9/AC10 passe par le parcours d'invitation reel (`joinByInvitation`) ; la messagerie factice est videe avant chaque parcours car `issueInvitation` lit le premier message de l'adresse (un membre de deux organisations lirait sinon un jeton deja consomme).
- Tests : horodatage egal des organisations (AC3) force avec `session_replication_role = replica` dans la seule transaction d'insertion, car les declencheurs `SECURITY DEFINER` de creation exigent un contexte de membre verifie impossible avant l'existence de la ligne (erreur 42501 constatee) ; la lecture testee ne depend que de `organization` et `member`. Les membres a date d'arrivee egale (AC6) n'ont pas besoin de cette suspension.
- Tests : ordre d'arrivee (AC6) discriminant : m2 s'inscrit avant m1 (id plus petit) mais rejoint apres ; ordre d'AC3 discriminant : l'organisation creee par l'appelant est plus recente que celle rejointe, alors que son arrivee dans la rejointe est la plus tardive (distingue `organization.created_at` de `member.created_at`).
- Tests : seul message fige : « Identifiant d'organisation invalide. » (cite au contrat, D-124) ; les autres 422/404 sont verifies fixes, sans valeur soumise ni fragments Zod/SQL (`expectCleanErrorBody`).
- Tests : AC10 compare `to_jsonb` des lignes completes de organization/member/app_user/invitation (filtrees par identifiants du test) ; AC11 = test de coexistence POST/GET, l'assertion de fond reste `tests/organizations/**` inchange ; AC12 : aucun test permanent (D-099).
