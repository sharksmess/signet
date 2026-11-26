#!/usr/bin/env bash
# Le depot porte-t-il deja l'application ? (usine 1.6.6)
# Avant la tranche 001, un projet neuf n'a que son cadrage (PRD, architecture,
# gates) : pas de package.json, donc ni controle de types ni tests possibles.
# Le pre-push et la CI s'en remettent a ce script pour ne pas refuser ce cadrage
# (liste-courses, 30/10/2026 : premier push et PR de cadrage impossibles, D-007).
#
# Usage : bash scripts/app-present.sh [reference-de-base]
# Affiche "app" ou "cadrage" (code 0). Refuse (code 1) un depot incoherent :
# du code versionne sans package.json, ou un package.json present sur la base
# et supprime ici. Supprimer package.json ne fait pas un depot de cadrage.
set -uo pipefail
BASE="${1:-}"
if git cat-file -e HEAD:package.json 2>/dev/null || [ -f package.json ]; then echo app; exit 0; fi
CODE=$(git ls-files -- apps packages | head -3)
if [ -n "$CODE" ]; then
  printf 'package.json absent alors que du code est versionne :\n%s\n' "$CODE" >&2; exit 1
fi
if [ -n "$BASE" ] && git cat-file -e "$BASE:package.json" 2>/dev/null; then
  printf 'package.json existe sur %s et manque ici : sa suppression ne fait pas un depot de cadrage.\n' "$BASE" >&2; exit 1
fi
echo cadrage
