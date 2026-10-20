#!/usr/bin/env bash
# Rejoue l'etape Build de la CI, a l'identique (usine 1.6, liste blanche en 1.6.2).
# La construction part d'un environnement VIDE : seules passent les variables du
# systeme (chemins, dossiers, langue) et celles de ci/build.env (valeurs inventees,
# versionnees). Ni le terminal local ni le job de CI ne peuvent y ajouter une
# variable de l'application : en 1.6.0, une liste noire laissait passer
# AUTH_RATE_LIMIT pose par le job de CI (Signet, PR #28). Appele par la CI
# (.github/workflows/ci.yml) et par scripts/close-slice.sh.
set -uo pipefail
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT" || exit 1
ENVF="ci/build.env"

# Variables du systeme, utiles a node, pnpm et git, sous Linux comme sous Windows.
KEEP='^(PATH|Path|HOME|USER|USERNAME|LOGNAME|SHELL|TERM|LANG|LANGUAGE|LC_[A-Z]+|TZ|TMPDIR|TEMP|TMP|SYSTEMROOT|SystemRoot|SYSTEMDRIVE|SystemDrive|WINDIR|windir|COMSPEC|ComSpec|PATHEXT|APPDATA|LOCALAPPDATA|USERPROFILE|HOMEDRIVE|HOMEPATH|PROGRAMFILES|ProgramFiles|PROGRAMDATA|ProgramData|ProgramW6432|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|PNPM_HOME|COREPACK_HOME|XDG_[A-Z_]+)$'
ARGS=()
while IFS= read -r -d '' kv; do
  name=${kv%%=*}
  [[ $name =~ $KEEP ]] && ARGS+=("$kv")
done < <(env -0)

# Variables de l'application : uniquement ci/build.env (NOM=valeur, une par ligne).
if [ -f "$ENVF" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    case "$line" in ''|\#*) continue ;; esac
    [[ $line =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || { echo "ECHEC: ligne invalide dans $ENVF : ${line%%=*}"; exit 1; }
    ARGS+=("$line")
  done < "$ENVF"
fi

exec env -i "${ARGS[@]}" CI=true pnpm run --if-present build
