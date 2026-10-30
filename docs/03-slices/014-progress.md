# 014 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : tests verts (AC1 a AC9 coches dans le contrat)
- Branche : slice/014-controle-origine
- Dernier commit : commit « docs(slice-014): criteres prouves et journal de tranche » (precedents : 5ba6979 docs(slice-014): corriger le commentaire du helper d'origine ; 0c77127 test(slice-014): prouver le controle d'origine de better-auth)
- Prochaine etape : trois relecteurs (`security-auditor`, `contract-guardian`, `code-reviewer`), registre, puis `bash scripts/close-slice.sh` (orchestrateur)

## Couches
Tranche de tests et de documentation seulement (D-157) : aucune migration, aucun acces donnees, aucune logique metier, aucune API, aucune UI.
- [x] Tests de preuve (`tests/auth/origin.test.ts`, AC1 a AC6) — 0c77127, 10 tests verts
- [x] Commentaire de `tests/helpers/auth.ts` (AC7) — 5ba6979, commentaire seul (diff verifie), `pnpm run check` vert
- [x] Suite complete verte + `pnpm run check` — 75 fichiers, 981 verts, 1 ignore, 0 echec, 309,74 s (seconde execution ; la premiere : 1 echec par delai sans lien avec la tranche, voir FRICTION 2026-10-30)

## Verifications ponctuelles
- AC8 : `tests/isolation-hardening/**` vert dans la suite complete, aucun fichier de ce dossier dans `git diff --name-only main...HEAD`.
- AC9 : `git diff --stat main...HEAD` = 12 fichiers, 441 insertions, 11 suppressions ; aucun fichier sous `apps/`, `packages/`, `tests/_factory/`, aucune migration, aucun manifeste, aucune configuration (les seuls fichiers hors `docs/` et `tests/` sont `.gates/current-slice` et `.gates/scope-014.txt`, poses par l'ouverture de la tranche). A recopier sous `## Complements` de la fiche de preuves.

## Blocages
<!-- cause, essais, options. Vide = aucun. -->
Aucun.

## Decisions
<!-- Toute decision prise sans l'humain, avec sa raison. Reprise dans la PR. -->
- Lectures de l'orchestrateur a l'ouverture : voir le contrat, section « Lectures de l'orchestrateur », et D-158.
- Implementeur, premier passage de la suite complete en echec (`tests/billing/processing.test.ts` AC3 (e), « Test timed out in 20000ms » apres 171 s) : traite comme un delai sous charge, sans lien avec la tranche (le test appelle `signUp`, dont le code est inchange ; seul un commentaire a change). Raison : fichier rejoue seul vert (31/31, 38 s), puis **une** relance de la suite complete verte, selon le precedent de FRICTION (2026-10-20, 2026-10-29). Options ecartees : modifier le delai ou l'assertion du test (interdit, hors perimetre) ; arreter sans relance (l'echec n'etait pas une assertion et le fichier seul passait). Incident consigne dans `docs/04-runbooks/FRICTION.md`.
- Aucune autre decision hors contrat.
