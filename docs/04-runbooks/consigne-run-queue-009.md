# Consigne — passage autonome de la tranche 009 (consultation des collections et des liens)

Redigee par l'orchestrateur (cowork) le 2026-10-27. A lire au lancement de `/run-queue`, **en plus** de la skill. Second passage autonome de l'objectif A : les conditions d'arret de la skill s'appliquent **sans exception**.

## Budget
**Une tranche : 009.** Les tranches 007 et 008 ont aussi leurs dependances closes : elles restent **hors file** (hors objectif A, D-083). Arret apres `ship-slice.sh` (ou a la premiere condition d'arret). Jamais de fusion.

## Ce que l'humain a deja decide (a inscrire au registre a l'ouverture)
- **D-129 (humain, 2026-10-27)** : D-127 (suites des relectures de la tranche 005) et D-128 (decisions locales de l'implementeur de 005) validees.
- **D-130 (humain, 2026-10-27)** : la tranche 009 entre dans l'objectif A, en mode autonome, avant la tranche 012. Raison : les ecrans (012) doivent afficher les collections et les liens ; sans la consultation, ils n'auraient rien a montrer (oubli de planification de l'orchestrateur dans D-084). Un second passage autonome renforce la preuve du point 3 de l'objectif A. Ecarte : integrer la consultation dans 012 (tranche plus grosse, un seul passage autonome). Modifie D-083 et D-084 sur ce seul point : 007 et 008 restent hors objectif.
- **D-131 (humain, sur recommandation de l'orchestrateur, 2026-10-27)** : lectures de la tranche, decidees d'avance pour qu'aucune hypothese metier ne soit a prendre en autonomie :
  1. **Ordre des collections** (le PRD ne le fixe pas) : de la plus recente a la plus ancienne (`created_at DESC, id DESC`), comme les liens. Ecarte : ordre alphabetique (depend de la collation, locale non ecrite dans l'ERD, review-004 SUGGESTION 3).
  2. **Ordre des liens** (US-07.2) : `created_at DESC, id DESC`, exactement l'index `link_collection_recent_idx` de l'ERD §6.2 ; le second critere departage les liens de meme horodatage.
  3. **Pas de pagination** : les contrats `listCollections` et `listLinks` n'en prevoient pas ; un Free est borne a 50 liens. Un Pro est sans borne : pagination et plafond de reponse **au backlog, avant la mise en ligne**. Aucun changement de contrat dans cette tranche.
  4. **Valeurs rendues telles qu'enregistrees** (D-119) : URL et titre jamais reecrits, ni nettoyes, ni echappes par l'API ; l'echappement a l'affichage est le travail de 012 (backlog, audit-005 INFO-2).
  5. **Aucune migration attendue** : `signet_app` a deja `SELECT` sur `collection` et `link` (0016, 0017), les politiques RLS existent. Aucun index nouveau (le nombre de collections par organisation est faible ; index `(organization_id, created_at)` au backlog si besoin).
- **Index du journal** : la ligne 21 passe a « PR #36 fusionnee (commit d2c1462) », dans le commit d'ouverture.
- **Backlog** : la ligne d'ordre d'execution devient `... -> 005 -> 009 (en mode autonome) -> 012 (ecrans)`, et la phrase de l'objectif A cite D-130 (007 et 008 restent hors objectif).

## Sources
PRD US-07 (et US-09) ; contrats `listCollections` (`api-contracts/collections.ts`) et `listLinks` (`api-contracts/links.ts`), **et seulement eux** ; ERD §6.1, §6.2 ; ADR-0001, ADR-0004, ADR-0011 ; patron des tranches 004 et 005 (`withTenant`, appartenance explicite, `Result`, forme canonique de l'UUID, messages fixes de D-114 point 4).

## Regles de la tranche
- **Perimetre : la lecture seulement**, API seule (les ecrans sont 012) : `GET /api/organizations/:organizationId/collections` et `GET /api/organizations/:organizationId/collections/:collectionId/links`, ajoutes aux deux fichiers de route existants **sans modifier le comportement de leurs `POST`**.
- Les regles metier viennent du PRD, des contrats et de D-131. **Si l'une manque ou se contredit, arrete-toi.**
- Criteres obligatoires :
  - owner **et** member lisent (US-07.1) ; sans session -> `401` (US-07.3) ;
  - organisation inconnue ou non membre -> `404 ORGANIZATION_NOT_FOUND`, reponses identiques ; collection d'une autre organisation -> `404 COLLECTION_NOT_FOUND`, identique a un identifiant inexistant (US-09.2) ; test en base sous contexte etranger force (zero ligne) ;
  - ordre des erreurs prouve : `401` < `422` < `404` organisation < `404` collection ;
  - un utilisateur membre de **deux** organisations ne voit, par chaque chemin, que les donnees de cette organisation ;
  - ordre de D-131 points 1 et 2 prouve, **y compris a horodatage egal** (lignes inserees dans une meme transaction) ; liste vide -> `200 []` ;
  - reponse conforme au schema de sortie du contrat, **sans champ de plus** (ni `organization_id`, ni colonne interne) ; `createdAt` en ISO UTC ;
  - un lien ou une collection ajoute est visible a la lecture suivante (aucune reponse mise en cache) ;
  - organisation retrogradee au-dessus du quota (75 liens, patron de 005) : les 75 sont lus, rien n'est modifie ;
  - une URL et un titre contenant U+202E ou U+200B sont rendus a l'identique (D-131 point 4) ;
  - **lecture seule prouvee** : aucune ecriture par ces routes (compteur `organization_link_usage` et nombre de lignes inchanges apres lecture) ; aucun privilege, aucune politique, aucune fonction `SECURITY DEFINER` nouveaux (les listes fermees de D-121 restent identiques).
- Aucune dependance nouvelle, aucune migration (D-131 point 5) : si l'une semble necessaire, **arrete-toi**.
- Tests : aucune comparaison permanente a `main` ; valeurs de test inventees visiblement fausses.
- Le contrat de tranche n'attend pas de validation humaine en mode autonome : ecris tes autres decisions au registre comme « a valider par l'humain » (precedent D-027, D-114).
- Scripts et tests **au premier plan**. Relecteurs en parallele, sans `pnpm test` de leur cote.

## Journal
`docs/04-runbooks/autonomous-run-<date du jour>.md`, tenu au fil de l'eau. Rapport final : en tete, ce qui exige une decision humaine. Journal de projet : entree 22.
