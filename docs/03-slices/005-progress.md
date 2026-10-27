# 005 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : implementation en cours (migration et schema faits)
- Branche : slice/005-ajout-lien
- Dernier commit : 6bc87c6 feat(db): table link, RLS et trigger de quota link_usage_on_insert
- Prochaine etape : logique metier `apps/web/src/lib/links/` (contrat, `errors.ts` avec `linkErrorFromSqlState`, ajout sous `withTenant`) et codes dans `lib/errors.ts`, puis route

## Couches
- [x] Migration — 6bc87c6 (`0017_link.sql`, ERD) ; `tests/links/catalog.test.ts`, `lock.test.ts`, les deux catalogues de D-121 et `tests/_factory` : 62/62. Etat initial avant implementation : 139 rouges / 2 verts (relation `link` absente, route `404`), conforme.
- [x] Acces donnees — 6bc87c6 (meme commit : `packages/db/src/schema/links.ts` est la source de `pnpm db:generate`)
- [ ] Logique metier
- [ ] API
- [ ] UI (aucune : ecrans en 012)
- [ ] Suite complete verte + `pnpm run check`

## Blocages
<!-- cause, essais, options. Vide = aucun. -->
- `pnpm db:migrate` sur la base de developpement : refuse (`DATABASE_URL_MIGRATE n'est pas definie`, variable absente du shell de l'agent, deja connu : backlog D-067, precedents 003, 004, 006). **Action humaine.** La base de test est migree par le globalSetup, ou 0017 s'applique.

## Decisions
- Ouverture : contrat valide par l'humain avant activation (D-119 a D-122). `addLink.input.url` resserre au commit d'ouverture (D-120), regle verifiee hors depot sur les 18 refus et 5 acceptations d'AC3 ; `pnpm typecheck` vert.
- Tests (test-writer) : `tests/links/{creation,validation,isolation,quota,concurrency,lock,counter,catalog}.test.ts` et `tests/helpers/links.ts`, 139 tests, tous rouges pour la bonne raison (relation `link` absente, route `404`, fonction absente). D-121 : le seul nom `link_usage_on_insert` est ajoute aux deux listes fermees (`tests/collections/catalog.test.ts`, `tests/invitation-acceptance/catalog.test.ts`), rouges tant que 0017 n'existe pas. Deux tests passent des maintenant et le doivent : privileges inchanges de `organization_link_usage` (garde) et niveau `read committed` de `withTenant` (AC10).
- Tests : la traduction de `40001` (AC10) est ecrite desormais (D-123) : `tests/links/sql-errors.test.ts`, test unitaire de `linkErrorFromSqlState` (`lib/links/errors.ts`), rouge a l'import tant que le module n'existe pas ; `pnpm typecheck` et le lint echouent aussi, pour cette seule raison.
- Implementeur, migration : schema et migration en un seul commit (le schema Drizzle est la source du fichier genere ; deux commits auraient laisse un schema sans migration). Ecarte : deux commits separes.
- Implementeur, migration : index `link_collection_recent_idx` declare `.desc().nullsFirst()` dans Drizzle. Raison : `.desc()` seul emet `DESC NULLS LAST`, different de l'ERD (`DESC`, soit `NULLS FIRST` par defaut) et du test d'AC12 ; colonnes `NOT NULL`, donc aucun effet sur le tri. Ecarte : corriger le SQL genere a la main (instantane `meta/` desaligne, la generation suivante produirait une difference).
- Implementeur, migration : nom du trigger `link_usage_on_insert`, comme la fonction (le contrat ne le nomme pas). Il s'execute apres les triggers internes de cle etrangere (`RI_ConstraintTrigger_*`, ordre alphabetique) : sans effet sur le resultat, toute erreur annule l'instruction entiere.
- Implementeur, migration : messages de `RAISE` sans identifiant d'organisation (ni pour `SG001`, exige, ni pour `P0001`). Ecarte : reprendre l'identifiant dans `P0001` comme `propagate_subscription_quota` (il remonterait dans les journaux du serveur sans necessite ; la route ne journalise que le code).
- Implementeur, migration : aucun garde `NULL` explicite sur `NEW.organization_id` avant `set_config` (regle n°3 de `drizzle-postgres.md`) : la colonne est `NOT NULL`, verifiee avant tout trigger `AFTER` ; un `NULL` ferait de toute facon toucher zero ligne, donc lever `P0001`. Garder `set_config` en premiere instruction, comme l'exige le contrat.
