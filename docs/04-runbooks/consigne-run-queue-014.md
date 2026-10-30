# Consigne — passage autonome de la tranche technique 014 (preuve du controle d'origine)

Redigee par l'orchestrateur (cowork) le 2026-10-30. A lire au lancement de `/run-queue`, **en plus** de la skill. Quatrieme passage autonome, premier sous l'usine 1.6.5 : les conditions d'arret de la skill s'appliquent **sans exception**. Le poste doit rester eveille (FRICTION 2026-10-30).

## Budget
**Une tranche : 014.** 007 et 008 restent **hors file** (hors objectif A). Arret apres `ship-slice.sh` (ou a la premiere condition d'arret). Jamais de fusion.

## Ce que l'humain a deja decide (a inscrire au registre a l'ouverture)
- **D-157 (humain, 2026-10-30)** : PR #41 (adoption de l'usine 1.6.5) fusionnee ; tranche technique **014 — Preuve du controle d'origine de better-auth** (prochain numero libre, D-025), en mode autonome, avant le second projet. Raison : c'est la suite decidee par D-146 (points 2 et 3) ; l'usine 1.6.5 a retire `TEST` et `VITEST` de l'environnement du serveur de test (usine D-033), ce qui rend enfin prouvable le controle d'origine que better-auth sautait en test ; sans ce test, la correction principale de 1.6.5 reste sans preuve sur Signet. Ecarte : le reporter apres le second projet (une protection de securite resterait affirmee sans preuve). Hors objectif de mise en ligne : le controle d'origine des routes d'ecriture **de l'application** (D-144 Q-2, backlog) n'est pas dans cette tranche.
- **Index du journal** : la ligne 25 passe a « PR #41 fusionnee (commit eb0d990) ».
- **Backlog** : ligne 014 ajoutee au tableau (tranche technique, US-09 transverse et securite d'authentification ; depend de 001 ; raison : D-146, D-157) ; ordre d'execution `... -> 012 (ecrans) -> 014 (en mode autonome)` ; les points 2 et 3 de D-146 passent a « fait (tranche 014) » a la cloture.

## Sources
D-144 (Q-2), D-146, FRICTION 2026-10-28 (connexion d'une origine etrangere acceptee en `200` sur le serveur de test) ; usine D-033 ; `apps/web/src/lib/auth.ts` (aucune option `trustedOrigins` ni `baseURL` a ce jour) ; `tests/helpers/auth.ts` (commentaire d'`originHeader`) ; le code **installe** de better-auth 1.7.7 pour le comportement exact (codes `INVALID_ORIGIN`, `MISSING_OR_NULL_ORIGIN`) : lis-le, ne le suppose pas.

## Regles de la tranche
- **Perimetre : tests et documentation seulement.** Un fichier de tests nouveau sous `tests/` (par exemple `tests/auth/origin.test.ts`) et le commentaire de `tests/helpers/auth.ts`. **Aucune** modification d'`apps/`, de `packages/`, d'une migration, d'un manifeste ou de la configuration : si la preuve semble l'exiger, **arrete-toi**.
- Criteres obligatoires :
  - **origine etrangere refusee** : `POST /api/auth/sign-in/email` et `POST /api/auth/sign-up/email` avec `Origin: https://piege.invalid` (ou valeur equivalente visiblement fausse) -> refus `403` avec le code de better-auth ; **aucun cookie de session** pose ; pour l'inscription, **aucun compte cree** (verification en base). **Si l'une de ces requetes est acceptee, c'est un defaut de securite reel : arrete-toi** et rapporte, sans rien corriger ;
  - **controle positif** : la meme requete avec `Origin` egale a l'origine de l'application aboutit (le test ne refuse pas tout) ;
  - **requete sans `Origin`** : constate le comportement reel de better-auth 1.7.7 dans ce cas, teste-le tel quel, et ecris-le au registre « a valider par l'humain » ; si elle est acceptee, inscris au backlog ce que cela implique (les navigateurs envoient `Origin` sur un `POST` ; un client hors navigateur n'est pas une attaque CSRF), sans rien changer cote application ;
  - **commentaire de `tests/helpers/auth.ts`** : exact apres la tranche (ce que better-auth refuse vraiment, pourquoi le client de test pose `Origin`, renvoi a usine D-033 et a la tranche 014) ;
  - **isolation tenant : sans objet** (aucune donnee d'organisation lue ni ecrite) ; ecris-le comme critere explicite, justifie (`close-slice.sh` exige qu'il soit nomme) ;
  - aucune dependance, aucune migration, aucun fichier d'`apps/` ni de `packages/` dans le diff (verification ponctuelle consignee sous `## Complements` de la fiche de preuves, usine 1.6.5).
- Tests : aucune comparaison permanente a `main` ; valeurs de test inventees visiblement fausses.
- Le contrat de tranche n'attend pas de validation humaine en mode autonome : ecris tes autres decisions au registre comme « a valider par l'humain » (precedent D-027, D-114, D-132, D-139).
- Scripts et tests **au premier plan** ; si la plateforme en bascule un en arriere-plan, attends sa notification sans le relancer (usine 1.6.5). Relecteurs en parallele, sans `pnpm test` de leur cote.

## Journal
`docs/04-runbooks/autonomous-run-2026-10-30.md`, tenu au fil de l'eau. Rapport final : en tete, ce qui exige une decision humaine. Journal de projet : entree 26.
