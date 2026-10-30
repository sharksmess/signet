# security-auditor — tranche 014

## 2026-10-30

# Audit securite — tranche 014 (controle d'origine better-auth)

Perimetre : `git diff main...HEAD` sur `slice/014-controle-origine` (arbre de travail propre). 12 fichiers : `tests/auth/origin.test.ts` (nouveau), `tests/helpers/auth.ts` (commentaire seulement), documentation et `.gates/`. J'ai relu le middleware installe (`better-auth@1.7.7/dist/api/middlewares/origin-check.mjs`, `validateFormCsrf` / `validateOrigin`) et la configuration `apps/web/src/lib/auth.ts`.

## Points demandes

**1. Les tests prouvent-ils le refus ? Oui, pas de faux vert.**
- `expectRefused` (origin.test.ts:100-104) verifie trois choses : statut 403, code exact (`INVALID_ORIGIN` ou `MISSING_OR_NULL_ORIGIN`), aucun cookie `session_token`.
- Elle est completee par des verifications en base :
  - pour l'inscription, aucune ligne `app_user` ni `account` (`expectNoAccount`) ;
  - pour la connexion, le nombre de sessions est inchange (avant/apres).
- Un 429 de limitation de debit ne pourrait pas passer pour un refus d'origine, puisque le code est controle.
- Le temoin positif AC3 (200, cookie, ligne `app_user`, session +1) montre que les requetes de lecture en base trouvent bien les lignes. Les assertions « 0 ligne » d'AC1/AC4/AC5 ne sont donc pas vides par construction (adresse mal ecrite, mauvaise table).
- Les lectures `asBypassRls` sont bornees et parametrees (`$1`) : par `email` unique genere par le test (`userRows`, `accountCount`, l.80-91) ou par `user_id` d'un compte cree par le test (`sessionCount`, l.93-98). Aucun `SELECT` sans predicat.
- AC6 verifie lui-meme les en-tetes effectivement poses (`expectNoBrowserHints`). Le constat ne repose donc pas sur une supposition sur `node:http`.

**2. Constat AC6 (client sans Origin, Referer, Cookie ni Sec-Fetch-* accepte) : pas une faille.**
- **CSRF : non.** Une attaque CSRF exige que le navigateur de la victime envoie la requete. Or :
  - les navigateurs actuels envoient toujours `Origin` sur un POST cross-site, formulaire HTML compris (Firefox depuis la v70, Chromium et Safari depuis plus longtemps) ;
  - les navigateurs recents envoient aussi `Sec-Fetch-Site/Mode/Dest`.

  Une telle requete tombe dans `validateOrigin(ctx, true)` (refus `INVALID_ORIGIN`) ou dans `CROSS_SITE_NAVIGATION_LOGIN_BLOCKED` pour une navigation cross-site. La seule branche non controlee (l.147 du middleware : aucun indice de navigateur) n'est atteignable que par un client hors navigateur, ou un navigateur tres ancien qui n'envoie ni `Origin` ni `Sec-Fetch-*`. Un tel client ne porte ni les cookies ni la session de la victime. La « connexion forcee » (login CSRF) suppose de poser le cookie dans le navigateur de la victime, ce qu'une requete faite par un serveur tiers ne peut pas faire.
- **Limitation de debit, enumeration, bourrage d'identifiants : AC6 n'ajoute rien.** Un client hors navigateur peut de toute facon forger `Origin` a la valeur de l'application : le controle d'origine n'est pas, et ne peut pas etre, une mesure anti-automatisation. Ces risques relevent de `rateLimit` (ADR-0010, actif hors `APP_ENV=test`). Ils existent a l'identique avec un `Origin` correct.
- **Recommandations pour le backlog** (rien a changer dans cette tranche) :
  - (a) Avant la mise en production, configurer explicitement `baseURL` et `trustedOrigins`. Aujourd'hui l'origine de confiance est deduite de la requete recue (en-tete Host). C'est sans consequence aujourd'hui, car aucun envoi d'e-mail (`sendResetPassword`, `sendVerificationEmail`) n'est configure. Cela deviendrait un empoisonnement de lien (Host header poisoning) le jour ou un lien de reinitialisation sera construit a partir de l'URL de base. A rattacher a la tranche fournisseur d'e-mail.
  - (b) Prouver par un test que la limitation de debit de `sign-in/email` s'applique aussi a un client sans en-tete de navigateur. C'est elle, et non le controle d'origine, qui protege contre l'automatisation.

