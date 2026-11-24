# Consigne — avis transitifs avant l'usine 1.6.7 (branche `fix/audit-transitifs`)

Redigee par l'orchestrateur (cowork) le 2026-11-24. Prealable : la PR du correctif Next.js 16.4.5 (D-162, D-163) est fusionnee. Chemin : **correctif de securite hors tranche** de `.claude/rules/dependencies.md`. Lis cette regle, `.claude/rules/git.md` et `.claude/rules/documentation.md`. Conventional Commits de 72 caracteres au plus, `git --no-pager`. **Tout au premier plan, aucune sortie coupee** : sortie complete dans `.logs/<etape>.log`, puis lue. Tu ne touches ni au code d'`apps/` ou de `packages/` (hors manifestes et `pnpm-workspace.yaml`), ni a `tests/`.

## Objet
Les trois points du backlog « avant l'usine 1.6.7 » :
- (a) `next@16.3.8`, copie installee pour `@inngest/test` (developpement) : GHSA-2464-fhr4-w9xw et GHSA-673q-mjm6-r5xr (critiques), GHSA-p3m5-59mp-jv5r (eleve) ;
- (b) `glob`, GHSA-3g3m-2fjr-6pw4 (modere), en production par `inngest → … → gaxios → rimraf → glob` ;
- (c) `minimatch`, GHSA-g3hv-75wg-m249 (modere), en developpement par `typescript-eslint` et en production sous le `glob` du point (b).

But : `pnpm audit --prod --audit-level=moderate` propre (seuil de l'usine 1.6.7), et plus aucun avis `high` ou `critical`, meme en developpement.

## Ce que l'humain a deja decide (a inscrire au registre, prochain numero libre)
- **Correctif groupe (humain, 2026-11-24)** : les points (a), (b) et (c) sont traites ensemble, sur une seule branche `fix/`, avant l'adoption de l'usine 1.6.7, dont l'audit au seuil modere refuserait sinon toute cloture.

## Etape 1 — Analyse (lecture seule, rien de modifie)
Depuis `main` a jour, `git switch -c fix/audit-transitifs`. Pour chaque point : `pnpm why <paquet>` (chemins exacts), versions vulnerables et corrigees (registre npm), et ce qu'un correctif exigerait :
- (a) une version plus recente de `@inngest/test` qui depende d'un Next corrige, sinon une substitution ciblee `"@inngest/test>next": "16.4.5"` dans les `overrides` de `pnpm-workspace.yaml` ;
- (b) et (c) la plus petite version corrigee de `glob` et de `minimatch` **dans la plage declaree par le paquet qui les demande** (`rimraf`, `typescript-eslint`...), par `overrides` cibles sur ce chemin.
Choisis toujours la plus petite version corrigee, hors quarantaine. Ecris l'analyse dans `.logs/audit-transitifs-analyse.log`.

**Arrete-toi sans rien modifier** (rapport avec l'analyse et les options) si un point exige : une version majeure hors de la plage declaree ; une version encore en quarantaine ; un changement de code ou de test ; une dependance nouvelle ; ou si aucun correctif n'existe. Dans ce dernier cas, dis si l'avis s'applique a notre usage (comme liste-courses l'a fait pour `minimatch`, sa decision D-051), avec les sources : l'humain decidera de l'ecarter par `auditConfig.ignoreGhsas` ou non.

## Etape 2 — Correctif (seulement si l'etape 1 n'a rien arrete)
- `overrides` (et, pour (a), la version de `@inngest/test` si c'est l'option retenue), chacun avec l'avis cite en commentaire. `pnpm install`. Verifie dans le lockfile que seuls les paquets vises changent.
- `pnpm test`, `pnpm run check`, `pnpm audit --prod --audit-level=moderate` et `pnpm audit --audit-level=high`, sorties completes dans `.logs/` : tout vert, plus aucun des avis vises.
Commit : `fix(deps): avis transitifs (next d'@inngest/test, glob, minimatch)`.

## Etape 3 — Documentation
Registre (decision humaine ci-dessus et ta decision technique : avis, chemins, versions, options ecartees) ; ADR des versions ; backlog (les trois points passent a « fait » avec le numero de la decision) ; FRICTION seulement si incident. Commit : `docs: avis transitifs avant l'usine 1.6.7`, avec cette consigne.

## Etape 4 — Livraison
`bash scripts/ship-branch.sh "fix(deps): avis transitifs avant l'usine 1.6.7" > .logs/audit-transitifs-ship.log 2>&1`, lis la sortie, et arrete-toi. Rapport court et en clair, avec **le lien de la PR**.
