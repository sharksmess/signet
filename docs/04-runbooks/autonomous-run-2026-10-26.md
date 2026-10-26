# Passage autonome du 2026-10-26 (/run-queue)

Budget fixe par l'humain : **1 tranche, la 004** (creation d'une collection), selon `docs/04-runbooks/consigne-run-queue-004.md`, y compris D-113 (decision humaine). Arret apres `ship-slice.sh` ou a la premiere condition d'arret. Jamais de fusion.

## Prerequis
- `.gates/02-architecture.approved` present.
- `main` a jour sur aa7b2fb (PR #33, tranche 006, fusionnee). Arbre : seulement la consigne, non committee, incluse dans le commit d'ouverture.
- File : 004 (depend de 001, close). PR ouverte : #32 (Dependabot), sans lien avec 004.

## Tranche 004 — Creation d'une collection
- Debut : 2026-10-26.
- Sources relues : PRD US-05 et US-09, ERD §6.1, matrice d'isolation, contrat `collections.ts` (`createCollection`), patron de 003 (`withTenant`, appartenance explicite, `Result`). Aucune regle metier manquante ou contradictoire constatee ; lectures de forme inscrites en D-114 (a valider par l'humain).
- Ouverture : branche `slice/004-creation-collection`, contrat, perimetre (`.gates/scope-004.txt`), journal de tranche ; D-113 applique (`tests/stack-upgrade/lint-scope.test.ts`, quatre `it` a 60 s, assertions intactes) ; registre D-113, D-114 ; index du journal de projet (lignes 17 et 19) ; backlog (index d'auteur, D-114 point 5).
- Ouverture committee : 255fd28.
- `test-writer` : 57 tests (`tests/collections/{creation,isolation,concurrency,catalog}.test.ts`, helper `tests/helpers/collections.ts`), 56 echecs attendus (route absente : 404 HTML de Next ; table absente : `42P01`), 1 vert (non-regression : fonctions definer = liste de 006) ; commits 105ea37, fd2ff2a. Verifie par l'orchestrateur : rien hors perimetre, aucune comparaison a `main`. Points signales : ordre d'evaluation teste (401 < 422 < 404), refus RLS verifie par `42501` avec precondition de privilege, controles de catalogue en plus des AC (aucun index de plus, PUBLIC sans privilege, FK et cascade d'organisation). Son journal indique a tort D-113 « a appliquer » (deja fait dans 255fd28) : corrige par l'implementeur.
- `slice-implementer` : commits 4558151 (migration 0016 : table, CHECK, index, RLS forcee, politique `collection_isolation` TO signet_app, `GRANT SELECT, INSERT`), b229844, 7c00543 (module `lib/collections`, `COLLECTION_NAME_TAKEN`, point de sauvegarde sur `23505`), a5d7278 (route POST), 1d2b39f (types de deux `client.query` des tests pour le lint, aucune assertion changee), ea0756f. `pnpm test` : 486 passes, 1 echec, 1 ignore (124,65 s) ; `pnpm run check` vert. Seul echec : assertion inatteignable de `catalog.test.ts:158` (D-115), diagnostic verifie, renvoyee a `test-writer`. Point d'attention : `pnpm db:migrate` non lance sur la base de developpement (`DATABASE_URL_MIGRATE` absente du shell de l'agent) ; base de test migree par le globalSetup.
- `test-writer` (relance, D-115) : 714ace9, 057392d ; `catalog.test.ts` 14/14, `pnpm run check` vert.
- Suite complete par l'orchestrateur : 1er passage 486/488 (echec intermittent `tests/billing/webhook.test.ts` AC7, evenement d'invitation tardif d'un test de 003 sur le faux Inngest partage, FRICTION) ; relance : **487 passes, 1 ignore, 161 s**. `lint-scope.test.ts` vert avec 60 s (D-113).
