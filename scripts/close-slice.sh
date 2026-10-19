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

LOG=$(mktemp -d)
strip() { sed -E 's/\x1b\[[0-9;]*m//g' "$1" | tr -d '\r'; }
R_CHECK="ECHEC"; R_TEST="ECHEC"; R_AUDIT="ECHEC"

# 1. Socle reproductible : la CI installe la version de pnpm declaree ici.
node -e "process.exit(require('./package.json').packageManager ? 0 : 1)" 2>/dev/null \
  || bad "package.json sans \"packageManager\" : la CI ne saura pas quelle version de pnpm installer (install-project le pose)."

# 2. Controles statiques : script "check" du package.json (types + lint).
if node -e "process.exit(require('./package.json').scripts?.check ? 0 : 1)" 2>/dev/null; then
  say "-- pnpm run check"
  if pnpm run check > "$LOG/check.txt" 2>&1; then R_CHECK="PASS"; else bad "controle de types ou lint en echec"; tail -30 "$LOG/check.txt"; fi
else
  bad "aucun script \"check\" dans package.json. Attendu : types + lint, ex. \"check\": \"pnpm typecheck && pnpm lint\"."
fi

# 3. Suite de tests complete, contre la vraie base de test.
say "-- pnpm test"
if pnpm test > "$LOG/test.txt" 2>&1; then R_TEST="PASS"; else bad "la suite de tests ne passe pas"; strip "$LOG/test.txt" | tail -40; fi
TEST_SUMMARY=$(strip "$LOG/test.txt" | grep -E '^ *(Test Files|Tests) ' | sed -E 's/^ +//' | paste -sd ';' - | sed 's/;/ ; /')
say "   ${TEST_SUMMARY:-(resume des tests introuvable)}"

# 4. Audit des dependances de production
say "-- pnpm audit --prod --audit-level=high"
if pnpm audit --prod --audit-level=high > "$LOG/audit.txt" 2>&1; then R_AUDIT="PASS"; else bad "vulnerabilites hautes ou critiques en production (pnpm audit --prod)."; fi

BASE=$(git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD main 2>/dev/null || echo "")

# 4b. Etape Build de la CI, rejouee a l'identique (usine 1.6) : construction avec
# le seul environnement de ci/build.env. Les tests locaux recoivent tout
# l'environnement du serveur de test ; la CI, non (Signet D-079).
R_BUILD="ECHEC"
if [ -f scripts/ci-build.sh ]; then
  say "-- bash scripts/ci-build.sh (etape Build de la CI)"
  if bash scripts/ci-build.sh > "$LOG/build.txt" 2>&1; then R_BUILD="PASS"; else bad "l'etape Build de la CI echoue avec le seul environnement de ci/build.env"; strip "$LOG/build.txt" | tail -25; fi
else
  bad "scripts/ci-build.sh absent : l'etape Build de la CI ne peut pas etre rejouee en local (install-project le pose)."
fi

# 4c. Recherche de secrets, comme la CI (gitleaks), si l'outil est installe.
R_SECRETS="non installe localement (CI seule)"
if command -v gitleaks >/dev/null 2>&1; then
  say "-- gitleaks (historique de la branche)"
  RANGE="${BASE:+$BASE..}HEAD"
  if gitleaks git --no-banner --log-opts="$RANGE" . > "$LOG/leaks.txt" 2>&1 \
     || { grep -q 'unknown command' "$LOG/leaks.txt" && gitleaks detect --no-banner --log-opts="$RANGE" > "$LOG/leaks.txt" 2>&1; }; then
    R_SECRETS="PASS"
  else
    bad "gitleaks signale des secrets potentiels dans l'historique de la branche"; strip "$LOG/leaks.txt" | grep -E 'RuleID|File|Line|Commit' | head -20
  fi
else
  say "   AVERTISSEMENT : gitleaks absent, la recherche de secrets ne sera faite que par la CI (WINDOWS.md)."
fi

