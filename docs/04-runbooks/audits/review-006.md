# Relecture de code, tranche 006 : acceptation d'une invitation

Perimetre relu : `git diff eb0dae0..HEAD`, sans le commit `1bb5acd` (usine 1.6.4, D-101). J'ai lu le contrat 006, le journal `006-progress.md`, le registre D-101 a D-109, ADR-0003, 0011, 0017 et 0018, ERD, `CLAUDE.md` et `.claude/rules/*`. Je n'ai pas lance `pnpm test` : je reprends les resultats de l'orchestrateur (418 passes, 1 ignore ; typecheck et `pnpm run check` verts).

## Ce qui a ete verifie et tient

- **Migration 0015.**
  - La decision tient dans un seul `UPDATE` conditionnel. La lecture prealable ne sert qu'a poser le contexte.
  - `SG008` n'est leve que pour `member_org_user_idx`, et tout est annule par l'exception.
  - Les deux fonctions ont `TimeZone = 'UTC'` et un `search_path` fige. `REVOKE` est fait pour `PUBLIC`, `EXECUTE` est accorde a `signet_app` seul.
  - Le privilege `UPDATE` ne porte que sur deux colonnes. Les politiques sont `TO signet_definer` et n'appellent jamais `current_org(`.
  - `now()` est l'heure de debut de transaction, donc `accept_invitation` et `lookup_invitation` comparent l'expiration au meme instant : aucune incoherence 410 / 403 a la borne.
  - Course entre deux acceptations : le verrou de ligne et la reevaluation en `READ COMMITTED` donnent bien 200 et 409 `INVITATION_ALREADY_USED`.
- **Application.**
  - Ordre dans la route : session, puis Zod, puis decodage strict, puis empreinte des octets (D-090), puis acceptation sous point de sauvegarde, puis lecture de distinction apres l'echec.
  - Aucun `throw` pour un cas metier. Aucun `any`, aucun `// TODO`, aucune dependance ajoutee, aucune comparaison a `main` dans les tests.
- **Modifications de tests existants.**
  - `tests/invitations/database.test.ts`, regle D-065 n°2 : les assertions sont identiques, appliquees a `appRows`. L'absence de politique `TO PUBLIC` reste verifiee sur toute la table. Une assertion de presence d'une politique `signet_app` est ajoutee, ce qui ferme le cas d'un filtre vide. Le titre est corrige par D-104. Le test des privileges est inchange. Pas d'affaiblissement sur `signet_app` ni sur `signet_definer` (couvert par AC13 b) ; seul residu, voir SUGGESTION 4.
  - Commit `6fef16b` : `!control` devient `control === undefined` sur une variable de type `Promise | undefined`. C'est strictement equivalent, l'assertion est inchangee.
- **Tests qui discriminent vraiment.**
  - AC3 (verrou) : un jeton malforme qui passerait en base resterait bloque.
  - AC4 (fuseau construit pour donner 167 h) : il echouerait sans `SET TimeZone`.
  - AC6 : deux transactions avec attente prouvee, plus quatre tours HTTP.
  - AC13 (d) : un temoin positif montre que les refus ne viennent pas d'une mauvaise raison.
  - AC5 (b) et (c) : contexte etranger force.
  - AC12 : catalogue exact.
- **Documentation.** ADR-0018, renvois ADR-0003/0011/0017, ERD (§0, §1, §2.1, §5, matrice, migrations, numerotation), contrats, backlog, D-102 a D-109 : tout est present dans la meme PR.

## Constats

### A CORRIGER 1 : decision D-106 (forme canonique du jeton) sans aucun test
- **Emplacement** : `apps/web/src/lib/invitations/token.ts:89` (`secret.toString("base64url") !== token`) ; `tests/invitation-acceptance/acceptance-api.test.ts:121-133`.
- **Constat** : aucun des cas d'AC3 n'est un texte de 43 caracteres de l'alphabet base64url qui decode en 32 octets sans etre canonique, c'est-a-dire le vrai jeton avec un dernier caractere dont seuls les 2 bits ignores changent. Si on supprime la condition canonique, toute la suite reste verte, et un tel texte serait accepte comme le vrai jeton.
- **Consequence** : D-106 est une decision ecrite, mais rien ne la verrouille. Le risque n'est pas un acces sans le secret, mais une regression qui passerait inapercue.
- **Direction** : ajouter a la liste d'AC3 une variante non canonique du jeton emis, qui doit donner 404 avec un corps identique et rien de consomme. `token.ts` est un module pur, donc un test unitaire direct est aussi possible.

