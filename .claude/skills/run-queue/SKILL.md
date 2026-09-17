---
name: run-queue
description: Mode autonome. Enchaine plusieurs tranches sans supervision, en worktrees paralleles, avec budget, conditions d'arret et rapport consolide. A lancer quand tu veux laisser l'usine tourner seule.
disable-model-invocation: true
---

Mode autonome. Tu enchaines des tranches sans supervision humaine. La totalite de la valeur de ce mode repose sur les conditions d'arret : un agent autonome sans condition d'arret ne produit pas plus de travail, il produit plus de degats avant qu'on s'en apercoive.

## 0. Prerequis, verifies avant de commencer
- `.gates/02-architecture.approved` existe. Le mode autonome ne franchit jamais un gate humain.
- L'arbre de travail est propre (`git status`).
- Le budget est fixe : nombre de tranches, ou duree. Si l'humain ne l'a pas donne, demande-le. Pas de file illimitee.

## 1. Constituer la file
Depuis `docs/03-slices/000-backlog.md`, retiens les tranches dont toutes les dependances sont closes. Presente la file et son budget, puis demarre.

Parallelise uniquement les tranches dont les perimetres de fichiers ne se recouvrent pas : compare les `.gates/scope-*.txt`. Deux tranches qui touchent la meme table sont sequentielles, meme si elles semblent independantes fonctionnellement.

## 2. Boucle, par tranche
1. `/saas-factory:slice` pour ouvrir et rediger le contrat.
2. `test-writer` pour les tests.
3. `slice-implementer` en worktree.
4. `security-auditor` et `contract-guardian` en parallele.
5. `scripts/close-slice.sh`.
6. Si succes : commit sur une branche dediee, tranche suivante. Si echec : voir conditions d'arret.

## 3. Conditions d'arret — non negociables
Arrete-toi immediatement et attends l'humain si :
- Un audit rend un verdict CRITIQUE, meme si tu penses pouvoir le corriger.
- `contract-guardian` rend BREAKING.
- Une meme tranche echoue deux fois de suite.
- Une tranche exige d'ecrire hors de son perimetre.
- Une dependance nouvelle serait necessaire.
- Une decision metier manque et devrait etre comblee par une hypothese.
- Le budget est atteint.
- La suite de tests complete echoue apres une cloture.

La regle qui compte : **en cas de doute, tu t'arretes.** Le cout d'une pause est quelques heures d'attente. Le cout d'une decision metier inventee et propagee sur cinq tranches est une reecriture. L'asymetrie est ecrasante et elle doit dicter ton comportement.

Ne fusionne jamais sur la branche principale en mode autonome. Chaque tranche vit sur sa branche jusqu'a revue humaine.

## 4. Journal
Tiens `docs/04-runbooks/autonomous-run-<date>.md` a jour au fil de l'eau, pas a la fin : si la session est interrompue, le journal doit permettre de reprendre. Par tranche : issue, duree, verdicts d'audit, decisions prises, points a l'attention.

## 5. Rapport final
Tranches closes, tranches arretees et pourquoi, decisions prises en autonomie a valider, etat des branches. Mets en tete ce qui exige une decision humaine — c'est la seule partie que l'humain lira forcement.
