# 13 — Usine 1.5 : WSL2 evalue, blocage de Smart App Control nomme par les tests

- **Dates** : 2026-10-07
- **Objectif** : rendre l'environnement local fiable avant la tranche 002 (D-053), apres deux blocages de Next par Smart App Control (02/10 et 07/10).

## Ce qui a ete fait
- **Phase 0 (WSL2)** : Ubuntu 24.04.5 installe sous WSL2, Node 24.21.0 et pnpm 12.3.4 ; `networkingMode=mirrored` dans `%USERPROFILE%\.wslconfig` pour joindre le Postgres de Windows (fonctionne).
- Pont desktop teste sur les dossiers Linux : chemins UNC `\\wsl.localhost\...` refuses ; lecteur `W:` mappe sur WSL ni visible ni accordable. Un depot place dans Linux sortirait donc du perimetre de l'orchestrateur (D-054).
- **Mesure B1** (depots sur `C:`, commandes dans Ubuntu par `/mnt/c/dev/mon-saas`) : `pnpm test` en 5 min 04 s, contre ~40 s sous Windows, et un test de lint (`lint-scope`) depasse son delai. Copie d'essai `~/dev/wsl-test` jetable, non versionnee.
- Decision : rester sous Windows natif, Smart App Control desactive (D-049), WSL2 garde en secours (D-055). Lecteur `W:` retire (`net use` : deja absent).
- **Usine 1.5.0** (depot `saas-factory`, commit 64064f7, tag `v1.5.0`, pousse) : `tests/_factory/preflight.ts` charge le composant natif de Next (SWC) avant le build et, s'il est bloque, nomme Smart App Control en une phrase ; `WINDOWS.md` documente Smart App Control et l'essai WSL2 ; 104 scenarios de l'usine verts sur le poste. La 1.4.2 (fiche de preuves : dependances ajoutees ou changees de version) arrive avec elle.
- Adoption dans Signet sur la branche `chore/usine-1.5.0` (consigne `docs/04-runbooks/consigne-adoption-1.5.0.md`).

## Decisions
- D-054 : pont incompatible avec les dossiers Linux, mesure B1 retenue (humain).
- D-055 : Windows natif, Smart App Control desactive, WSL2 en secours (humain).
- D-056 : adoption de l'usine 1.5.0, avec la 1.4.2 (cowork, en application de D-053 et D-055).

Le detail est dans `docs/DECISIONS.md` ; cote usine, ses decisions D-019 a D-021.

## Preuves
- Mesures B1 relevees sur le poste (5 min 04 s, un delai depasse) ; Windows apres retour : `pnpm test` 13 fichiers, 107/107 en 33,7 s (2026-10-07, 19:23).
- Usine : `tests/run-tests.sh` 104/104 ; tag `v1.5.0` sur GitHub.
- Adoption : `pnpm test` et `pnpm run check` sur la branche, CI de la PR.

## Incidents
Pont et dossiers Linux, lenteur de `/mnt/c`, verrous git laisses par les commits de l'orchestrateur, ecriture d'une copie perimee : voir `docs/04-runbooks/FRICTION.md` (2026-10-07).

## Etat a la fin
Environnement de reference : Windows natif, Smart App Control desactive (reactivable sans reinstallation). Usine 1.5.0 publiee, adoption en PR.

## Etape suivante
L'humain fusionne l'adoption sur preuves ; puis tranche 002 (Stripe) : compte Stripe de test a creer par l'humain, audit-010 MINEUR-2 en critere obligatoire (D-033).
