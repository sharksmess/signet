# 011 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : tests ecrits
- Branche : slice/011-montee-next16
- Dernier commit : dbe16c6 `test(slice-011): versions, portee du lint et Dependabot`
- Etat des tests (`pnpm exec vitest run tests/stack-upgrade`, 15 tests) : 10 verts, 5 rouges attendus.
  - Rouges (implementation absente) : AC1 `next` 15.5.26 au lieu de 16.x.y ; AC1 `eslint-config-next` idem ; AC1 `@eslint/eslintrc` present dans `package.json` ; AC1 `eslint.config.mjs` contient `FlatCompat` ; AC6 pas de section `ignore` pour `@types/node` dans le bloc npm.
  - Verts : AC1 `eslint` 9.39.5, `minimumReleaseAgeExclude` absent, version installee = manifeste ; AC6 `.nvmrc` = 24, groupes et limites conserves ; AC2 (4 tests de non-regression, verts des maintenant, attendu).
- Prochaine etape : implementation, couche par couche (versions et lockfile, ESLint natif, tsconfig, Dependabot, documentation)

## Couches
- [ ] Versions (`next`, `eslint-config-next`, `eslint`, retrait de `@eslint/eslintrc`) et lockfile
- [ ] Configuration ESLint native (`eslint.config.mjs`)
- [ ] Reecritures imposees par `next build` 16 (`apps/web/tsconfig.json`)
- [ ] Dependabot (`.github/dependabot.yml`)
- [ ] Documentation (ADR-0013, statuts d'ADR-0008 et ADR-0009, backlog)
- [ ] Suite complete verte + `pnpm run check` + `pnpm run build`

## Blocages
<!-- cause, essais, options. Vide = aucun. -->

## Decisions
<!-- Toute decision prise sans l'humain, avec sa raison. Reprise dans la PR. -->
- Ouverture (orchestrateur) : cible `next@16.3.7` / `eslint-config-next@16.3.7` et non 16.3.8, publiee le jour meme (quarantaine pnpm 12, regle d'ADR-0012).
- Ouverture (orchestrateur) : essai prealable sur branche jetable (`tmp/essai-next16`, supprimee) pour fixer un perimetre juste avant le gel ; resultats dans le contrat, « Notes d'implementation ».
