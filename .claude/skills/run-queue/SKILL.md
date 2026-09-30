---
name: run-queue
description: Mode autonome. Enchaine plusieurs tranches sans supervision, une a la fois avec une PR chacune, avec budget, conditions d'arret et rapport consolide. A lancer quand tu veux laisser l'usine tourner seule.
disable-model-invocation: true
---

Mode autonome. Tu enchaines des tranches sans supervision humaine. La totalite de la valeur de ce mode repose sur les conditions d'arret : un agent autonome sans condition d'arret ne produit pas plus de travail, il produit plus de degats avant qu'on s'en apercoive.

## 0. Prerequis, verifies avant de commencer
- `.gates/02-architecture.approved` existe. Le mode autonome ne franchit jamais un gate humain.
- L'arbre de travail est propre (`git status`).
- Le budget est fixe : nombre de tranches, ou duree. Si l'humain ne l'a pas donne, demande-le. Pas de file illimitee.

## 1. Constituer la file
Depuis `docs/03-slices/000-backlog.md`, retiens les tranches dont toutes les dependances sont closes. Presente la file et son budget, puis demarre.

Les tranches s'executent **l'une apres l'autre**, chacune sur sa branche depuis `main`. Une tranche dont une dependance a une PR encore ouverte ne demarre pas : tu t'arretes et signales que la fusion humaine est attendue. Pas de parallelisme dans cette version de l'usine : il a produit plus de travail perdu que de temps gagne.

## 2. Boucle, par tranche
`/slice` et `/implement` sont reserves a l'humain (`disable-model-invocation`) : tu ne peux pas les invoquer. **Lis et applique toi-meme** `.claude/skills/slice/SKILL.md` puis `.claude/skills/implement/SKILL.md`, dans l'ordre, y compris leurs regles d'orchestration.
1. Ouvrir la tranche et rediger le contrat (`skills/slice/SKILL.md`).
2. `test-writer` pour les tests (s'il s'arrete sans rapport : regles d'orchestration de `skills/implement/SKILL.md`).
3. `slice-implementer` sur la branche de la tranche.
4. `security-auditor`, `contract-guardian` et `code-reviewer` en parallele ; decisions de la tranche reportees dans `docs/DECISIONS.md`.
5. `scripts/close-slice.sh`.
6. Si succes : `scripts/ship-slice.sh`, puis tranche suivante si ses dependances sont fusionnees. Si echec : voir conditions d'arret.

## 3. Conditions d'arret — non negociables
Arrete-toi immediatement et attends l'humain si :
- Un audit rend un verdict CRITIQUE, meme si tu penses pouvoir le corriger.
- `contract-guardian` rend BREAKING.
- `code-reviewer` rend `REVIEW: CHANGES` une deuxieme fois apres correctifs.
- Une meme tranche echoue deux fois de suite.
- Une tranche exige d'ecrire hors de son perimetre.
- Une dependance nouvelle serait necessaire.
- Une decision metier manque et devrait etre comblee par une hypothese.
- Le budget est atteint.
- La suite de tests complete echoue apres une cloture.

La regle qui compte : **en cas de doute, tu t'arretes.** Le cout d'une pause est quelques heures d'attente. Le cout d'une decision metier inventee et propagee sur cinq tranches est une reecriture. L'asymetrie est ecrasante et elle doit dicter ton comportement.

Tu ne fusionnes jamais : `gh pr merge` et tout push vers `main` sont bloques. Chaque tranche attend sa PR relue et fusionnee par l'humain.

## 4. Journal
Tiens `docs/04-runbooks/autonomous-run-<date>.md` a jour au fil de l'eau, pas a la fin : si la session est interrompue, le journal doit permettre de reprendre. Par tranche : issue, duree, verdicts d'audit, decisions prises, points a l'attention.

## 5. Rapport final
Tranches closes, tranches arretees et pourquoi, decisions prises en autonomie a valider, etat des branches. Mets en tete ce qui exige une decision humaine — c'est la seule partie que l'humain lira forcement.
