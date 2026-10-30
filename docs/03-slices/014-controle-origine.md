# 014 — Preuve du controle d'origine de better-auth (tranche technique)

> **Statut : ouverte en mode autonome le 2026-10-30** (`/run-queue`, budget : cette seule tranche), selon `docs/04-runbooks/consigne-run-queue-014.md` (D-157). Tranche **de tests et de documentation seulement**. Le contrat n'attend pas de validation humaine avant l'implementation (precedent D-027) : les lectures de l'orchestrateur qui ne viennent ni des sources ni de D-157 sont inscrites au registre comme **a valider par l'humain** (D-158).

## Capacite
En tant qu'exploitant de Signet, je dispose d'une preuve executable que better-auth 1.7.7 refuse, sur le serveur de test, une inscription ou une connexion par e-mail envoyee depuis une origine etrangere, sans poser de session ni creer de compte. Jusqu'ici, ce controle etait affirme mais jamais prouve : le serveur de test heritait `TEST=true` de Vitest et better-auth sautait le controle (FRICTION 2026-10-28, D-146). L'usine 1.6.5 a retire `TEST` et `VITEST` de l'environnement du serveur de test (usine D-033, D-156). Cette tranche ajoute la preuve et corrige le commentaire inexact de `tests/helpers/auth.ts` (D-146, points 2 et 3).

## Comportement de better-auth 1.7.7, lu dans le code installe
Sources : `node_modules/.pnpm/better-auth@1.7.7_*/node_modules/better-auth/dist/api/middlewares/origin-check.mjs`, `dist/context/create-context.mjs`, `dist/context/helpers.mjs`, `dist/api/routes/sign-in.mjs` et `sign-up.mjs` ; `@better-auth/core@1.7.7/dist/env/env-impl.mjs`.
- `sign-in/email` et `sign-up/email` utilisent `formCsrfMiddleware` (`validateFormCsrf`).
- `skipOriginCheck` vaut `true` par defaut si `isTest()` est vrai (`NODE_ENV === "test"` ou `TEST` vraie). Le serveur de test est lance avec `NODE_ENV=production` et sans `TEST` (usine 1.6.5, `buildServerEnv`) : le controle est donc **actif**.
- `validateFormCsrf`, **sans cookie** :
  - en-tetes `Sec-Fetch-Site`/`Sec-Fetch-Mode`/`Sec-Fetch-Dest` presents : `cross-site` + `navigate` -> `403 CROSS_SITE_NAVIGATION_LOGIN_BLOCKED` ; sinon, validation **forcee** de l'origine ;
  - sinon, `Origin` ou `Referer` present : validation forcee de l'origine ;
  - **sinon (aucun indice de navigateur) : aucune validation**, la requete passe.
- `validateFormCsrf`, **avec cookie** : validation de l'origine.
- Validation de l'origine (`validateOrigin`) : origine = `Origin`, a defaut `Referer` ; vide ou `"null"` -> `403 MISSING_OR_NULL_ORIGIN` ; hors de la liste de confiance -> `403 INVALID_ORIGIN`.
- Liste de confiance : `apps/web/src/lib/auth.ts` ne fixe ni `baseURL` ni `trustedOrigins` ; better-auth y place l'origine deduite de l'adresse de la requete recue (`getBaseURL(undefined, basePath, request)`), plus `BETTER_AUTH_TRUSTED_ORIGINS` si elle est definie (elle ne l'est pas dans l'environnement de test).
- **Constat de l'orchestrateur** (Node 24.19.0, 2026-10-30) : `fetch` sous Node envoie de lui-meme `sec-fetch-mode: cors`. Une requete `fetch` sans `Origin` est donc traitee comme une requete de navigateur et doit etre refusee en `MISSING_OR_NULL_ORIGIN` ; seul un client qui n'envoie **aucun** en-tete `Sec-Fetch-*`, `Origin`, `Referer` ni `Cookie` (par exemple `node:http`, `curl`) echappe au controle.

## Perimetre
- **Touche** :
  - nouveau fichier de tests `tests/auth/origin.test.ts` (et, si besoin, un helper `tests/helpers/origin*.ts`) ;
  - commentaire de `originHeader()` dans `tests/helpers/auth.ts` (commentaire seulement : le code du helper est inchange) ;
  - documentation : contrat et journal de la tranche, backlog, registre, journal de projet (entree 26 et index, ligne 25), FRICTION, journal du passage autonome, consigne, fiche de preuves, rapports des trois relecteurs.
