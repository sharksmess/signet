# 006 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : **rouverte (D-111)** ; tests de D-106, D-107, D-108 ajoutes et prouves par mutation ; suite complete verte (37 fichiers, 430 passes, 1 ignore), `pnpm typecheck` et `pnpm run check` verts
- Branche : slice/006-acceptation-invitation
- Dernier commit de code : d52b6e4 `test(slice-006): 422 unique pour un JSON valide non objet (D-107)`
- Prochaine etape : `close-slice.sh` puis `git push` sur la PR #33 (D-111)
- **Blocage de perimetre leve** : l'humain a ajoute `docs/02-architecture/api-contracts/_contract.ts` au perimetre (`scope-add`) ; `minRole` elargi a `"authenticated"` et `acceptInvitation` mis a jour (D-109), par claude-code dans la session principale, a la demande explicite de l'humain (deux lignes, l'implementeur ayant rendu la main).
- Note : `pnpm test -- <fichier>` lance toute la suite ; cibler un fichier par `pnpm test <fichier>`

## Tests ecrits (correspondance critere -> fichier)
Tous sous `tests/invitation-acceptance/` ; aides dans `tests/helpers/invitations-accept.ts`.

| Critere | Fichier |
|---|---|
| AC1, AC2, AC3, AC4 (API), AC5 (a), AC6 (rejeu), AC7, AC8, AC9, AC10 | `acceptance-api.test.ts` |
| AC4 (changement d'heure, bornes 168 h), AC5 (b, c, d), AC6 (deux transactions), AC7 (base), AC8 (SG008), AC9 (base), AC12 (SG002, empreintes hors bornes) | `acceptance-functions.test.ts` |
| AC4 (proconfig), AC12 (catalogue), AC13 (a, b, c, d) | `catalog.test.ts` |
| AC6 (deux POST simultanes) | `concurrency.test.ts` |
| AC11, AC14 | `token-leak.test.ts` |
| D-106, D-107, D-108 (reouverture D-111) | `decisions.test.ts` |
| Q-3 (D-102) | `tests/invitations/database.test.ts` (modifie, voir Decisions) |

AC14 « aucune dependance ajoutee » : verification ponctuelle de la fiche de preuves (usine 1.6.4, D-099), aucun test permanent. Le test AC14 ecrit ne porte que sur la variable d'environnement : la route ne cite pas la cle de scellement et ne lit pas `process.env`.

Etat de depart verifie (avant implementation) : les 11 tests de catalogue, les tests de fonctions (`42883`, fonction absente), et les tests d'API (route absente : `404` HTML de Next, code applicatif `undefined`) echouent tous pour l'absence de l'implementation ; `tests/invitations/*` (003) reste vert, test restreint compris ; `tsc` passe.

## Couches
- [x] Migration (`0015_accept_invitation.sql` : `lookup_invitation`, `accept_invitation`, politiques `signet_definer`, privileges) — e91446c ; `catalog.test.ts` 11/11, `acceptance-functions.test.ts` + `tests/invitations/database.test.ts` 33/33. `pnpm db:migrate` sur la base de developpement refuse (`DATABASE_URL_MIGRATE n'est pas definie`, deja connu, backlog D-067) : action humaine ; base de test migree par le globalSetup.
- [x] Titre du test AC15 de 003 corrige (D-104, decision humaine) — 17d38a8
- [x] Acces donnees — sans couche separee : les deux appels SQL vivent dans `lib/invitations/accept.ts` (patron de `lib/invitations/invitations.ts`, 003)
- [x] Logique metier (decodage strict, empreinte, traduction des codes) — 98258de (`token.ts` `linkTokenToHash`, `accept.ts`, `errors.ts`, contrat `invitations.ts` amende hors `minRole`)
- [x] API (`POST /api/invitations/accept`) — 36ac917 ; `tests/invitation-acceptance` 5 fichiers, 55/55
- [x] Documentation — 7f7b47f (ADR-0018 ; ADR-0003, 0011, 0017 ; ERD §0, §1, §2.1, §5, matrice, migrations, numerotation ; backlog ; registre D-104 a D-108)
- [x] UI — sans objet (tranche 012)
- [x] Suite complete verte + `pnpm run check` — `pnpm test` : 36 fichiers, 418 tests passes, 1 ignore (419) ; `pnpm typecheck` et `pnpm lint` verts apres 6fef16b (lint : `if (!control)` sur une promesse dans `acceptance-api.test.ts`, remplace par `control === undefined`, assertion inchangee). AC14 : aucun manifeste de dependances modifie (`git diff origin/main` vide sur `package.json`, `apps/web/package.json`, `packages/db/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`).
- Note : une premiere execution complete (avant la route) a vu `tests/stack-upgrade/lint-scope.test.ts` depasser 20 s sous charge ; vert a l'execution complete suivante, a surveiller.

## Blocages
Aucun. Les trois questions d'interpretation de `test-writer` sont tranchees par l'humain (D-110) selon la lecture retenue par les tests :
- **AC3, jeton vide** : `""` et `"   "` -> `404 INVITATION_NOT_FOUND` ; schema du contrat sans `min(1)`, `max(256)` -> `422`.
- **AC9 (base)** : forme libre (zero ligne, `SG002` ou `23503`), absence d'effet verifiee dans tous les cas.
- **AC10** : textes des messages laisses a l'implementeur, fixes par D-107.
Blocage de perimetre `_contract.ts` leve par l'humain (D-109).

## Decisions
- Gate d'ouverture : D-102 (Q-1 A, Q-2, Q-3, P-1 a P-7) et D-103 (condition de Q-3 reformulee : seule ecriture nouvelle = `UPDATE` borne a l'acceptation, AC13).
- **Q-3, seule modification d'un test existant (regle D-065 n°2)** : `tests/invitations/database.test.ts`, test « AC15 : invitation a la RLS activee ET forcee… ». Les assertions sont inchangees mais s'appliquent aux politiques dont `roles` contient `signet_app` (variable `appRows`), plus une assertion de presence d'au moins une politique `signet_app` ; l'assertion « aucune politique TO PUBLIC » reste sur toute la table, ainsi que la presence d'au moins une politique. Justification : 003 avait ecrit ce test comme etat de fin de 003 (« UPDATE : tranche 006 ») ; sans cette restriction, les trois politiques `signet_definer` de 0015 (D-103) le feraient echouer. Renforcement ou neutre, aucun affaiblissement : les politiques `signet_definer` sont couvertes par AC13 (`catalog.test.ts`). Le **titre** du test, devenu inexact, a ensuite ete corrige sur decision humaine (D-104, commit 17d38a8), sans toucher aux assertions.
- **AC13 (d) faisable, ecrit** : la connexion d'administration de test est superutilisateur, donc `SET LOCAL ROLE signet_definer` sans aucune appartenance de role (ADR-0007 respecte, transaction toujours annulee, `lc_messages = 'C'` pour des messages stables). Le test affirme aussi par un temoin positif que l'`UPDATE` legitime reussit (sinon les refus par privilege passeraient pour la mauvaise raison). Si la connexion d'administration cessait d'etre superutilisateur, le test echoue avec un message qui l'explique ; il faudrait alors le remplacer par (a) a (c) et l'ecrire ici.
- **AC3 « aucun appel a `accept_invitation` » : verrou plutot que compteur** : `pg_stat_user_functions` exige `track_functions`, reglage de cluster hors de la suite. Equivalent retenu : un verrou exclusif tenu sur `invitation` (connexion d'administration) pendant que des jetons malformes sont postes ; la route doit repondre `404` sans attendre la table, alors qu'un jeton bien forme (temoin) reste bloque jusqu'a la liberation du verrou. Les fichiers de test s'executent un a un (`fileParallelism: false`).
- **AC4, « une seconde dans le futur »** : ecrit avec **30 secondes** de marge, une latence HTTP superieure a une seconde rendrait le test instable. Le passage a l'heure d'hiver d'Europe/Paris depend de la date : pour rester independant de l'horloge du jour, les tests de changement d'heure utilisent `Europe/Paris` **et** des fuseaux POSIX construits a partir de la date du jour pour que `now() + interval '7 days'` y fasse 167 h sur la fenetre testee (precondition verifiee dans la session, sinon le test echoue en le disant) ; les dates sont forcees en base sous `TimeZone = 'UTC'`.
- **AC11, journaux du serveur** : le journal du serveur de test n'est pas lisible depuis la suite (le globalSetup n'en garde que la fin pour ses messages d'echec). Verifies : reponses HTTP, journaux du processus de test (console et sorties espionnees), colonnes des lignes `invitation` et `member`. A signaler au relecteur `security-auditor` : la fuite dans le journal du serveur se verifie par relecture du code de la route (jamais de `console.*` portant le jeton).
- **AC10, GET sur la route** : la route n'est definie que pour `POST` ; un `GET` doit rendre `404` ou `405` sans aucune donnee d'invitation.
- **Ecarts de test AC3 (verrou), AC4 (30 s), AC11 (journal serveur non lu)** : valides par l'humain (D-110).

### Implementation (implementeur, 2026-10-26)
- **D-104 (humain)** : titre du test AC15 de `tests/invitations/database.test.ts` corrige, aucune assertion modifiee (17d38a8).
- **D-105** : les deux fonctions effacent `app.organization_id` avant chaque retour (en plus de l'effacement en entree). Ecartes : laisser le contexte de l'invitation dans la transaction de l'appelant (patron 0012) ; clause `SET app.organization_id = ''` sur la fonction.
- **D-106** : decodage strict = motif + 32 octets + forme canonique (la reecriture base64url redonne le texte). Ecarte : motif et longueur seuls (quatre textes pour un meme jeton).
- **D-107** : textes fixes des messages (liste au registre) ; `ALREADY_MEMBER` a l'acceptation a son propre message (meme code que 003) ; 422 a un message unique, jamais celui de Zod.
- **D-108** : `pending` + adresse de l'invitation = adresse de session apres un refus -> `401` (compte disparu ou modifie dans la fenetre), sinon `403`. Ecartes : toujours `403` ; relire `app_user` sous `signet_app`.
- `accept_invitation` ecrit `accepted_by_user_id = v_user`, ou `v_user` est `current_user_id()` lu en premiere instruction (meme valeur que le texte du contrat, lue une fois) ; `WITH CHECK` de `invitation_definer_accept` la compare a `current_user_id()`.
- `SG008` n'est leve que pour `23505` sur `member_org_user_idx` (`GET STACKED DIAGNOSTICS ... CONSTRAINT_NAME`) ; toute autre violation d'unicite est relevee telle quelle (500).
- `lookup_invitation` leve (erreur sans code applicatif) si l'organisation de l'invitation est invisible : invariant (FK `ON DELETE CASCADE`), jamais une ligne a nom vide.
- Pas de couche d'acces aux donnees separee : les deux appels SQL sont dans `lib/invitations/accept.ts`, comme l'emission de 003 dans `lib/invitations/invitations.ts`.
- Erreur inattendue de la base : journalisee par son code seul (`[invitations] acceptation : erreur inattendue ... (code X)`), puis `throw` d'une erreur au message fixe (500 de Next, sans detail).
- D-105 a D-108 validees par l'humain (D-110).

### Orchestration (claude-code, 2026-10-26)
- **`.gates/current-slice` committe tard** : l'orchestrateur l'avait cru volontairement non suivi (absent de `main`, en realite retire par chaque cloture) et ne l'avait pas mis dans le commit d'ouverture, contrairement a 002 et 003 ; `close-slice.sh` a refuse la cloture (arbre non propre), seul echec, tous les controles etant verts. Committe avant la seconde execution de la cloture.
- **D-109** : `minRole` elargi a `"authenticated"` et `acceptInvitation` mis a jour, dans la session principale, a la demande explicite de l'humain, apres `scope-add` de `_contract.ts` (commits a4f8917, 8d7fde5).
- **Relectures** : `security-auditor` AUDIT: PASS (aucun CRITIQUE/MAJEUR/MINEUR ; INFO-1 a 3), `contract-guardian` CONTRACTS: PASS, `code-reviewer` REVIEW: PASS (5 A CORRIGER, 6 SUGGESTION) ; rapports tels quels dans `docs/04-runbooks/audits/{audit,contracts,review}-006.md`.
- **Suite donnee (D-110)** : A CORRIGER 1 a 3 et SUGGESTION 1 a 5 au backlog (tests manquants de D-106, D-108, D-107 ; ce ne sont pas des defauts de comportement, mais des decisions sans preuve automatique — a signaler a l'humain pour la fusion) ; A CORRIGER 4 (registre D-110, ce journal), 5 (FRICTION) et SUGGESTION 6 (renvois D-102, ADR-0018) traites dans la documentation par l'orchestrateur.

### Reouverture D-111 (implementeur, 2026-10-26)
Tests ajoutes dans `tests/invitation-acceptance/decisions.test.ts` (aides dans `tests/helpers/invitations-accept.ts` : `nonCanonicalVariants`, `loadAcceptModule`, `closeServerAppPool`, `waitForAcceptBlockedOnLock`) ; aucun test existant ni code de production modifie. Commit 34a0203.

Decisions locales :
- **Un fichier neuf plutot qu'un ajout a `acceptance-api.test.ts`** : les trois decisions ont leur propre motif de reouverture, et D-108 se teste hors de la route ; regroupees, elles se relisent et se mutent ensemble. Ecarte : disperser les cas dans AC3, AC9 et AC10 (les tests existants restent inchanges, regle de la mission).
- **D-107 : textes ecrits en clair dans le test, jamais importes de `lib/errors.ts`** : sinon un texte modifie modifierait aussi l'attendu et la mutation passerait. Le 401 (« Aucune session valide. ») n'est pas dans la liste de D-107 : c'est le texte de 002, verifie tel quel parce que la route le renvoie.
- **D-108 : `acceptInvitation` importee dans le processus de test** (chemin relatif, comme `process-stripe-event` et `send-invitation-email` deja charges par la suite), environnement du serveur de test pose par `applyServerEnvToProcess` (`DATABASE_URL_APP` de la base de test, jamais lu ni affiche) ; le pool de `lib/db.ts` est ferme en `afterAll`. Aucun alias `@/` dans `accept.ts`, `token.ts`, `errors.ts`, `db.ts` : aucun contournement necessaire.
- **D-108, branche `pending` + meme adresse** : atteinte avec un `userId` sans ligne `app_user` (compte supprime, puis UUID jamais cree) : la sous-requete d'adresse de l'`UPDATE` rend NULL, zero ligne, `lookup_invitation` rend `pending`. Verifie aussi avec l'adresse de session en casse differente.
- **`SG002` atteignable** : `userId = ""` -> `app.user_id` vide -> `current_user_id()` NULL -> `SG002`.
- **`23503` atteignable, de facon deterministe** : une suppression du compte non validee est tenue (connexion d'administration, `lock_timeout` 10 s) ; l'`UPDATE` voit encore la ligne `app_user`, puis la verification de la cle etrangere `invitation.accepted_by_user_id` attend le verrou de ligne ; une fois l'attente constatee dans `pg_stat_activity` (`wait_event_type = 'Lock'`), la suppression est validee et la verification echoue en `23503`. Le code reellement leve a ete lu dans le journal de la mutation (voir ci-dessous). Ecarte : ne couvrir que `SG002` (la moitie de `IDENTITY_LOST` resterait sans preuve).

Preuves par mutation (code de production modifie temporairement, test lance, puis restaure ; `git diff -- apps packages` vide verifie avant le commit ; aucune mutation committee) :

| Decision | Mutation | Test(s) en echec | Message |
|---|---|---|---|
| D-106 | `token.ts` : condition `secret.toString("base64url") !== token` retiree | « D-106 (unitaire) : linkTokenToHash rend l'empreinte… » ; « D-106 (API) : les variantes non canoniques d'un jeton reellement emis… » | unitaire : `variante non canonique "9" : refusee: expected Buffer[ 63, 58, … ] to be null` ; API : `D-106 : variante "Z" : HTTP 200 recu, 404 attendu. Corps brut : {"organizationId":"…","role":"member"}` (la variante etait acceptee comme le vrai jeton) |
| D-107 (texte) | `errors.ts` : message 410 raccourci a « Cette invitation a expire. » | « D-107 : 410 INVITATION_EXPIRED a le corps exact du registre » | `corps exact de D-107 … expected … to strictly equal …`, message attendu / recu affiches |
| D-107 (422 Zod) | `route.ts` : `validationFailed(parsed.error.message)` au lieu du message fixe | « D-107 : 422 VALIDATION_FAILED au corps strictement identique et exact… » | `D-107 422 : token absent : corps exact de D-107` ; recu : le tableau d'issues de Zod (`"expected": "string"`, `"path": ["token"]`, `Invalid input: expected string, received undefined`) |
| D-108 (ternaire) | `accept.ts` : branche `pending` forcee a `fail(invitationEmailMismatch())` | « D-108 : userId sans ligne app_user … -> 401 … ; adresse differente -> 403 … » | `D-108 compte supprime, meme adresse` : attendu 401 `UNAUTHENTICATED`, recu 403 `INVITATION_EMAIL_MISMATCH` |
| D-108 (`IDENTITY_LOST`) | `accept.ts` : bloc `IDENTITY_LOST.has(code)` -> 401 supprime | « D-108 / SG002 : identifiant de session vide… » ; « D-108 / 23503 : compte supprime pendant l'acceptation… » | les deux : `Error: acceptation d'invitation : erreur inattendue (accept_invitation)` ; journal du processus : `(code SG002)` puis `(code 23503)` |

Resultats apres restauration : `decisions.test.ts` 12/12 ; `pnpm test` 37 fichiers, 430 passes, 1 ignore (431) ; `pnpm typecheck` et `pnpm run check` (typecheck + eslint) verts.

- **Relecture de la reouverture, A CORRIGER 1 (`review-006.md`)** : le test 422 de D-107 recoit quatre corps JSON valides non objets (`[]`, `null`, `"texte"`, `42`), qui couvrent la branche `typeof body !== "object" || body === null || Array.isArray(body)` de `route.ts` ; ils rendent le meme corps 422 que les autres entrees. Mutation : `validationFailed(body === undefined ? INVALID_BODY : "Objet JSON attendu.")` -> le test echoue (`D-107 422 : JSON valide non objet : tableau : corps exact de D-107 (corps brut : {"code":"VALIDATION_FAILED","message":"Objet JSON attendu."})`), 1 echec sur 12 ; route restauree, `git diff -- apps packages` vide. Apres restauration : `decisions.test.ts` 12/12 ; `pnpm test` 37 fichiers, 430 passes, 1 ignore (431) ; `pnpm typecheck` et `pnpm run check` verts. Commit d52b6e4. Aucune decision hors contrat.
