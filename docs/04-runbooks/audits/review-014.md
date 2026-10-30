# code-reviewer — tranche 014

## 2026-10-30

# Relecture code-reviewer — tranche 014 (preuve du controle d'origine de better-auth)

Branche `slice/014-controle-origine`, diff `git diff main...HEAD` (6 commits, 12 fichiers : `tests/auth/origin.test.ts` nouveau, commentaire de `tests/helpers/auth.ts`, documentation, `.gates/`). Comportement de reference relu dans le code installe de better-auth 1.7.7 : `dist/api/middlewares/origin-check.mjs` (`validateFormCsrf`, `validateOrigin`), `dist/api/index.mjs:157-162` (`originCheckMiddleware` global sur `/**`), `dist/context/create-context.mjs:211` (`skipOriginCheck` = `isTest()` par defaut), `dist/context/helpers.mjs:60-86` (`getTrustedOrigins`), et `tests/_factory/env.ts:84-96` (`buildServerEnv`). Resultats de suite repris de l'orchestrateur, sans `pnpm test` de mon cote.

## Exactitude des tests face au code de better-auth (AC1 a AC6)

J'ai suivi chaque cas dans `validateFormCsrf`/`validateOrigin` :
- **AC1 et AC2** (`Origin: https://piege.invalid`, envoye par `fetch`) : la requete porte `sec-fetch-mode`, donc `validateOrigin(ctx, true)` est appele. `piege.invalid` n'est pas dans la liste de confiance (origine deduite de la requete, aucune option `trustedOrigins`) : `403 INVALID_ORIGIN`. Les assertions portent sur le statut exact et le `code` exact, puis sur l'absence de cookie `session_token` et l'etat en base (`app_user` et `account` par adresse unique ; nombre de `session` avant et apres pour l'utilisateur). Ce n'est pas un faux vert : si undici retirait l'`Origin`, le code obtenu serait `MISSING_OR_NULL_ORIGIN` et le test echouerait. AC2 utilise les **bons** identifiants. AC3 prouve que le meme corps passe avec la bonne origine, donc le refus vient bien de l'origine.
- **AC3** : controle positif reel (`200`, cookie de session, ligne `app_user`, une session de plus). Sans lui, AC1 et AC2 pourraient passer avec un serveur qui refuse tout.
- **AC4** (`Origin: null`) : `headers.get("origin")` vaut `"null"`, valeur vraie, donc validation forcee. `sec-fetch-site` est absent (undici ne pose que `sec-fetch-mode`), donc pas d'origine deduite : `MISSING_OR_NULL_ORIGIN`. C'est exact.
- **AC5** : le test ne verifie pas lui-meme que Node envoie `sec-fetch-mode: cors`. Mais si Node cessait de l'envoyer, la requete serait acceptee et le test echouerait (alarme juste, pas faux vert). Acceptable.
- **AC6** : `sentHeaders` vient de `req.getHeaders()`, c'est-a-dire les en-tetes poses par le client. Ce ne sont pas les en-tetes recus par le serveur ; `node:http` n'ajoute sur le reseau que `Host` et `Connection`. Le resultat observe (`200`, session, compte) ne peut de toute facon s'obtenir, d'apres le code, que si le serveur n'a recu ni `Cookie`, ni `Sec-Fetch-Site/Mode/Dest`, ni `Origin`/`Referer` non fiable. Le controle client et le resultat serveur se completent : **la verification est suffisante**.
- Isolation entre tests : toutes les lectures sont filtrees par adresse unique (`@example.test`) ou par `user_id` cree par le test. Aucun comptage global, donc pas de course entre fichiers paralleles.
- Conformite : aucun `any`, aucun `// TODO`. Valeurs visiblement fausses (`piege.invalid`, `mot-de-passe-de-test`, `@example.test`). Aucune comparaison a `main` dans les tests. Le commit 0c77127 ne contient que le fichier de tests et 5ba6979 que le commentaire (verifie par `git show --stat`). Aucun fichier sous `apps/`, `packages/`, `tests/_factory/`, aucun manifeste, aucune configuration.

## Constats

