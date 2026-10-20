# 15 — Usine 1.6 : cloture fiable, CI rejouee en local

- **Dates** : 2026-10-19 → 2026-10-20
- **Objectif** : integrer a l'usine les lecons de la tranche 002, pour que les problemes soient vus sur le poste avant la PR et que les gestes humains soient outilles (plan de la semaine, D-074).

## Ce qui a ete fait
- Usine 1.6.0 puis 1.6.1 (depot `saas-factory`, tags `v1.6.0`, `v1.6.1`), 118 scenarios verts :
  - `close-slice.sh` rejoue l'etape Build de la CI par `scripts/ci-build.sh` (meme commande en CI, environnement `ci/build.env`), lance gitleaks s'il est installe, reconnait les criteres en gras, refuse une tranche sans critere coche, finit par `CLOTURE REUSSIE` ou `CLOTURE REFUSEE` ;
  - `block-dangerous` refuse en arriere-plan la cloture, la livraison, le build CI et les tests ;
  - `scripts/env-check.ps1` controle et complete les fichiers d'environnement sans afficher de valeur ;
  - `gates.ps1 scope-add` et `reopen-slice` remplacent les editions manuelles de `.gates/` ;
  - mode par defaut « accept edits » ; `WINDOWS.md` : memoire, `psql`, gitleaks ;
  - **1.6.1** : les garde-fous bloquent tout s'ils n'ont pas d'outil JSON qui fonctionne.
- Adoption dans Signet sur `chore/usine-1.6.0` (consigne `docs/04-runbooks/consigne-adoption-1.6.0.md`) : `ci/build.env`, etape Build de la CI par le script, menage de l'ancien worktree d'agent de septembre.

## Decisions
- D-082 : adoption de l'usine 1.6.1 (humain, D-074 ; cowork). Cote usine : D-022 a D-026 (D-026 : garde-fous incontournables).
- D-083 : objectif A, qui remplace le plan de D-074 (humain).
- D-084 : numeros des tranches de l'objectif A (cowork).

## Preuves
- Usine : `tests/run-tests.sh` 118/118. Adoption : `pnpm test`, `pnpm run check`, `bash scripts/ci-build.sh`, `.\scripts\env-check.ps1`, CI de la PR.

## Incidents
- **Garde-fous inoperants sur le poste.** A l'installation de la 1.6.0, les tests de l'usine ont echoue (55/114) : le poste n'a ni jq ni Python, seulement l'alias `python3` du Microsoft Store ; les hooks lisaient une commande vide et autorisaient tout, sans le dire. Depuis quand : non etabli (l'adoption de la 1.5.0 le 07/10 etait passee). Les regles ont ete tenues par l'agent lui-meme, et tout le code a ete relu par trois relecteurs et valide par l'humain ; mais la garantie mecanique manquait. Corrige : jq installe (`winget install jqlang.jq`, jq-1.8.2), usine 1.6.1.
- Deux serveurs Next oublies depuis les 24 et 25/09 (ancien worktree d'agent) consommaient de la memoire : voir `docs/04-runbooks/FRICTION.md`.
- **CI de la PR #28 rouge a l'etape Build.** La liste noire de `scripts/ci-build.sh` (1.6.0) effacait `APP_ENV` mais laissait passer `AUTH_RATE_LIMIT=off` du job de CI : le build refusait le limiteur coupe hors test. Invisible en local, le terminal n'ayant aucune des deux variables. Corrige par l'usine 1.6.2 (environnement vide, liste blanche), reproduit puis verifie en local (D-085).

## Etat a la fin
Usine 1.6.1 publiee ; adoption en PR #28 (283 tests, garde-fou verifie : ecriture dans `.gates/` refusee). Objectif A fixe (D-083).

## Etape suivante
Tranche 003 (invitation d'un membre), avec une fausse messagerie en test : aucun fournisseur d'e-mails reel (D-083).

## Erratum de la consigne d'adoption
Deux points de `docs/04-runbooks/consigne-adoption-1.6.0.md` etaient faux, signales par Claude Code et laisses en l'etat dans la consigne (document historique) :
- etape 2b : `TEST_DATABASE_URL_BYPASSRLS` n'est plus lue par aucun test (journal de la tranche 001) ; elle n'a pas ete ajoutee au modele, et peut etre retiree des fichiers locaux ;
- etape 3 : l'ancien worktree n'etait plus enregistre aupres de git ; seul restait un dossier de restes de build (6,9 Mo), supprime apres l'arret des deux serveurs.
