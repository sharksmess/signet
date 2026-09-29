#!/usr/bin/env bash
# Rituel de livraison d'une tranche : pousse la branche et ouvre la PR.
# Pre-requis : scripts/close-slice.sh vert, gh authentifie (gh auth status).
# La fusion reste un gate humain : ce script ne fusionne jamais.
set -uo pipefail
ROOT=$(git rev-parse --show-toplevel) || exit 1
cd "$ROOT" || exit 1
fail() { printf 'ECHEC: %s\n' "$1" >&2; exit 1; }

BRANCH=$(git symbolic-ref --short HEAD)
SLICE=$(printf '%s' "$BRANCH" | sed -nE 's#^slice/([0-9]{3})-.*#\1#p')
[ -n "$SLICE" ] || fail "branche '$BRANCH' : attendu slice/NNN-nom."
[ -f ".gates/slice-$SLICE.closed" ] || fail "tranche $SLICE non close : lance d'abord scripts/close-slice.sh."
[ -z "$(git status --porcelain)" ] || fail "arbre de travail non propre : committe ou retire les modifications."
command -v gh >/dev/null || fail "gh (GitHub CLI) introuvable."
gh auth status >/dev/null 2>&1 || fail "gh non authentifie : l'humain lance 'gh auth login'."
git remote get-url origin >/dev/null 2>&1 || fail "aucun remote origin : l'humain lance scripts/github-setup.ps1."

git fetch -q origin main || fail "fetch origin/main impossible."
BEHIND=$(git rev-list --count HEAD..origin/main)
[ "$BEHIND" -eq 0 ] || fail "branche en retard de $BEHIND commit(s) sur main : git rebase origin/main, relance les tests, puis recommence."

DOC=$(ls docs/03-slices/"$SLICE"-*.md 2>/dev/null | grep -v progress | head -1)
TITLE=$(head -1 "$DOC" 2>/dev/null | sed -E 's/^# *//')
[ -n "$TITLE" ] || TITLE="tranche $SLICE"

EVID="docs/04-runbooks/evidence/$SLICE.md"
[ -f "$EVID" ] || fail "fiche de preuves $EVID absente : relance scripts/close-slice.sh."

BODY=$(mktemp)
{
  printf '## Tranche %s\n\n%s — `%s`\n\n' "$SLICE" "$TITLE" "$DOC"
  printf '## Preuves (decision de fusion)\n\n'
  sed -n '/^| Preuve/,/^$/p' "$EVID"
  printf 'Fiche complete : `%s`. Rapports : `docs/04-runbooks/audits/{audit,contracts,review}-%s.md`.\n\n' "$EVID" "$SLICE"
  printf '## Criteres d acceptation\n\n'
  grep -E '^- \[[ x]\] AC' "$DOC" 2>/dev/null || printf '(introuvables dans le contrat)\n'
  printf '\n## Commits\n\n'
  git log --format='- %s' origin/main..HEAD
  if [ -f "docs/03-slices/$SLICE-progress.md" ]; then
    printf '\n## Decisions et points d attention (journal)\n\n'
    sed -n '/^## Decisions/,$p' "docs/03-slices/$SLICE-progress.md" | sed '1d'
  fi
  printf '\n---\nFusion : gate humain, **sur preuves** (tableau ci-dessus + CI verte), sans relecture humaine du code. Methode : squash ; le commit reprend cette description.\n\nSlice: %s\n' "$SLICE"
} > "$BODY"

git push -u origin "$BRANCH" || fail "push refuse (voir pre-push ci-dessus)."
if gh pr view "$BRANCH" >/dev/null 2>&1; then
  gh pr edit "$BRANCH" --body-file "$BODY" >/dev/null && printf 'PR mise a jour.\n'
else
  gh pr create --base main --head "$BRANCH" --title "feat: tranche $SLICE — $TITLE" --body-file "$BODY" || fail "creation de PR impossible."
fi
rm -f "$BODY"
gh pr view "$BRANCH" --json url -q .url
printf 'PR ouverte. La CI tourne ; la fusion appartient a l humain.\n'
