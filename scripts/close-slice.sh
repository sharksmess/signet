#!/usr/bin/env bash
# Gate machine : franchissable par un agent, mais non falsifiable pour sa
# partie mecanique. N'ecrit la cloture que si TOUTES les conditions tiennent,
# puis la committe. Le verdict d'audit, lui, est recopie par l'orchestrateur :
# sa fidelite repose sur la relecture humaine du rapport versionne.
set -uo pipefail
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-$PWD}")
cd "$ROOT" || exit 1
FAIL=0
say() { printf '%s\n' "$1"; }
bad() { printf 'ECHEC: %s\n' "$1"; FAIL=1; }

SLICE=$(tr -d ' \r\n' < .gates/current-slice 2>/dev/null || true)
[ -z "$SLICE" ] && { say "Aucune tranche active (.gates/current-slice absent)."; exit 1; }
say "=== Cloture de la tranche $SLICE ==="

# 0. Branche et arbre propres : on clot ce qui est committe, rien d'autre.
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
case "$BRANCH" in slice/"$SLICE"-*) ;; *) bad "branche '$BRANCH' : attendu slice/$SLICE-nom." ;; esac
[ -z "$(git status --porcelain --untracked-files=normal)" ] || bad "modifications non committees : ce qui serait clos ne serait pas ce qui est teste."

# 1. Controles statiques : script "check" du package.json (types + lint).
if node -e "process.exit(require('./package.json').scripts?.check ? 0 : 1)" 2>/dev/null; then
  say "-- pnpm run check"; pnpm run check || bad "controle de types ou lint en echec"
else
  bad "aucun script \"check\" dans package.json. Attendu : types + lint, ex. \"check\": \"pnpm typecheck && pnpm lint\"."
fi

# 2. Suite de tests complete, contre la vraie base de test.
say "-- pnpm test"; pnpm test || bad "la suite de tests ne passe pas"

# 3. Audit des dependances de production
say "-- pnpm audit --prod --audit-level=high"
pnpm audit --prod --audit-level=high >/dev/null 2>&1 || bad "vulnerabilites hautes ou critiques en production (pnpm audit --prod)."

# 4. Verdicts des auditeurs, versionnes
AUDIT="docs/04-runbooks/audits/audit-$SLICE.md"
CONTRACT="docs/04-runbooks/audits/contracts-$SLICE.md"
[ -f "$AUDIT" ]    || bad "rapport de securite absent ($AUDIT)"
[ -f "$CONTRACT" ] || bad "rapport de contrats absent ($CONTRACT)"
[ "$(tail -1 "$AUDIT" 2>/dev/null | tr -d '\r')" = "AUDIT: PASS" ] || bad "la derniere ligne de $AUDIT n'est pas 'AUDIT: PASS'"
[ "$(tail -1 "$CONTRACT" 2>/dev/null | tr -d '\r')" = "CONTRACTS: PASS" ] || bad "la derniere ligne de $CONTRACT n'est pas 'CONTRACTS: PASS'"

# 5. Contrat et journal
DOC=$(ls docs/03-slices/"$SLICE"-*.md 2>/dev/null | grep -v -- '-progress\.md$' | head -1)
if [ -n "$DOC" ]; then
  grep -qE '^- \[ \] AC' "$DOC" && bad "criteres d'acceptation non coches dans $DOC"
  grep -qi 'tenant' "$DOC" || bad "aucun critere d'isolation tenant dans la tranche"
else
  bad "contrat de tranche introuvable (docs/03-slices/$SLICE-*.md)"
fi
[ -f "docs/03-slices/$SLICE-progress.md" ] || bad "journal docs/03-slices/$SLICE-progress.md absent"

# 6. Aucun marqueur TODO dans le code modifie par la tranche
BASE=$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main 2>/dev/null || echo "")
if [ -n "$BASE" ]; then
  TODOS=$(git diff --name-only "$BASE"...HEAD -- apps packages 2>/dev/null | while read -r f; do [ -f "$f" ] && grep -lE '(TODO|FIXME|XXX)' "$f"; done)
  [ -n "$TODOS" ] && bad "marqueurs TODO/FIXME : $TODOS"
fi

if [ "$FAIL" -ne 0 ]; then
  say "=== Tranche $SLICE NON close. Corrige les points ci-dessus. ==="
  exit 1
fi

touch ".gates/slice-$SLICE.closed"
rm -f .gates/current-slice
git add -A .gates
git commit -q -m "chore(slice-$SLICE): cloturer la tranche" || { say "ECHEC: commit de cloture impossible."; exit 1; }
say "=== Tranche $SLICE close et committee. Suite : bash scripts/ship-slice.sh ==="