# 5. Verdicts des trois relecteurs independants, versionnes
verdict() { # verdict <fichier> <attendu> <libelle>
  [ -f "$1" ] || { bad "rapport $3 absent ($1)"; return; }
  [ "$(tail -1 "$1" | tr -d '\r')" = "$2" ] || bad "la derniere ligne de $1 n'est pas '$2'"
}
AUDIT="docs/04-runbooks/audits/audit-$SLICE.md"
CONTRACT="docs/04-runbooks/audits/contracts-$SLICE.md"
REVIEW="docs/04-runbooks/audits/review-$SLICE.md"
verdict "$AUDIT" "AUDIT: PASS" "de securite"
verdict "$CONTRACT" "CONTRACTS: PASS" "de contrats"
verdict "$REVIEW" "REVIEW: PASS" "de relecture de code"

# 6. Contrat et journal
DOC=$(ls docs/03-slices/"$SLICE"-*.md 2>/dev/null | grep -v -- '-progress\.md$' | head -1)
if [ -n "$DOC" ]; then
  # Format du gabarit : "- [x] AC1 — ..." ; le numero en gras est tolere (Signet D-080).
  grep -qE '^- \[ \] (\*\*)?AC[0-9]' "$DOC" && bad "criteres d'acceptation non coches dans $DOC"
  NB_AC=$(grep -cE '^- \[[xX]\] (\*\*)?AC[0-9]' "$DOC" 2>/dev/null); NB_AC=${NB_AC:-0}
  [ "$NB_AC" -gt 0 ] || bad "aucun critere d'acceptation coche reconnu dans $DOC (format attendu : « - [x] AC1 — ... »)"
  grep -qi 'tenant' "$DOC" || bad "aucun critere d'isolation tenant dans la tranche"
else
  bad "contrat de tranche introuvable (docs/03-slices/$SLICE-*.md)"
fi
PROG="docs/03-slices/$SLICE-progress.md"
if [ -f "$PROG" ]; then
  DECS=$(sed -n '/^## Decisions/,/^## /p' "$PROG" | grep -vE '^## |^\s*$|^\s*<!--' | head -1)
  [ -n "$DECS" ] || bad "section « Decisions » vide dans $PROG : ecris les decisions prises, ou « Aucune decision hors contrat »."
else
  bad "journal $PROG absent"
fi

# 7. Tout est documente (rules/documentation.md) : controles mecaniques.
if [ -f docs/DECISIONS.md ]; then
  grep -qiE "(tranche|slice)[ -]*$SLICE" docs/DECISIONS.md || bad "docs/DECISIONS.md ne cite pas la tranche $SLICE : ajoute les decisions de la tranche au registre."
else
  bad "registre docs/DECISIONS.md absent (gabarit : docs/templates/DECISIONS.md)."
fi
if [ -f docs/00-context/JOURNAL.md ]; then
  grep -qiE "(tranche|slice)[ -]*$SLICE" docs/00-context/JOURNAL.md || bad "journal de projet : aucune entree pour la tranche $SLICE dans docs/00-context/JOURNAL.md (gabarit : docs/templates/JOURNAL-ENTREE.md)."
else
  bad "journal de projet docs/00-context/JOURNAL.md absent (gabarit : docs/templates/JOURNAL.md)."
fi