### A CORRIGER 1 — Le constat d'AC6 n'est pas au backlog, et les points 2 et 3 de D-146 y sont toujours « ouvert »
- **Emplacement** : `docs/03-slices/000-backlog.md:168` (points 2 et 3 « ouvert ») ; aucune entree pour le passage sans controle d'un client sans en-tete de navigateur. Contrat `docs/03-slices/014-controle-origine.md:58`, AC6 coche `[x]`.
- **Constat** : la consigne (`docs/04-runbooks/consigne-run-queue-014.md:134`) dit : « si elle est acceptee, inscris au backlog ce que cela implique ». Elle a ete acceptee (`200`, session posee, compte cree, journal du passage). Le diff du backlog n'ajoute que la ligne 014 et l'ordre d'execution. La consigne (ligne 124) prevoit aussi de passer les points 2 et 3 de D-146 a « fait (tranche 014) » a la cloture.
- **Consequence** : AC6 est coche alors qu'une partie de son obligation documentaire manque. Un auditeur qui lit le backlog croit encore le test d'origine absent, et ne voit nulle part le passage sans controle a re-decider avant la mise en ligne. Ce passage depend notamment de l'arbitrage avec l'entree D-144 Q-2 (ligne 159).
- **Direction** : avant `close-slice.sh`, dans la meme PR : ajouter une entree backlog « a valider par l'humain » (le constat, pourquoi ce n'est pas du CSRF, et le fait qu'un client hors navigateur peut s'inscrire et se connecter sans controle d'origine). Passer les points 2 et 3 de D-146 a « fait (tranche 014) ». Faute de quoi ce constat deviendrait bloquant.

### A CORRIGER 2 — Le commentaire d'`originHeader()` est inexact a la marge sur ce que better-auth « refuse vraiment » (AC7)
- **Emplacement** : `tests/helpers/auth.ts:26-28` (puce `MISSING_OR_NULL_ORIGIN`) et `:23-29` (liste des refus).
- **Constat**, compare a `origin-check.mjs` :
  (a) La phrase « origine absente ou `null` alors que la requete porte un indice de navigateur (`Sec-Fetch-*`, `Origin`/`Referer`) » se contredit pour `Origin` et `Referer`. Si `Origin` est present, l'origine n'est pas absente. Un `Referer` seul sert d'origine et donne `INVALID_ORIGIN` ou une acceptation, jamais `MISSING_OR_NULL_ORIGIN`. Seul `Origin: null` declenche ce code par cette voie.
  (b) Exception non dite : `Origin: null` avec `Sec-Fetch-Site: same-origin` est **accepte**, car better-auth deduit alors l'origine de la requete (`inferredBaseURL`).
  (c) Le troisieme refus, `Sec-Fetch-Site: cross-site` avec `Sec-Fetch-Mode: navigate` (`403 CROSS_SITE_NAVIGATION_LOGIN_BLOCKED`), est absent, alors que le contrat (ligne 13) le decrit.
  (d) `Sec-Fetch-*` est plus large que le code, qui ne lit que `Site`, `Mode` et `Dest`.
- **Consequence** : AC7 exige un commentaire « exact ». Le nouveau commentaire est nettement meilleur que l'ancien, et sa partie principale est juste (`INVALID_ORIGIN`, raison de l'en-tete `Origin`, usine D-033, renvoi a la tranche 014). Mais un lecteur qui s'y fie se trompe sur ces cas limites, et c'est precisement le defaut que D-146 point 3 voulait corriger.
- **Direction** : reformuler la puce (`Origin: null`, ou `Origin`/`Referer` absents alors que `Sec-Fetch-Site/Mode/Dest` ou un cookie sont presents, donnent `MISSING_OR_NULL_ORIGIN`, sauf `null` avec `same-origin`), ajouter `CROSS_SITE_NAVIGATION_LOGIN_BLOCKED`, et nommer les trois en-tetes. Le cout est faible et ne touche que le commentaire.

### SUGGESTION 1 — Le commentaire du helper n'explique plus pourquoi `authHeaders` pose aussi `Origin`
- **Emplacement** : `tests/helpers/auth.ts:23-24` (portee « `sign-up/email` et `sign-in/email` ») et `:109` (`authHeaders` : `Cookie` + `originHeader()`).
- **Constat** : l'ancien commentaire parlait de « toute requete vers `/api/auth/*` ». Le nouveau se limite aux deux routes de `formCsrfMiddleware`. Or `originCheckMiddleware`, installe sur `/**` (`dist/api/index.mjs:160`), valide l'origine de **tout** `POST` de better-auth qui porte un cookie. C'est la raison pour laquelle `authHeaders` doit poser `Origin`.
- **Direction** : ajouter une phrase sur ce second controle (requetes avec cookie, toutes routes `POST` de better-auth).