**3. Aucune modification sous `apps/` ni `packages/` : confirme.** `git diff --name-only -- apps packages` est vide. Aucune dependance ajoutee (ni `package.json` ni lockfile dans le diff). Aucun secret : le mot de passe de test `mot-de-passe-de-test` a une entropie faible et l'origine etrangere est `https://piege.invalid` (TLD reserve). `pnpm audit --prod` : « No known vulnerabilities found ».

**4. Exactitude du commentaire `tests/helpers/auth.ts` (l.22-44) : juste sur le fond.** Il est conforme a `validateFormCsrf` :
- avec un cookie, l'origine est validee ;
- avec un indice `Sec-Fetch-*`, ou un `Origin`/`Referer`, la validation est forcee ;
- sans aucun de ces en-tetes, rien n'est controle.

Le middleware s'applique bien a `sign-in.mjs` et `sign-up.mjs`. Deux imprecisions sans consequence de securite, voir INFO-2 et INFO-3.

**5. Isolation tenant (AC8) : sans objet, confirme.** Aucune table a `organization_id` n'est touchee, aucune politique, fonction, privilege ni role n'est modifie. Les seules lectures portent sur `app_user`/`account`/`session`, en contexte de test et bornees comme decrit au point 1.

## Constats

Aucun constat CRITIQUE, MAJEUR ni MINEUR.

**INFO-1 — Le jeton de session de test peut apparaitre dans les messages d'echec**
- Emplacement : `tests/auth/origin.test.ts:45-48` (`describeObserved`).
- Le message d'echec contient le `set-cookie` complet. Si une assertion echoue alors qu'un cookie a ete pose (AC3, AC6, ou une regression sur AC1/AC2), le jeton de session d'un compte de test s'affiche dans la sortie de vitest/CI.
- Scenario : quelqu'un qui lit les journaux de CI recupere un jeton valable uniquement sur le serveur de test ephemere, pour un compte jetable. Pas d'exploitation realiste, d'ou le classement INFO.
- Direction : ne garder que le nom des cookies (partie avant `=`) dans le message.

**INFO-2 — Le commentaire du helper decrit l'en-tete pose de facon approximative**
- Emplacement : `tests/helpers/auth.ts` (commentaire l.33-36, code l.45-46).
- Le commentaire dit « La valeur est l'origine de `TEST_APP_BASE_URL` », mais `originHeader()` pose `baseUrl()` tel quel, pas `new URL(baseUrl()).origin`.
- C'est equivalent tant que `TEST_APP_BASE_URL` n'a ni chemin ni barre finale. Ce n'est pas une faille.
- Direction : aligner le commentaire ou le code au prochain passage.

**INFO-3 — Deux branches du middleware ne sont pas decrites dans le commentaire**
- Emplacement : `tests/helpers/auth.ts:22-31`.
- Branches omises :
  - `CROSS_SITE_NAVIGATION_LOGIN_BLOCKED` (`Sec-Fetch-Site: cross-site` + `Sec-Fetch-Mode: navigate`) ;
  - l'acceptation de `Origin: null` accompagne de `Sec-Fetch-Site: same-origin`, ou l'origine est alors deduite de la requete.
- Ces cas sont deja signales comme non testes dans D-158 (point 5). L'omission ne rend pas le commentaire faux.

**INFO-4 — Origine de confiance deduite de la requete (hors diff, deja present avant)**
- Emplacement : `apps/web/src/lib/auth.ts` (aucun `baseURL` ni `trustedOrigins`).
- Voir la recommandation (a) du point 2. A traiter avant la production ou avant le premier e-mail transactionnel contenant un lien.

AUDIT: PASS
