# 004 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : ouverte
- Branche : slice/004-creation-collection
- Dernier commit : (ouverture) chore(slice-004): ouvrir la tranche
- Prochaine etape : `test-writer` ecrit les tests de AC1 a AC8 dans `tests/collections/` ; D-113 applique a `tests/stack-upgrade/lint-scope.test.ts`

## Couches
- [ ] Migration
- [ ] Acces donnees
- [ ] Logique metier
- [ ] API
- [ ] UI (aucune : tranche 012)
- [ ] Suite complete verte + `pnpm run check`

## Blocages
<!-- cause, essais, options. Vide = aucun. -->

## Decisions
<!-- Toute decision prise sans l'humain, avec sa raison. Reprise dans la PR. -->
- Ouverture en mode autonome (`/run-queue`, consigne `docs/04-runbooks/consigne-run-queue-004.md`) : lectures de l'orchestrateur sur le contrat inscrites au registre, a valider par l'humain (D-114). D-113 (humain) : delai propre de 60 s sur les quatre `it` de `tests/stack-upgrade/lint-scope.test.ts`.
