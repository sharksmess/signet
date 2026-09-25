---
name: audit-scope-worktree
description: Lors d'un re-audit de tranche, les correctifs arrivent non-committes — auditer l'arbre de travail, pas seulement git diff master...HEAD
metadata:
  type: project
---

Lors d'un **re-audit** de tranche (2e passe apres correction), les correctifs sont
typiquement encore **non committes** dans le worktree : `git diff master...HEAD`
ne les montre pas du tout (nouvelles migrations en `??` untracked, tests modifies
en ` M`).

**Why:** au 2e audit de la tranche 001 (2026-09-25), `git diff --stat master...HEAD`
retournait exactement le meme resultat qu'au 1er audit (40 fichiers / 5960
insertions) alors que la migration 0005 et trois nouveaux tests existaient sur
disque. Conclure « aucun correctif trouve » aurait ete un faux constat.

**How to apply:** commencer tout audit par `git status --porcelain` en plus du
`git diff` contre la base. Si des fichiers sont untracked ou modifies, ils font
partie du perimetre a auditer. Lire les fichiers sur disque, pas la version
committee.

Voir aussi [[audit-verifier-les-tests-pas-que-le-correctif]].
