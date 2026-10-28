# 22 — Tranche 009 : consultation des collections et des liens, en mode autonome

- **Dates** : 2026-10-27
- **Objectif** : rendre lisibles les collections d'une organisation et les liens d'une collection (US-07), pour que les ecrans de 012 aient quelque chose a afficher (D-130) ; second passage autonome de l'objectif A.

## Ce qui a ete fait
- Ouverture en mode autonome (`/run-queue`, budget : 009 seule) selon `docs/04-runbooks/consigne-run-queue-009.md` : contrat `docs/03-slices/009-consultation.md` (AC1 a AC12), perimetre gele, D-129 a D-131 au registre (6720faf).
- Tests ecrits avant le code par `test-writer` : 38 tests dans `tests/consultation/` (aec6dd4), 36 rouges en `405`, 2 verts d'emblee (RLS deja en place).
- Implementation par `slice-implementer` : lecture (`listCollections`, `listLinks`, eb72c7d) puis routes `GET /api/organizations/:id/collections` et `GET .../collections/:id/links` (08de798), ajoutees aux fichiers de route existants, `POST` intacts. Aucune migration, aucune dependance, aucun privilege nouveau.
- Ordre du plus recent au plus ancien (`created_at DESC, id DESC`), prouve a horodatage egal ; `404` indistinguables pour une organisation ou une collection d'autrui ; membre de deux organisations borne au chemin ; valeurs rendues telles qu'enregistrees ; lecture seule prouvee.
- Trois relectures en parallele, toutes PASS du premier coup ; suites au registre et au backlog (D-133, D-134).

## Decisions
- D-129 : D-127 et D-128 (tranche 005) validees (humain).
- D-130 : 009 entre dans l'objectif A avant 012 ; 007 et 008 restent hors objectif (humain).
- D-131 : ordre, pas de pagination, valeurs telles qu'enregistrees, aucune migration (humain, sur recommandation de l'orchestrateur).
- D-132 : lectures de forme de l'orchestrateur (`200`, `422` sur identifiant malforme, chaine de requete ignoree, ERD §6.1, membre de deux organisations, nom de collection rendu tel quel) — **a valider**.
- D-133 : decisions locales de l'implementeur — **a valider**.
- D-134 : suites des relectures — **a valider**.
Le detail est dans `docs/DECISIONS.md`.

## Preuves
Fiche `docs/04-runbooks/evidence/009.md` (produite par `close-slice.sh`) ; rapports `docs/04-runbooks/audits/{audit,contracts,review}-009.md` ; suite complete 718 passes, 1 ignore preexistant, 0 echec avant les relectures.

## Incidents
- Transcription de D-131 au registre corrigee par l'orchestrateur (« et nom » ajoute a tort au point 4) ; l'extension devient D-132 point 6 (de6eb83).
- Aucun echec intermittent de la suite pendant le passage.

## Etat a la fin
Tranche 009 implementee, trois relectures PASS, PR ouverte ; fusion a la decision de l'humain. Il reste la tranche 012 (ecrans) pour les jalons de tranche de l'objectif A.

## Etape suivante
Decision humaine : fusion de la PR de 009 sur preuves, validation de D-132 a D-134 ; puis ouverture de la tranche 012.
