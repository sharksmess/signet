# 05 — Usine 1.4.0 : preuves, relecture independante, documentation

- **Dates** : 2026-09-28 → 2026-09-29
- **Objectif** : corriger les defauts reveles par la tranche 001 et outiller la fusion sur preuves (D-023).

## Ce qui a ete fait
- Usine 1.4.0 : agent `code-reviewer` independant, fiche de preuves produite par `close-slice.sh`, registre des decisions obligatoire et controle a la cloture, garde des recherches sur les secrets, controle des variables d'environnement contradictoires, `packageManager` impose, `.gitattributes`, CI `ubuntu-24.04` et gitleaks v3. 97 scenarios de test.
- L'usine est versionnee (v1.3.0, v1.4.0) et publiee en depot prive `sharksmess/saas-factory`, avec sa propre CI.
- Signet : registre `docs/DECISIONS.md` (D-001 a D-026), cadrage de la tranche 010, adoption par Claude Code, PR #11 fusionnee (commit d49fd3f).

## Decisions
- D-021 : tout est documente dans le depot (humain).
- D-024 : la tranche autonome est la 010 (durcissement), avant la 002 (cowork, contestable). D-025 : identifiants de tranche jamais renumerotes. D-026 : adoption 1.4.0.

## Incidents
Un scenario de test de l'usine ne tournait pas sous Windows (corrige, 6a001e4) ; message de commit de la consigne trop long, signale par Claude Code.

## Etat a la fin
Usine 1.4.0 en place dans Signet, 47 tests verts, CI verte.
