# 004 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : tests ecrits (echouent tous pour la bonne raison, sauf un test de non-regression)
- Branche : slice/004-creation-collection
- Dernier commit : 105ea37 test(slice-004): criteres d'acceptation de la tranche 004
- Prochaine etape : implementer couche par couche (migration 0016, schema Drizzle, module `lib/collections`, route POST, erreur COLLECTION_NAME_TAKEN) ; appliquer D-113 a `tests/stack-upgrade/lint-scope.test.ts`

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
