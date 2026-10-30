# 26 — Tranche 014 : preuve du controle d'origine de better-auth, en mode autonome

- **Dates** : 2026-10-30
- **Objectif** : prouver par des tests que better-auth refuse une inscription ou une connexion venue d'une origine etrangere, controle affirme mais jamais prouve tant que le serveur de test heritait `TEST=true` (FRICTION 2026-10-28, D-146) ; premier passage autonome sous l'usine 1.6.5, avant le second projet (D-157).

## Ce qui a ete fait
- Ouverture en mode autonome (`/run-queue`, budget : 014 seule) selon `docs/04-runbooks/consigne-run-queue-014.md` : contrat `docs/03-slices/014-controle-origine.md` (AC1 a AC9), perimetre tests et documentation seulement (618ac2d) ; D-157 et D-158 au registre, backlog, index du journal (a6c6f75).
- Lu avant le contrat, dans le code installe de better-auth 1.7.7 : l'inscription et la connexion ne controlent l'origine que si la requete porte un indice de navigateur ou un cookie. Constat sur le poste : `fetch` sous Node envoie de lui-meme `sec-fetch-mode: cors`. Le cas « sans `Origin` » de la consigne est donc scinde en deux (AC5, AC6).
- Tests par `test-writer` : `tests/auth/origin.test.ts`, 10 tests, verts des leur ecriture comme attendu pour une tranche sans code applicatif (0c77127). Origine etrangere refusee (`403 INVALID_ORIGIN`), sans cookie, sans compte ni session ; controle positif ; `Origin: null` et `fetch` sans `Origin` refuses (`MISSING_OR_NULL_ORIGIN`) ; client sans aucun en-tete de navigateur **accepte** (constat).
- Commentaire de `tests/helpers/auth.ts` rendu exact par `slice-implementer` (5ba6979, precise apres relecture en 9a05972), commentaire seulement ; suite complete verte apres une relance unique (ae07d95).
- Trois relectures en parallele, toutes PASS (6e3f3e0) ; correctifs de relecture : commentaire, valeurs de cookie masquees dans les echecs du test, lisibilite de `viaHttp` (9a05972, f2490eb, aeb844b) ; backlog et registre (D-159).

## Decisions
- D-157 : tranche 014 creee, en mode autonome, avant le second projet ; tests et documentation seulement (humain).
- D-158 : lectures de l'orchestrateur (cas sans `Origin` scinde, `Origin: null` ajoute, verifications en base etendues, cas non testes) — **a valider**.
- D-159 : suites des relectures, dont le **constat d'AC6** (client hors navigateur non controle, pas une faille CSRF selon audit-014) — **a valider**.
Le detail est dans `docs/DECISIONS.md`.

## Preuves
Fiche `docs/04-runbooks/evidence/014.md` (produite par `close-slice.sh`, `## Complements` : verification du diff et resultats observes) ; rapports `docs/04-runbooks/audits/{audit,contracts,review}-014.md` ; suite complete 981 verts, 1 ignore, 0 echec avant les relectures.

## Incidents
- Un depassement de delai sans lien avec la tranche au premier passage de la suite (`tests/billing/processing.test.ts`), vert au rejeu et a la relance (FRICTION 2026-10-30).
- Mode plan active par la plateforme en plein passage : fichier de plan hors depot refuse par `gate-check.sh` ; puis un `heredoc` refuse par `block-dangerous.sh` (faux positif sur le vocabulaire des gates) ; sans consequence (FRICTION 2026-10-30).
- Le mot de passe de test initial a ete pris pour une cle par gitleaks ; remplace par une valeur lisible.

## Etat a la fin
Tranche 014 close par `close-slice.sh` et PR ouverte ; fusion a la decision de l'humain. Le controle d'origine de better-auth est prouve sur Signet ; D-146 points 2 et 3 faits.

## Etape suivante
Decision humaine : fusion de la PR de 014 sur preuves ; validation de D-158 et D-159, dont le sort du constat d'AC6 (accepter et documenter, ou fermer les clients hors navigateur) ; puis le second projet de l'objectif A.
