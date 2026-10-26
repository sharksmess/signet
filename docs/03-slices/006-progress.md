# 006 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : implementation terminee ; suite complete verte, `pnpm run check` vert ; AC1 a AC14 coches
- Branche : slice/006-acceptation-invitation
- Dernier commit : voir `git log` (contrat `minRole` apres 23828ff)
- Prochaine etape : trois relecteurs (`security-auditor`, `contract-guardian`, `code-reviewer`), journal de projet 19, `close-slice.sh`, `ship-slice.sh`
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
Aucun bloquant. Questions d'interpretation (a confirmer par l'implementeur ou l'orchestrateur, tests ecrits selon la lecture indiquee) :
- **AC3, jeton vide** : AC3 demande `404` pour une « chaine vide apres `trim` », alors que le contrat cite `z.string().min(1)` et AC10/Perimetre reservent `422` a « token absent, non textuel, ou > 256 caracteres ». Lecture retenue : `""` et `"   "` donnent `404 INVITATION_NOT_FOUND` (pas `422`). Si l'intention est `422` pour la chaine vide, modifier AC3 et le test.
- **AC9 (base)** : le critere dit « ne consomme rien et ne cree aucun `member` » sans fixer la forme (zero ligne, ou erreur). Le test accepte zero ligne, ou `SG002` / `23503`, et verifie l'absence d'effet dans tous les cas.
- **AC10 « liste exacte des corps d'erreur »** : les textes des messages ne sont pas fixes par le contrat. Le test exige, pour chaque couple (statut, code), un corps `{ code, message }` seulement, **identique** pour deux invitations differentes, sans adresse, nom d'organisation, identifiant ni code SQL. Si l'orchestrateur veut figer les textes, les ecrire dans le contrat et le test.

## Decisions
- Gate d'ouverture : D-102 (Q-1 A, Q-2, Q-3, P-1 a P-7) et D-103 (condition de Q-3 reformulee : seule ecriture nouvelle = `UPDATE` borne a l'acceptation, AC13).
- **Q-3, seule modification d'un test existant (regle D-065 n°2)** : `tests/invitations/database.test.ts`, test « AC15 : invitation a la RLS activee ET forcee… ». Les assertions sont inchangees mais s'appliquent aux politiques dont `roles` contient `signet_app` (variable `appRows`), plus une assertion de presence d'au moins une politique `signet_app` ; l'assertion « aucune politique TO PUBLIC » reste sur toute la table, ainsi que la presence d'au moins une politique. Justification : 003 avait ecrit ce test comme etat de fin de 003 (« UPDATE : tranche 006 ») ; sans cette restriction, les trois politiques `signet_definer` de 0015 (D-103) le feraient echouer. Renforcement ou neutre, aucun affaiblissement : les politiques `signet_definer` sont couvertes par AC13 (`catalog.test.ts`). Le **titre** du test (« aucune politique signet_definer, aucun UPDATE ») n'a pas ete modifie (consigne : rien d'autre dans le fichier) ; il est devenu inexact sur ces deux mots et pourra etre corrige par l'humain ou par une tranche ulterieure.
- **AC13 (d) faisable, ecrit** : la connexion d'administration de test est superutilisateur, donc `SET LOCAL ROLE signet_definer` sans aucune appartenance de role (ADR-0007 respecte, transaction toujours annulee, `lc_messages = 'C'` pour des messages stables). Le test affirme aussi par un temoin positif que l'`UPDATE` legitime reussit (sinon les refus par privilege passeraient pour la mauvaise raison). Si la connexion d'administration cessait d'etre superutilisateur, le test echoue avec un message qui l'explique ; il faudrait alors le remplacer par (a) a (c) et l'ecrire ici.
- **AC3 « aucun appel a `accept_invitation` » : verrou plutot que compteur** : `pg_stat_user_functions` exige `track_functions`, reglage de cluster hors de la suite. Equivalent retenu : un verrou exclusif tenu sur `invitation` (connexion d'administration) pendant que des jetons malformes sont postes ; la route doit repondre `404` sans attendre la table, alors qu'un jeton bien forme (temoin) reste bloque jusqu'a la liberation du verrou. Les fichiers de test s'executent un a un (`fileParallelism: false`).
- **AC4, « une seconde dans le futur »** : ecrit avec **30 secondes** de marge, une latence HTTP superieure a une seconde rendrait le test instable. Le passage a l'heure d'hiver d'Europe/Paris depend de la date : pour rester independant de l'horloge du jour, les tests de changement d'heure utilisent `Europe/Paris` **et** des fuseaux POSIX construits a partir de la date du jour pour que `now() + interval '7 days'` y fasse 167 h sur la fenetre testee (precondition verifiee dans la session, sinon le test echoue en le disant) ; les dates sont forcees en base sous `TimeZone = 'UTC'`.
- **AC11, journaux du serveur** : le journal du serveur de test n'est pas lisible depuis la suite (le globalSetup n'en garde que la fin pour ses messages d'echec). Verifies : reponses HTTP, journaux du processus de test (console et sorties espionnees), colonnes des lignes `invitation` et `member`. A signaler au relecteur `security-auditor` : la fuite dans le journal du serveur se verifie par relecture du code de la route (jamais de `console.*` portant le jeton).
- **AC10, GET sur la route** : la route n'est definie que pour `POST` ; un `GET` doit rendre `404` ou `405` sans aucune donnee d'invitation.

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
