# 011 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : ouverte
- Branche : slice/011-montee-next16
- Dernier commit : ouverture de la tranche (`chore(slice-011): ouvrir la tranche`)
- Prochaine etape : `test-writer` ecrit `tests/stack-upgrade/*` depuis AC1, AC2 (portee des regles de lint) et AC6

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
