# Consigne — passage autonome de la tranche 004 (creation d'une collection)

Redigee par l'orchestrateur (cowork) le 2026-10-26, objectif A (D-083, D-084 : « collections = 004, en mode autonome »). A lire au lancement de `/run-queue`, **en plus** de la skill. C'est la preuve que l'usine travaille presque seule : les conditions d'arret de la skill s'appliquent **sans exception**.

## Budget
**Une tranche : 004.** Arret apres `ship-slice.sh` (ou a la premiere condition d'arret). Jamais de fusion.

## Ce que l'humain a deja decide (a inscrire au registre a l'ouverture)
- **D-113 (humain, 2026-10-26)** : le test `tests/stack-upgrade/lint-scope.test.ts` recoit un delai **propre** de 60 s (troisieme argument de `it`), sans toucher a ses assertions ni au delai global de `vitest.config.ts` : il charge la configuration ESLint et a depasse 20 s trois fois sous charge (FRICTION). Ce fichier est ajoute au perimetre de 004 pour cette seule raison. Ecarte : relever le delai global (masquerait d'autres lenteurs).
- **Index du journal** : la ligne 17 passe a « PR #30 fusionnee (commit eb0dae0) » et la ligne 19 a « PR #33 fusionnee (commit aa7b2fb) », dans le commit d'ouverture.

## Sources
PRD US-05 (et US-09) ; ERD §6.1 (`collection`, index unique `lower(btrim(name))`, 100 caracteres) ; `docs/02-architecture/api-contracts/collections.ts` (creation, et seulement elle) ; ADR-0001, ADR-0004, ADR-0011 ; patron `withTenant` et tests d'isolation des tranches 001, 003, 006.

## Regles de la tranche
- **Perimetre : la creation seulement** (POST). La liste, la lecture et la suppression sont 009 et 007 : hors tranche.
- Les regles metier viennent du PRD, de l'ERD et du contrat d'API. **Si l'une manque ou se contredit, arrete-toi** : aucune hypothese metier en mode autonome.
- Criteres obligatoires : owner **et** member creent (US-05.1) ; nom unique par organisation, sans tenir compte de la casse ni des espaces de bord (409) ; nom vide ou > 100 caracteres -> 422 ; tenant B -> 404 identique a un UUID inexistant (AC5, test API et test en base sous contexte etranger force) ; concurrence : deux creations simultanees du meme nom -> un 201, un 409.
- Aucune dependance nouvelle, aucune fonction `SECURITY DEFINER` nouvelle attendue (sinon : ADR-0011 et test sous contexte etranger).
- Tests : aucune comparaison permanente a `main` ; valeurs de test inventees visiblement fausses.
- Le contrat de tranche n'attend pas de validation humaine en mode autonome : ecris tes decisions au registre comme « a valider par l'humain » (precedent D-027).
- Scripts et tests **au premier plan**. Relecteurs en parallele, sans `pnpm test` de leur cote.

## Journal
`docs/04-runbooks/autonomous-run-2026-10-26.md`, tenu au fil de l'eau. Rapport final : en tete, ce qui exige une decision humaine.
