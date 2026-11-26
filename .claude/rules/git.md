# Rituel git

Toujours charge. Les hooks git (`.githooks/`) et les hooks agent imposent ces regles ; elles sont ecrites ici pour que tu les suives avant d'etre bloque.

## Branches
- Une tranche = une branche `slice/NNN-nom-court`, creee depuis `main` a jour par `/slice`. Hors tranche : `fix/`, `chore/`, `docs/`.
- Jamais de commit ni de push sur `main`. `main` ne recoit que des PR fusionnees par l'humain.

## Commits
- Un commit par couche terminee et verte : migration, acces donnees, logique metier, API, UI, tests. Chaque commit passe les tests de sa couche. Exception connue (usine 1.6.7, liste-courses 004) : les tests sont ecrits avant le code, et un test qui importe un module d'une couche suivante rend le controle de types rouge jusqu'a cette couche ; le message du commit le dit alors (`typecheck attendu rouge : <module>`). Lis chaque resultat avant le commit suivant : pas d'enchainement par `;` qui masque une erreur.
- Committe au fil de l'eau, pas en fin de tranche : un travail non committe est invisible et perdu a la premiere interruption.
- Message Conventional Commits : `type(portee): resume a l'imperatif`, 72 caracteres max. Types : feat fix test refactor perf docs chore build ci style revert. Le trailer `Slice: NNN` est ajoute automatiquement.
- Apres chaque commit, mets a jour `docs/03-slices/NNN-progress.md` (dernier commit, prochaine etape, blocages).
- `git add` fichier par fichier ou par dossier de la tranche, jamais `git add -A` sans relire `git status --short` : c'est ainsi que `node_modules` ou `.env` entrent dans un depot.

## Livraison
1. `bash scripts/close-slice.sh` — tests, controles, verdicts.
2. `bash scripts/ship-slice.sh` — rebase verifie, push de la branche, PR avec rapport.
3. Tu t'arretes. La CI tourne ; l'humain decide de la fusion **sur preuves** (fiche `docs/04-runbooks/evidence/NNN.md`, verdicts des trois relecteurs, CI verte), sans relire le code, et fusionne en squash. Le commit de squash reprend la description de la PR.
4. Hors tranche (`fix/`, `chore/`, `docs/`) : `bash scripts/ship-branch.sh "type: titre"`.
5. **PR deja ouverte** (usine 1.6.7) : un nouveau commit part par une relance du meme script (`ship-slice.sh` ou `ship-branch.sh`), qui regenere la description, jamais par un `git push` seul, qui la laisse perimee. Le commit de squash reprend cette description (liste-courses PR #3, #5). Les ajouts manuels a la description sont ecrases : mets-les dans le registre ou le journal.

## Sorties des scripts et des tests
Jamais de sortie coupee (`tail`, `head`, `| grep`) sur `pnpm test`, `pnpm run check`, un `git push` ou un script de l'usine : en cas d'echec, la cause est perdue (liste-courses 002 : un echec du pre-push reste inexplique). Sortie complete redirigee dans `.logs/<etape>.log` (ignore par git), lue ensuite. `close-slice.sh` conserve la sienne dans `.logs/close-slice-NNN/`.

## Interdits
`--no-verify`, `-n`, `git push` vers main, `gh pr merge`, modification de `core.hooksPath`, `push --force` (utilise `--force-with-lease` apres un rebase, sur ta propre branche uniquement).