### A CORRIGER 2 : branche D-108 (`pending` + meme adresse -> 401) et traduction `SG002`/`23503` -> 401 jamais executees par un test
- **Emplacement** : `apps/web/src/lib/invitations/accept.ts:96-99` et `:129-131`.
- **Constat** : le test API d'AC9 (`acceptance-api.test.ts:332`) supprime le compte avant l'appel. La session disparait en cascade et la route repond 401 des `getSession`, avant tout appel SQL. Ni la branche D-108 ni la branche `IDENTITY_LOST` ne sont donc atteintes. Si on inverse la ternaire D-108 (toujours 403) ou qu'on supprime `IDENTITY_LOST`, aucun test n'echoue.
- **Consequence** : une decision du registre (D-108) n'a pas de preuve automatique. Le contrat (`invitations.ts`, erreur 401) promet ce comportement.
- **Direction** : appeler `acceptInvitation` de `lib/invitations/accept.ts` depuis le processus de test, avec un `userId` sans ligne `app_user` et `sessionEmail` egal a l'adresse invitee. Attendre `401 UNAUTHENTICATED`, puis le meme appel avec une autre adresse : 403. A defaut, ecrire la limite dans le journal et le registre.

### A CORRIGER 3 : AC10 « test sur la liste exacte des corps d'erreur » : les textes de D-107 ne sont pas verifies, et le 422 « message unique » non plus
- **Emplacement** : `tests/invitation-acceptance/acceptance-api.test.ts:399-440`.
- **Constat** : le test verifie que le corps est identique entre deux invitations et qu'il ne contient aucun secret, mais pas les textes que D-107 fige au registre. Le test 422 ne verifie que le statut et le code : cinq messages differents, ou le message de Zod, passeraient, alors que D-107 ecrit « 422 un seul message fixe, jamais celui de Zod ».
- **Consequence** : D-107 et la derniere phrase d'AC10 n'ont pas de preuve. Un changement de texte, ou le retour du message Zod qui reprend la structure de l'entree, ne serait pas detecte.
- **Direction** : comparer chaque corps a la liste exacte de D-107 (statut, code, message), et exiger un corps 422 identique pour les cinq entrees invalides.

### A CORRIGER 4 : arbitrages humains de la tranche absents du registre ; journal encore en « a confirmer »
- **Emplacement** : `docs/DECISIONS.md` (D-102 a D-109) ; `docs/03-slices/006-progress.md:40-44` et `:48`.
- **Constat** :
  - Les ecarts de test que l'orchestrateur dit valides par l'humain ne sont ecrits nulle part comme decision humaine : AC3 verrou au lieu du compteur, AC4 marge de 30 s au lieu de 1 s, AC11 journal serveur non lu, AC3 chaine vide -> 404, AC9 forme libre. Seule D-107 mentionne « lecture AC10 validee par l'humain », et le commentaire du contrat `invitations.ts` le fait pour la chaine vide.
  - La section « Blocages » du journal presente toujours ces points comme « questions a confirmer ».
  - La ligne 48 dit que le titre du test AC15 « n'a pas ete modifie », alors que D-104 et `17d38a8` l'ont corrige.
  - D-105 a D-108 portent le decideur « claude-code » sans mention de leur validation par l'humain.
- **Consequence** : un auditeur voit des AC coches (AC4 dit « une seconde dans le futur ») avec des tests qui s'en ecartent, sans trace de l'accord humain. C'est contraire a `rules/documentation.md` (« Decision humaine... registre, decideur humain »).
- **Direction** : une ligne de registre pour ces arbitrages (decideur humain, options, raison), mention de la validation sur D-105 a D-108, et mise a jour des sections « Blocages » et « Decisions » du journal.

### A CORRIGER 5 : nouvelle occurrence du depassement de delai de `lint-scope.test.ts` non consignee
- **Emplacement** : `docs/04-runbooks/FRICTION.md:61`.
- **Constat** : l'entree du 2026-10-20 dit « delai a revoir si cela se repete ». Ca s'est repete pendant cette tranche (journal, ligne 38), mais seul le journal de tranche le note.
- **Direction** : ajouter l'occurrence du 2026-10-26 a `FRICTION.md` (le fichier est dans le perimetre), pour qu'on puisse decider sur le delai.

