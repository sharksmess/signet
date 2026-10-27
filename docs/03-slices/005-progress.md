# 005 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : tests ecrits (rouges, implementation a venir)
- Branche : slice/005-ajout-lien
- Dernier commit : 0d042fa test(links): traduction des erreurs SQL, AC10 (D-123)
- Prochaine etape : implementeur — migration `0017_*` (table `link`, RLS, politique `link_isolation`, privileges, fonction et trigger `signet.link_usage_on_insert()`), puis schema Drizzle, module `lib/links`, codes d'erreur, route ; les 139 tests de `tests/links/**` doivent passer, ainsi que les deux tests de catalogue de 004 et 006 (rouges tant que 0017 n'existe pas)

## Couches
- [ ] Migration
- [ ] Acces donnees
- [ ] Logique metier
- [ ] API
- [ ] UI (aucune : ecrans en 012)
- [ ] Suite complete verte + `pnpm run check`

## Blocages
<!-- cause, essais, options. Vide = aucun. -->

## Decisions
- Ouverture : contrat valide par l'humain avant activation (D-119 a D-122). `addLink.input.url` resserre au commit d'ouverture (D-120), regle verifiee hors depot sur les 18 refus et 5 acceptations d'AC3 ; `pnpm typecheck` vert.
- Tests (test-writer) : `tests/links/{creation,validation,isolation,quota,concurrency,lock,counter,catalog}.test.ts` et `tests/helpers/links.ts`, 139 tests, tous rouges pour la bonne raison (relation `link` absente, route `404`, fonction absente). D-121 : le seul nom `link_usage_on_insert` est ajoute aux deux listes fermees (`tests/collections/catalog.test.ts`, `tests/invitation-acceptance/catalog.test.ts`), rouges tant que 0017 n'existe pas. Deux tests passent des maintenant et le doivent : privileges inchanges de `organization_link_usage` (garde) et niveau `read committed` de `withTenant` (AC10).
- Tests : la traduction de `40001` (AC10) est ecrite desormais (D-123) : `tests/links/sql-errors.test.ts`, test unitaire de `linkErrorFromSqlState` (`lib/links/errors.ts`), rouge a l'import tant que le module n'existe pas ; `pnpm typecheck` et le lint echouent aussi, pour cette seule raison.
