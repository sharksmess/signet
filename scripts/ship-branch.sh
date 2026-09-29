#!/usr/bin/env bash
# Livraison d'une branche hors tranche (fix/, chore/, docs/) : pousse et ouvre
# la PR. Meme rituel que ship-slice.sh, sans cloture de tranche : le hook
# pre-push rejoue controles et tests, la CI les rejoue sur serveur neutre, la
# fusion reste un gate humain. Usage : bash scripts/ship-branch.sh ["titre de PR"]
set -uo pipefail
ROOT=$(git rev-parse --show-toplevel) || exit 1
cd "$ROOT" || exit 1
fail() { printf 'ECHEC: %s\n' "$1" >&2; exit 1; }

BRANCH=$(git symbolic-ref --short HEAD)
case "$BRANCH" in fix/*|chore/*|docs/*) ;; slice/*) fail "branche de tranche : utilise scripts/ship-slice.sh." ;;
  *) fail "branche '$BRANCH' : attendu fix/, chore/ ou docs/." ;; esac
[ -z "$(git status --porcelain)" ] || fail "arbre de travail non propre : committe ou retire les modifications."
command -v gh >/dev/null || fail "gh (GitHub CLI) introuvable."
gh auth status >/dev/null 2>&1 || fail "gh non authentifie : l'humain lance 'gh auth login'."
git fetch -q origin main || fail "fetch origin/main impossible."
[ "$(git rev-list --count HEAD..origin/main)" -eq 0 ] || fail "branche en retard sur main : git rebase origin/main, relance les tests, puis recommence."
[ "$(git rev-list --count origin/main..HEAD)" -gt 0 ] || fail "aucun commit a livrer."

TITLE=${1:-$(git log --reverse --format=%s origin/main..HEAD | head -1)}
BODY=$(mktemp)
{
  printf '## Objet\n\n%s\n\n## Commits\n\n' "$TITLE"
  git log --reverse --format='- %s' origin/main..HEAD
  printf '\n## Fichiers\n\n```\n'; git diff --stat origin/main...HEAD | tail -25; printf '```\n'
  if git diff --name-only origin/main...HEAD | grep -q '^docs/DECISIONS.md$'; then
    printf '\n## Decisions ajoutees au registre\n\n'
    git diff -U0 origin/main...HEAD -- docs/DECISIONS.md | grep -E '^\+\| D-' | sed 's/^+//'
  fi
  printf '\n---\nPreuves : hook pre-push (check + tests) passe en local ; CI `ci` sur la PR. Fusion : gate humain, squash.\n'
} > "$BODY"

git push -u origin "$BRANCH" || fail "push refuse (voir pre-push ci-dessus)."
if gh pr view "$BRANCH" >/dev/null 2>&1; then
  gh pr edit "$BRANCH" --body-file "$BODY" >/dev/null && printf 'PR mise a jour.\n'
else
  gh pr create --base main --head "$BRANCH" --title "$TITLE" --body-file "$BODY" || fail "creation de PR impossible."
fi
rm -f "$BODY"
gh pr view "$BRANCH" --json url -q .url
