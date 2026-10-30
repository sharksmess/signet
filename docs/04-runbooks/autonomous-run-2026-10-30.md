# Passage autonome du 2026-10-30 (/run-queue)

Budget fixe par l'humain : **1 tranche, la 014** (preuve du controle d'origine de better-auth), selon `docs/04-runbooks/consigne-run-queue-014.md` (D-157). Premier passage sous l'usine 1.6.5. Arret apres `ship-slice.sh` ou a la premiere condition d'arret. Jamais de fusion.

## Prerequis
- `.gates/02-architecture.approved` present ; aucune tranche active.
- `main` a jour sur eb0d990 (PR #41, usine 1.6.5, fusionnee). Arbre : seulement la consigne, non committee, incluse dans le commit d'ouverture.
- File : 014 (depend de 001, close et fusionnee). 007 et 008 : **hors file** (consigne, hors objectif A).

## Tranche 014 — Preuve du controle d'origine de better-auth
- Debut : 2026-10-30. Branche `slice/014-controle-origine`.
- Sources relues : consigne ; `apps/web/src/lib/auth.ts` (ni `baseURL` ni `trustedOrigins`) ; `tests/helpers/auth.ts` ; `tests/_factory/global-setup.ts` et `env.ts` (`buildServerEnv` : `NODE_ENV=production`, sans `TEST`) ; code installe de better-auth 1.7.7 : `dist/api/middlewares/origin-check.mjs` (`formCsrfMiddleware`, `validateOrigin`), `dist/context/create-context.mjs` (`skipOriginCheck` par defaut = `isTest()`), `dist/context/helpers.mjs` (`getTrustedOrigins` : origine deduite de la requete sans `baseURL`), `dist/api/routes/sign-{in,up}.mjs` ; `@better-auth/core` `env-impl.mjs` (`isTest`).
- Constat sur le poste (Node 24.19.0, serveur local jetable) : `fetch` envoie de lui-meme `sec-fetch-mode: cors`. Consequence : un `fetch` sans `Origin` est traite comme une requete de navigateur ; seul un client sans aucun en-tete de navigateur echappe au controle. Cas « sans `Origin` » scinde en AC5 et AC6 (D-158).
- Ouverture : contrat `docs/03-slices/014-controle-origine.md` (AC1 a AC9), perimetre `.gates/scope-014.txt`, journal de tranche, consigne ; commit 618ac2d. Registre D-157 (humain), D-158 (a valider) ; backlog (ligne 014, ordre) ; index du journal (ligne 25 : PR #41 fusionnee).
- Incident : le mode plan, active par la plateforme en cours de session, a voulu ecrire un fichier de plan hors depot, refuse par `gate-check.sh` ; puis un `heredoc` du shell refuse par `block-dangerous.sh` (faux positif sur le vocabulaire des gates) ; aucune consequence, ecritures refaites par les outils de fichier ; FRICTION 2026-10-30.