### SUGGESTION 1 : comparaison d'adresse : `lower()` de Postgres et `toLowerCase()` de JS
- **Emplacement** : migration 0015 `:236` ; `accept.ts:129` ; `contracts.ts:17`.
- **Constat** : l'adresse invitee est normalisee en JS. Le predicat SQL applique `lower()`, qui depend de la collation et du `ctype` de la base ; sous `C`, seul l'ASCII est mis en minuscules. Le motif `normalizedEmail` accepte le non-ASCII. Aujourd'hui, better-auth normalise l'adresse avant de l'ecrire, ce qui masque l'ecart.
- **Direction** : le documenter dans ADR-0018, ou ajouter un test d'AC7 avec une adresse non ASCII en casse mixte.

### SUGGESTION 2 : D-105 ne dit pas que le contexte de l'appelant est detruit
- **Emplacement** : migration 0015 `:113`, `:208` ; D-105.
- **Constat** : l'effacement en entree remet `app.organization_id` a vide sans le restaurer. Un appel futur depuis une transaction tenant perdrait son contexte : l'echec est ferme, mais silencieux.
- **Direction** : ecrire cette consequence dans D-105 et ERD §1, puisque l'option ecartee, `SET app.organization_id = ''` sur la fonction, la restaurait.

### SUGGESTION 3 : AC14 ne verifie que le dossier de la route
- **Emplacement** : `tests/invitation-acceptance/token-leak.test.ts:162-174`.
- **Constat** : `lib/invitations/accept.ts`, ou se trouve toute la logique, n'est pas lu. Une lecture de `INVITATION_TOKEN_KEY` ajoutee la ne serait pas detectee.
- **Direction** : etendre le balayage a `accept.ts` et `token.ts` (nom de la cle seulement, car `accept.ts` passe par `db`).

### SUGGESTION 4 : residu de la restriction Q-3
- **Emplacement** : `tests/invitations/database.test.ts:334-344`.
- **Constat** : une politique `TO signet_auth`, `signet_billing` ou `signet_owner` sur `invitation` n'est plus detectee par aucun test. Ce n'est pas exploitable aujourd'hui, ces roles n'ayant aucun privilege, mais c'etait couvert avant.
- **Direction** : dans `catalog.test.ts` (sans retoucher 003), affirmer que l'ensemble des roles des politiques de `invitation` est contenu dans `{signet_app, signet_definer}`.

### SUGGESTION 5 : code mort dans les helpers
- **Emplacement** : `tests/helpers/invitations-accept.ts:169` et `:176`.
- **Constat** : `signUpWithEmail` n'est utilise nulle part. Dans `mixedCase`, `.replace(/\.TEST$/, ".TEST")` ne fait rien, le domaine etant deja en majuscules.
- **Direction** : supprimer les deux.

### SUGGESTION 6 : renvois a completer
- **Constat** : ADR-0018 (statut, decisions du registre) ne cite pas D-109, alors que la modalite 1 en est l'objet. D-102 renvoie encore a « ADR-0018 (a ecrire) ».
- **Direction** : ajouter D-109 a l'ADR et mettre le lien de D-102 a jour.

## Historique
Les messages respectent Conventional Commits et font moins de 72 caracteres. Il y a un commit par couche (tests, migration, logique, route, documentation), et le journal est mis a jour apres chaque couche. La correction du test de 003 est dans son propre commit (`17d38a8`), et le pourquoi figure dans les corps de message quand il n'est pas evident. Rien a signaler.

## Bilan
- **Solide** : la consommation atomique et le rapprochement d'adresse sont portes par la base. Le catalogue est verrouille (AC12, AC13 avec volet comportemental). Les tests de concurrence, d'isolation et de changement d'heure echoueraient vraiment si le code etait faux. La documentation d'architecture est complete et dans la meme PR.
- **Fragile** : trois decisions locales (D-106 forme canonique, D-107 textes fixes, D-108 choix 401/403) n'ont aucun test qui echouerait si on les retirait. La comparaison d'adresse repose sur la normalisation faite par better-auth.
- **Manquant** : les arbitrages humains sur les ecarts de test ne sont pas au registre, le journal est encore en « a confirmer », et la nouvelle occurrence du delai depasse n'est pas dans FRICTION.

REVIEW: PASS
