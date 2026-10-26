# 20 — Tranche 004 : creation d'une collection, en mode autonome

- **Dates** : 2026-10-26
- **Objectif** : realiser la tranche collections en mode autonome (objectif A, D-083, D-084), budget d'une seule tranche, consigne `docs/04-runbooks/consigne-run-queue-004.md`.

## Ce qui a ete fait
- Ouverture (255fd28) : contrat `docs/03-slices/004-creation-collection.md`, perimetre, journal ; D-113 applique (delai propre de 60 s sur les quatre `it` de `tests/stack-upgrade/lint-scope.test.ts`) ; index du journal de projet (PR #30 et #33 fusionnees).
- Tests avant le code par `test-writer` (105ea37) : 57 tests, 56 rouges pour la bonne raison.
- Implementation par `slice-implementer` : migration `0016_collection.sql` (table `collection` conforme a l'ERD §6.1, RLS activee et forcee, politique `collection_isolation` sur `current_org()`, `GRANT SELECT, INSERT` a `signet_app`), module `lib/collections`, erreur `COLLECTION_NAME_TAKEN`, route `POST /api/organizations/:organizationId/collections` (4558151, 7c00543, a5d7278).
- Une assertion de test inatteignable corrigee par son auteur (D-115, 714ace9).
- Trois relectures en parallele : AUDIT: PASS, CONTRACTS: PASS, REVIEW: PASS. Correctifs de relecture avant cloture (D-117) : textes fixes des erreurs figes par des tests, prouves par mutation ; test de politique RLS rendu strict (616d428, ffe3ec2).
- Aucune dependance, aucune variable d'environnement, aucune fonction `SECURITY DEFINER` nouvelles ; contrats d'API inchanges.

## Decisions
- D-113 : delai propre de 60 s pour le test de portee du lint (humain).
- D-114 : lectures de forme du contrat (201, 422 sur UUID malforme, longueur mesuree par Zod, messages fixes, pas d'index d'auteur, privileges `SELECT, INSERT`) (claude-code, **a valider**).
- D-115 : correction d'une assertion inatteignable du test de catalogue (claude-code, **a valider**).
- D-116 : decisions locales de l'implementeur, dont la politique `FOR ALL` qui couvrira `DELETE` en 007 (slice-implementer, **a valider**).
- D-117 : suites des relectures, correctifs avant cloture et backlog (claude-code, **a valider**).
Le detail est dans `docs/DECISIONS.md`.

## Preuves
Fiche `docs/04-runbooks/evidence/004.md` (produite par `scripts/close-slice.sh`) ; rapports `docs/04-runbooks/audits/{audit,contracts,review}-004.md` ; journal du passage `docs/04-runbooks/autonomous-run-2026-10-26.md`.

## Incidents
- `lint-scope.test.ts` : un echec a froid au premier passage du fichier seul, malgre 60 s (FRICTION) ; vert ensuite, y compris en suite complete.
- `tests/billing/webhook.test.ts` AC7 : echec intermittent par un evenement d'invitation tardif d'un test de 003 sur le faux Inngest partage (FRICTION, backlog) ; vert a la relance.
- `pnpm db:migrate` non lance sur la base de developpement (variable de migration absente du shell de l'agent) : a faire par l'humain.

## Etat a la fin
Tranche 004 close sur sa branche, PR ouverte par `ship-slice.sh`, en attente de la decision humaine de fusion. Quatre decisions a valider (D-114 a D-117).

## Etape suivante
Fusion humaine de la PR sur preuves ; puis tranche 005 (quota de 50 liens), qui depend de 002 et 004.