### SUGGESTION 2 — `viaHttp` : lisibilite et hypotheses implicites
- **Emplacement** : `tests/auth/origin.test.ts:190-223`.
- **Constat** : `sent` est utilise dans le rappel (ligne 213) avant sa declaration (ligne 219). C'est correct, car le rappel s'execute plus tard, mais un lecteur y voit d'abord une zone morte temporelle. Par ailleurs, `viaHttp` ignore le protocole et le chemin de `baseUrl()`, alors que `viaFetch` les conserve : la fonction suppose `http` et une base sans chemin.
- **Direction** : calculer `sent` avant le rappel, ou ajouter un commentaire. Construire le chemin a partir de `target`, ou ecrire l'hypothese `http:` en clair.

### SUGGESTION 3 — Dire en tete d'AC6 ce que signifie son echec futur
- **Emplacement** : `tests/auth/origin.test.ts:230`.
- **Constat** : AC6 fige un comportement **permissif**. Si une montee de better-auth ferme ce passage, le test virera au rouge alors que le changement sera favorable.
- **Direction** : un commentaire d'une ligne : « echec ici = comportement de better-auth change ; re-decider (D-158), ne pas forcer le test ».

### SUGGESTION 4 — Les messages d'echec recopient les `Set-Cookie` en clair
- **Emplacement** : `tests/auth/origin.test.ts:47` (`describeObserved`).
- **Constat** : en cas d'echec, la valeur complete du jeton de session de test part dans la sortie, y compris celle de la CI. Les comptes et le serveur sont jetables, donc l'enjeu est faible. Mais la regle « jamais logge » est plus simple a tenir sans exception.
- **Direction** : ne journaliser que le nom des cookies.

### SUGGESTION 5 — Coherence de la documentation de preuve
- **Emplacement** : `docs/03-slices/014-progress.md:8` et `:19` ; `docs/04-runbooks/FRICTION.md` (ligne du 2026-10-30, suite 014).
- **Constat** :
  (a) Le journal annonce « 12 fichiers, 441 insertions ». Depuis a8c05b1, `git diff --stat main...HEAD` donne 452 insertions, et le « dernier commit » du journal ne cite plus le vrai dernier commit.
  (b) La friction parle d'une limite de 180 s pour une commande au premier plan, alors que l'entree du 2026-10-29 parle de 600 s. Un auditeur ne sait pas laquelle croire.
- **Direction** : relever le `--stat` definitif au moment de remplir `## Complements` de la fiche de preuves. Preciser l'origine du chiffre de 180 s, ou l'aligner.

## A faire figurer dans la ligne de registre des suites de relecture (orchestrateur)
- Le resultat **observe** d'AC6 (client `node:http` sans indice de navigateur : `200`, session posee, compte cree), conforme a la lecture du code et toujours a valider par l'humain avec D-158.
- La decision de l'implementeur de relancer une seule fois la suite (`tests/billing/processing.test.ts` AC3 (e), depassement de delai), avec sa raison et les options ecartees.
- Les points 2 et 3 de D-146 passes a « fait (tranche 014) ».
- Les cas non prouves (`Referer` seul, `CROSS_SITE_NAVIGATION_LOGIN_BLOCKED`, `Origin: null` avec `same-origin`).
- Les suites donnees aux constats ci-dessus.

## Historique
Conventional Commits respectes, un commit pour les tests et un pour le commentaire, trailer `Slice: 014` present. Les corps de commit sont vides, mais le pourquoi est porte par le contrat et le journal, ce qui est acceptable pour une tranche de documentation et de tests.

## Bilan
- Solide : tests d'AC1 a AC6 justes au regard du code de better-auth 1.7.7, assertions exactes (statut, `code`, cookie, base), controle positif qui ecarte un faux vert, AC6 bien verifie, diff strictement borne aux tests et a la documentation.
- Fragile : le commentaire d'`originHeader()` reste inexact sur les cas limites (`Referer`, `null` avec `same-origin`, navigation entre sites), et AC6 fige un comportement permissif sans dire quoi faire s'il change.
- Manquant : l'entree backlog du constat d'AC6 et le passage des points 2 et 3 de D-146 a « fait », a ajouter dans la PR avant la cloture.

REVIEW: PASS
