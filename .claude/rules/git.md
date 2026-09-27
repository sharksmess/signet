# Rituel git

Toujours charge. Les hooks git (`.githooks/`) et les hooks agent imposent ces regles ; elles sont ecrites ici pour que tu les suives avant d'etre bloque.

## Branches
- Une tranche = une branche `slice/NNN-nom-court`, creee depuis `main` a jour par `/slice`. Hors tranche : `fix/`, `chore/`, `docs/`.
- Jamais de commit ni de push sur `main`. `main` ne recoit que des PR fusionnees par l'humain.

## Commits
- Un commit par couche terminee et verte : migration, acces donnees, logique metier, API, UI, tests. Chaque commit compile et passe les tests de sa couche.
- Committe au fil de l'eau, pas en fin de tranche : un travail non committe est invisible et perdu a la premiere interruption.
- Message Conventional Commits : `type(portee): resume a l'imperatif`, 72 caracteres max. Types : feat fix test refactor perf docs chore build ci style revert. Le trailer `Slice: NNN` est ajoute automatiquement.
- Apres chaque commit, mets a jour `docs/03-slices/NNN-progress.md` (dernier commit, prochaine etape, blocages).
- `git add` fichier par fichier ou par dossier de la tranche, jamais `git add -A` sans relire `git status --short` : c'est ainsi que `node_modules` ou `.env` entrent dans un depot.

## Livraison
1. `bash scripts/close-slice.sh` — tests, controles, verdicts.
2. `bash scripts/ship-slice.sh` — rebase verifie, push de la branche, PR avec rapport.
3. Tu t'arretes. La CI tourne, l'humain relit et fusionne en squash.

## Interdits
`--no-verify`, `-n`, `git push` vers main, `gh pr merge`, modification de `core.hooksPath`, `push --force` (utilise `--force-with-lease` apres un rebase, sur ta propre branche uniquement).
