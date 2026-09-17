---
name: implement
description: Implemente la tranche active jusqu'a ce que ses criteres d'acceptation passent, puis lance les controles de cloture. A utiliser une fois la tranche ouverte et ses tests ecrits.
---

Implemente la tranche active.

## 0. Verifier
- `.gates/02-architecture.approved` existe, sinon arrete-toi.
- `.gates/current-slice` designe une tranche dont les tests existent et echouent. S'ils passent deja, la tranche est mal definie : signale-le.

## 1. Deleguer
Delegue au sous-agent `slice-implementer`. Il travaille dans un worktree isole, ce qui permet a plusieurs tranches d'avancer en parallele sans collision de fichiers, et laisse ton depot principal intact si la tranche echoue.

Passe-lui dans le prompt de delegation : le chemin du fichier de tranche, le chemin du perimetre, et le rappel explicite des regles hors-perimetre. Un sous-agent demarre avec un contexte vierge : ce que tu ne lui dis pas, il ne le sait pas.

## 2. Controles de cloture
Une fois les criteres d'acceptation passes, lance en parallele :
- `security-auditor` sur le diff de la tranche
- `contract-guardian` sur les contrats

Puis `scripts/close-slice.sh`. Ce script relance la suite complete, verifie les verdicts des deux auditeurs et n'ecrit le gate de tranche que si tout passe. Il ne peut pas etre satisfait autrement qu'en satisfaisant reellement ses conditions : c'est la difference entre un gate franchissable par une machine et un gate falsifiable par une machine.

## 3. Si un audit echoue
Les constats CRITIQUE et MAJEUR reviennent au `slice-implementer` sous forme de correctifs a appliquer. Les MINEUR deviennent des lignes dans `docs/03-slices/000-backlog.md`. Ne corrige pas toi-meme dans la session principale : tu perdrais l'isolation du worktree.

## 4. Rendre compte
Criteres passes, fichiers touches, verdicts d'audit, decisions prises, points a l'attention de l'humain. Pas de recit du cheminement.