- **NE touche PAS** :
  - **rien sous `apps/`** (en particulier `apps/web/src/lib/auth.ts` : ni `baseURL`, ni `trustedOrigins`, ni `advanced.disableOriginCheck`/`disableCSRFCheck`) ; **rien sous `packages/`** ; aucune migration ; aucun manifeste (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`) ; aucune configuration (`vitest.config.*`, `tsconfig*`, `.github/`, `tests/_factory/*`). Si la preuve semble l'exiger : **arret** ;
  - les autres tests existants (aucune assertion modifiee) ; le code de `tests/helpers/auth.ts` (seul le commentaire change) ;
  - le controle d'origine des routes d'ecriture **de l'application** (`/api/organizations`, collections, liens, invitations, facturation : D-144 Q-2, backlog « avant la mise en ligne ») ;
  - la decision de fermer, ou non, le passage sans controle d'un client sans en-tete de navigateur (AC6) : constat seulement, la suite est au backlog et a l'humain ;
  - toute autre route de better-auth (deconnexion, session, reinitialisation de mot de passe, etc.).

## Perimetre de fichiers
Declare dans `.gates/scope-014.txt` (source de verite du hook).

## Dependances
- Tranches devant etre closes avant celle-ci : 001 (close et fusionnee, PR #1). Usine 1.6.5 adoptee (PR #41 fusionnee, commit eb0d990, D-157).
- **Aucune dependance nouvelle.**

## Commandes d'echafaudage prevues
Aucune. Ni `pnpm add`, ni `pnpm db:generate`. Verification apres coup par `git status --short`.

## Contrat de donnees
Aucun changement. Lectures de verification seulement, sous une connexion de test d'administration (`tests/helpers/db.ts`) : `app_user` (compte cree ou non, par adresse) et `session` (sessions de l'utilisateur).

## Contrat d'API
Aucune route de Signet ajoutee ni modifiee. Routes de better-auth exercees, telles quelles : `POST /api/auth/sign-up/email` (`{ email, password, name }`) et `POST /api/auth/sign-in/email` (`{ email, password }`).

## Criteres d'acceptation

Conventions : serveur de test du `globalSetup` (`TEST_APP_BASE_URL`) ; l'origine de l'application est `new URL(TEST_APP_BASE_URL).origin` ; origine etrangere visiblement fausse `https://piege.invalid` ; adresses uniques en `.invalid` ou `.test`, mots de passe de test lisibles. Le compte utilise pour la connexion est cree par la vraie route d'inscription, avec la bonne origine. Une requete « refusee » l'est **avec le statut `403` et le code de better-auth dans le corps** (`code` du corps JSON). « Aucun cookie de session » : aucun `Set-Cookie` dont le nom contient `session_token`. Aucun test ne compare la branche a `main` (D-099).

- [ ] AC1 — **Inscription depuis une origine etrangere refusee** : `POST /api/auth/sign-up/email` avec `Origin: https://piege.invalid` et une adresse neuve -> `403`, code `INVALID_ORIGIN` ; aucun cookie de session ; en base, **aucune** ligne `app_user` pour cette adresse (ni compte associe dans `account`).
- [ ] AC2 — **Connexion depuis une origine etrangere refusee** : sur un compte existant, `POST /api/auth/sign-in/email` avec les **bons** identifiants et `Origin: https://piege.invalid` -> `403`, code `INVALID_ORIGIN` ; aucun cookie de session ; en base, le nombre de lignes `session` de cet utilisateur est inchange.
- [ ] AC3 — **Controle positif** : les memes requetes avec `Origin` egale a l'origine de l'application aboutissent : inscription -> `200`, cookie de session pose, ligne `app_user` creee ; connexion avec les identifiants d'AC2 -> `200`, cookie de session pose, une session de plus en base. Le controle ne refuse donc pas tout, et le refus d'AC2 ne vient pas des identifiants.
- [ ] AC4 — **Origine `null`** : inscription et connexion avec `Origin: null` -> `403`, code `MISSING_OR_NULL_ORIGIN` ; aucun cookie de session ; aucun compte cree.
- [ ] AC5 — **`fetch` sans `Origin`** : inscription et connexion par `fetch` sous Node **sans** en-tete `Origin` (Node ajoute `sec-fetch-mode: cors`) -> `403`, code `MISSING_OR_NULL_ORIGIN` ; aucun cookie de session ; aucun compte cree. C'est la raison pour laquelle le client de test pose `Origin`.
- [ ] AC6 — **Client sans aucun en-tete de navigateur, comportement constate** : inscription et connexion envoyees par un client qui ne pose **ni** `Origin`, **ni** `Referer`, **ni** `Sec-Fetch-*`, **ni** `Cookie` (`node:http`, en-tetes envoyes verifies par le test) : le test fige le comportement **reellement observe** de better-auth 1.7.7. D'apres le code, il est attendu **accepte** (`200`, session posee, compte cree). Ce constat est ecrit au registre « a valider par l'humain » et, s'il est confirme, au backlog (sans aucun changement cote application) : un navigateur envoie toujours `Origin` sur un `POST` ; un client hors navigateur ne porte pas les cookies de la victime, ce n'est donc pas une attaque CSRF.
- [ ] AC7 — **Commentaire de `tests/helpers/auth.ts` exact** : le commentaire d'`originHeader()` dit ce que better-auth 1.7.7 refuse vraiment (origine etrangere -> `INVALID_ORIGIN` ; origine absente ou `null` quand la requete porte un indice de navigateur ou un cookie -> `MISSING_OR_NULL_ORIGIN`), pourquoi le client de test pose `Origin` (`fetch` sous Node envoie `sec-fetch-mode`), que le controle n'est actif sur le serveur de test que depuis l'usine 1.6.5 (usine D-033 : serveur sans `TEST` ni `VITEST`), et renvoie a la tranche 014 (`tests/auth/origin.test.ts`). Le code du helper est inchange (verification ponctuelle du diff).
- [ ] AC8 — **Isolation tenant : sans objet, justifie** : la tranche ne lit ni n'ecrit aucune donnee d'organisation (aucune table a `organization_id`, aucune route d'organisation) ; les seules lectures (`app_user`, `account`, `session`) sont des verifications de test sur des comptes crees par le test, par adresse unique. Aucun changement de politique, de privilege ni de role : la suite `tests/isolation-hardening/**` et les tests de catalogue restent verts sans modification.
- [ ] AC9 — **Diff borne** : aucune dependance ajoutee, aucune migration, aucun fichier d'`apps/` ni de `packages/`, aucun manifeste ni fichier de configuration dans le diff de la tranche (verification **ponctuelle** par `git diff --stat main...HEAD`, consignee sous `## Complements` de la fiche de preuves ; aucun test permanent qui compare a `main`).

## Anti-regression
- Suite complete verte sans modifier aucune assertion existante ; en particulier tous les tests qui s'appuient sur `signUp`/`authHeaders` de `tests/helpers/auth.ts` (le code du helper ne change pas).

## Notes d'implementation
- **Pas de code applicatif a ecrire** : les tests d'AC1 a AC6 doivent passer des leur ecriture si better-auth se comporte comme le code le laisse lire. C'est attendu pour une tranche de preuve ; ce n'est **pas** le signe d'une tranche mal definie (D-158).
- **Si AC1 ou AC2 voit la requete acceptee** (statut `2xx`, cookie pose ou compte cree) : defaut de securite reel. **Arret** et rapport a l'humain, sans rien corriger, ni cote application ni en affaiblissant le test.
- AC6 : le resultat reel fait foi. S'il differe de la lecture du code, le test fige le resultat reel et l'ecart est signale au registre ; il ne justifie aucune modification d'`apps/`.
- Lire le corps d'une reponse `403` comme JSON et verifier `code` ; ne pas dependre du texte du message (il peut changer d'une version a l'autre).
- `node:http` pour AC6 : construire la requete a la main (methode, chemin, `Content-Type`, `Content-Length`, corps) et verifier dans le test que les en-tetes envoyes ne contiennent ni `origin`, ni `referer`, ni `cookie`, ni aucun `sec-fetch-*`.
- Valeurs de test visiblement fausses (usine 1.6.3, D-081, D-096).

## Decisions humaines appliquees
- **D-146** (humain, 2026-10-28), points 2 et 3 : test du refus d'une `Origin` etrangere a retablir, commentaire de `tests/helpers/auth.ts` a corriger, dans une tranche technique.
- **D-156** : usine 1.6.5 adoptee (serveur de test sans `TEST` ni `VITEST`).
- **D-157** (humain, 2026-10-30) : tranche 014, en mode autonome, avant le second projet ; perimetre tests et documentation ; controle d'origine des routes de l'application hors tranche.

## Lectures de l'orchestrateur (a valider par l'humain, D-158)
1. **Cas « sans `Origin` » scinde en deux** (AC5, AC6), apres lecture du code et constat sur Node : `fetch` sous Node envoie `sec-fetch-mode: cors`, ce qui declenche la validation ; seul un client sans aucun en-tete de navigateur echappe au controle. La consigne demande le comportement reel : les deux cas sont reels et distincts.
2. **AC4 (`Origin: null`) ajoute** : il prouve le second code nomme par la consigne et par le commentaire du helper (`MISSING_OR_NULL_ORIGIN`).
3. **Verifications en base etendues** : `account` pour l'inscription (AC1) et `session` pour la connexion (AC2, AC3), en plus du « aucun compte cree » de la consigne.
4. **Tests verts des leur ecriture** : attendu pour une tranche de preuve sans code applicatif (voir Notes).
5. **Non teste** : `Referer` seul et `Sec-Fetch-Site: cross-site` + `Sec-Fetch-Mode: navigate` (`CROSS_SITE_NAVIGATION_LOGIN_BLOCKED`) ; ils sont decrits ci-dessus d'apres le code, sans preuve executable (backlog si l'humain le souhaite).