if [ -n "$BASE" ]; then
  # Dependance ajoutee => un ADR la nomme.
  NEWDEPS=$(git diff "$BASE"...HEAD -- package.json '*/package.json' 2>/dev/null \
    | grep -E '^\+ +"(@?[a-z0-9][a-z0-9._/-]*)": *"[~^]?[0-9]' | sed -E 's/^\+ +"([^"]+)".*/\1/' | grep -vxE 'version|name|node|pnpm|npm' | sort -u)
  # Distinguer ajout et changement de version : present dans un package.json de la base = changement.
  BASEPKG=$(git diff --name-only "$BASE"...HEAD -- package.json '*/package.json' 2>/dev/null | while read -r f; do git show "$BASE:$f" 2>/dev/null; done)
  ADDED=""; CHANGED=""
  for d in $NEWDEPS; do
    grep -rqF -- "$d" docs/02-architecture/ADR/ 2>/dev/null || bad "dependance '$d' ajoutee ou modifiee sans ADR qui la nomme (docs/02-architecture/ADR/)."
    if printf '%s' "$BASEPKG" | grep -qF "\"$d\":"; then CHANGED="$CHANGED $d"; else ADDED="$ADDED $d"; fi
  done
  # Migration ajoutee => ERD mis a jour dans la meme tranche.
  if git diff --name-only --diff-filter=A "$BASE"...HEAD | grep -qE '(^|/)migrations/[^/]+\.sql$'; then
    git diff --name-only "$BASE"...HEAD | grep -q 'docs/02-architecture/ERD.md' \
      || bad "migration ajoutee sans mise a jour de docs/02-architecture/ERD.md."
  fi
  # 8. Aucun marqueur TODO dans le code modifie par la tranche
  TODOS=$(git diff --name-only "$BASE"...HEAD -- apps packages 2>/dev/null | while read -r f; do [ -f "$f" ] && grep -lE '(TODO|FIXME|XXX)' "$f"; done)
  [ -n "$TODOS" ] && bad "marqueurs TODO/FIXME : $TODOS"
fi

if [ "$FAIL" -ne 0 ]; then
  rm -rf "$LOG"
  say "=== CLOTURE REFUSEE : tranche $SLICE NON close. Corrige les points ci-dessus. ==="
  exit 1
fi

# Fiche de preuves : ce que l'humain lit pour decider de la fusion, et ce qu'un
# auditeur externe retrouve dans l'historique. Produite par la machine, jamais recopiee.
EVID="docs/04-runbooks/evidence/$SLICE.md"
mkdir -p "$(dirname "$EVID")"
{
  printf '# Preuves de la tranche %s\n\n' "$SLICE"
  printf 'Produit par `scripts/close-slice.sh` le %s, sur le commit `%s` (branche `%s`).\n\n' "$(date '+%Y-%m-%d %H:%M')" "$(git rev-parse --short HEAD)" "$BRANCH"
  printf '| Preuve | Resultat |\n|---|---|\n'
  printf '| `pnpm run check` (types + lint) | %s |\n' "$R_CHECK"
  printf '| `pnpm test` (base Postgres reelle) | %s — %s |\n' "$R_TEST" "${TEST_SUMMARY:-resume introuvable}"
  printf '| `pnpm audit --prod --audit-level=high` | %s |\n' "$R_AUDIT"
  printf '| Etape Build de la CI (`scripts/ci-build.sh`) | %s |\n' "$R_BUILD"
  printf '| Secrets, gitleaks local | %s |\n' "$R_SECRETS"
  printf '| Securite (`security-auditor`) | %s |\n' "$(tail -1 "$AUDIT" | tr -d '\r')"
  printf '| Contrats (`contract-guardian`) | %s |\n' "$(tail -1 "$CONTRACT" | tr -d '\r')"
  printf '| Relecture de code (`code-reviewer`) | %s |\n' "$(tail -1 "$REVIEW" | tr -d '\r')"
  printf '| Criteres d acceptation coches | %s |\n' "$NB_AC"
  printf '| Dependances ajoutees | %s |\n' "${ADDED:- aucune}"
  printf '| Dependances changees de version | %s |\n' "${CHANGED:- aucune}"
  printf '\nLa CI rejoue check, tests, build, audit et recherche de secrets sur un serveur neutre ; son resultat est attache a la PR.\n'
} > "$EVID"
rm -rf "$LOG"

touch ".gates/slice-$SLICE.closed"
rm -f .gates/current-slice
git add -A .gates "$EVID"
git commit -q -m "chore(slice-$SLICE): cloturer la tranche" || { say "ECHEC: commit de cloture impossible."; exit 1; }
say "=== CLOTURE REUSSIE : tranche $SLICE close et committee ($(git rev-parse --short HEAD)). Suite : bash scripts/ship-slice.sh ==="
