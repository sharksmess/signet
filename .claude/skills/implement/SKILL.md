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

## 2. Controles de cloture
Une fois les criteres d'acceptation passes, lance en parallele :
- `security-auditor` sur le diff de la tranche
- `contract-guardian` sur les contrats

Enregistre le rapport final de chaque auditeur, **tel quel**, dans `docs/04-runbooks/audits/audit-NNN.md` et `docs/04-runbooks/audits/contracts-NNN.md`. La derniere ligne doit etre le verdict exact (`AUDIT: PASS`, `CONTRACTS: PASS`). Ne reformule pas, ne resume pas : ces fichiers sont relus par l'humain dans l'historique git.

Puis `bash scripts/close-slice.sh`.

Ce que ce mecanisme garantit, et ce qu'il ne garantit pas : le script relance lui-meme les tests, le controle de types et la verification des criteres d'acceptation — ceux-la ne peuvent pas etre falsifies. Le verdict d'audit, lui, est recopie par la session qui orchestre : sa fidelite repose sur la transcription et sur la relecture humaine du rapport versionne. Ce script relance la suite complete, verifie les verdicts des deux auditeurs et n'ecrit le gate de tranche que si tout passe. Il ne peut pas etre satisfait autrement qu'en satisfaisant reellement ses conditions : c'est la difference entre un gate franchissable par une machine et un gate falsifiable par une machine.

## 3. Si un audit echoue
Les constats CRITIQUE et MAJEUR reviennent au `slice-implementer` sous forme de correctifs a appliquer. Les MINEUR deviennent des lignes dans `docs/03-slices/000-backlog.md`. Ne corrige pas toi-meme dans la session principale : l'implementeur tient le journal et les commits de la tranche.

## 4. Livrer
`bash scripts/ship-slice.sh` : verifie que la branche est a jour de `main`, pousse (le hook pre-push rejoue controles et tests), ouvre ou met a jour la PR avec contrat, verdicts, commits et decisions. Puis arrete-toi : la CI tourne, la fusion appartient a l'humain.

## 5. Rendre compte
Lien de la PR, criteres passes, verdicts d'audit, decisions prises a valider, points d'attention. Pas de recit du cheminement.
