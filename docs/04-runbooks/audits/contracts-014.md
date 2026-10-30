# contract-guardian — tranche 014

## 2026-10-30

Rapport contract-guardian, tranche 014 (branche slice/014-controle-origine, diff `git diff main...HEAD`)

Affirmations verifiees sur le diff reel
- Fichiers modifies (12) : `.gates/current-slice`, `.gates/scope-014.txt`, 8 fichiers de documentation (JOURNAL, backlog, tranche, progress, FRICTION, runbooks, DECISIONS), `tests/auth/origin.test.ts` (nouveau) et `tests/helpers/auth.ts`.
- Rien sous `apps/` ni `packages/`. Aucune migration, aucun schema `packages/db`, aucun manifeste (`package.json`, lockfile, `stack.json`). Un filtre sur ces chemins ne renvoie rien. Aucun changement non plus dans `docs/02-architecture/api-contracts/` ni dans `ERD.md`. Aucune route, aucun type partage, aucune dependance ajoutee.
- `tests/helpers/auth.ts` : le diff ne contient que des lignes de commentaire. Le bloc JSDoc de `originHeader()` est reecrit. Une fois les lignes de commentaire exclues, il ne reste aucune ligne ajoutee ou retiree. Le corps de `originHeader()` (`{ Origin: baseUrl() }`) est inchange.
- Signatures exportees `baseUrl`, `uniqueEmail`, `signUp`, `authHeaders` et `AuthenticatedSession` : le diff ne touche aucune de leurs lignes, donc elles sont inchangees pour les autres suites.
- `tests/auth/origin.test.ts` est un ajout pur. Il importe `baseUrl`, `signUp`, `uniqueEmail` depuis le helper, plus `asBypassRls` et `closeAllPools` depuis `../helpers/db`, tous sans modification. Il ne modifie aucun export existant.

Ruptures
- Contrat d'API : aucune.
- Schema de donnees : aucune.
- Enumerations : aucune.
- Evenements ou webhooks : aucun.

Limites : je n'ai pas relance la suite (consigne). Les resultats transmis par l'orchestrateur (75 fichiers, 981 verts, 1 ignore, 0 echec ; `pnpm run check` vert) ne sont pas verifies par moi.

Note, hors contrat : le commentaire du helper dit qu'AC6 est un constat « a valider par l'humain, D-158 ». C'est une decision a arbitrer par l'humain, pas une divergence de contrat.

CONTRACTS: PASS
