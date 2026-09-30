---
name: implement
description: Implemente la tranche active jusqu'a ce que ses criteres d'acceptation passent, puis lance les controles de cloture. A utiliser une fois la tranche ouverte et ses tests ecrits.
---

Implemente la tranche active.

## 0. Verifier
- `.gates/02-architecture.approved` existe, sinon arrete-toi.
- `.gates/current-slice` designe une tranche dont les tests existent et echouent. S'ils passent deja, la tranche est mal definie : signale-le.

## 1. Deleguer
Delegue au sous-agent `slice-implementer`. Il travaille sur la branche `slice/NNN-*` du depot principal, commite couche par couche et tient `docs/03-slices/NNN-progress.md` : une interruption se reprend en relisant ce journal.

Passe-lui dans le prompt de delegation : le chemin du fichier de tranche, le chemin du perimetre, et le rappel explicite des regles hors-perimetre. Un sous-agent demarre avec un contexte vierge : ce que tu ne lui dis pas, il ne le sait pas.

## Regles d'orchestration (tirees du premier passage autonome, tranche 010 de Signet)
- **Tests au premier plan.** Lance `pnpm test` et `pnpm run check` au premier plan, jamais en arriere-plan : attendre une notification de fin a deja endormi la session, et il a fallu un humain pour la relancer.
- **Sous-agent bloque ou arrete sans rapport** : verifie ce qu'il a laisse (`git status`, `git log`), puis **relance-le une fois** avec l'etat constate. Si la relance echoue aussi, reprends son travail toi-meme **et ecris la reprise** dans la section « Decisions » du journal de tranche et dans `docs/DECISIONS.md` (qui, quoi, pourquoi, commits). Jamais de reprise silencieuse (decision D-034 de Signet).
- **Base de test partagee** : une seule suite de tests a la fois. Les relecteurs lances en parallele ne lancent pas `pnpm test` ; ils lisent les resultats que tu leur transmets.

## 2. Controles de cloture
Une fois les criteres d'acceptation passes, lance **en parallele** les trois relecteurs independants, chacun dans son propre contexte :
- `security-auditor` sur le diff de la tranche
- `contract-guardian` sur les contrats
- `code-reviewer` sur le diff, les tests et la documentation

Enregistre le rapport final de chacun, **tel quel**, dans `docs/04-runbooks/audits/audit-NNN.md`, `contracts-NNN.md` et `review-NNN.md` (en ajoutant une section datee si le fichier existe deja). La derniere ligne doit etre le verdict exact (`AUDIT: PASS`, `CONTRACTS: PASS`, `REVIEW: PASS`). Ne reformule pas, ne resume pas : ces fichiers sont les preuves que l'humain et un auditeur externe liront.

Avant la cloture, reporte dans `docs/DECISIONS.md` les decisions de la tranche (une ligne chacune, lien vers le journal ou l'ADR), ou une ligne « Tranche NNN : aucune decision hors contrat ». Regle : `.claude/rules/documentation.md`.

Ecris le recapitulatif de l'etape dans le journal de projet : `docs/00-context/journal/NN-tranche-NNN-<nom>.md` (gabarit `docs/templates/JOURNAL-ENTREE.md`) et sa ligne dans `docs/00-context/JOURNAL.md`, en citant la fiche de preuves `docs/04-runbooks/evidence/NNN.md` qui sera produite a la cloture. Committe (`docs(slice-NNN): journal de projet`).

Puis `bash scripts/close-slice.sh`. Il produit la fiche de preuves `docs/04-runbooks/evidence/NNN.md`.

Ce que ce mecanisme garantit, et ce qu'il ne garantit pas : le script relance lui-meme les tests, le controle de types et la verification des criteres d'acceptation — ceux-la ne peuvent pas etre falsifies. Le verdict d'audit, lui, est recopie par la session qui orchestre : sa fidelite repose sur la transcription et sur la relecture humaine du rapport versionne. Ce script relance la suite complete, verifie les verdicts des deux auditeurs et n'ecrit le gate de tranche que si tout passe. Il ne peut pas etre satisfait autrement qu'en satisfaisant reellement ses conditions : c'est la difference entre un gate franchissable par une machine et un gate falsifiable par une machine.

## 3. Si un relecteur echoue
Les constats CRITIQUE et MAJEUR (securite), les ruptures de contrat et les constats BLOQUANT (relecture) reviennent au `slice-implementer` sous forme de correctifs a appliquer, puis le relecteur concerne repasse. Les MINEUR, A CORRIGER non traites et SUGGESTION utiles deviennent des lignes dans `docs/03-slices/000-backlog.md`. Ne corrige pas toi-meme dans la session principale : l'implementeur tient le journal et les commits de la tranche.

## 4. Livrer
`bash scripts/ship-slice.sh` : verifie que la branche est a jour de `main`, pousse (le hook pre-push rejoue controles et tests), ouvre ou met a jour la PR avec contrat, verdicts, commits et decisions. Puis arrete-toi : la CI tourne, la fusion appartient a l'humain.

## 5. Rendre compte
Lien de la PR, fiche de preuves, decisions prises a valider, points d'attention. Pas de recit du cheminement. L'humain decide de la fusion sur ces preuves, sans relire le code.
