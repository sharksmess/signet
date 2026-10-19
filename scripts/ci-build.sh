#!/usr/bin/env bash
# Rejoue l'etape Build de la CI, a l'identique (usine 1.6).
# La CI construit l'application avec le seul environnement de ci/build.env
# (valeurs inventees, versionnees). En local, les tests construisent avec tout
# l'environnement du serveur de test : un module qui lit un secret au chargement
# passe en local et casse la CI (Signet D-079). Ce script ferme cet ecart.
# Appele par la CI (.github/workflows/ci.yml) et par scripts/close-slice.sh.
set -uo pipefail
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT" || exit 1
ENVF="ci/build.env"
(
  # Aucune variable applicative heritee du terminal : seules celles de ci/build.env.
  for v in $(grep -hoE '^[A-Z][A-Z0-9_]*=' .env.example .env.test.example 2>/dev/null | tr -d '=' | sort -u); do unset "$v"; done
  for v in $(env | grep -oE '^TEST_[A-Z0-9_]*' | sort -u); do unset "$v"; done
  if [ -f "$ENVF" ]; then set -a; . "./$ENVF"; set +a; fi
  export CI=true
  pnpm run --if-present build
)
