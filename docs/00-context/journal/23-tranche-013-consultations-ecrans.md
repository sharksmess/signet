# 23 — Tranche 013 : consultations pour les ecrans, en mode autonome

- **Dates** : 2026-10-28
- **Objectif** : construire les deux lectures qui manquent aux ecrans de 012 — la liste des organisations de l'utilisateur et la liste des membres d'une organisation (D-136) — pour que 012 soit une tranche d'ecrans sans travail serveur nouveau ; troisieme passage autonome de l'objectif A.

## Ce qui a ete fait
- Ouverture en mode autonome (`/run-queue`, budget : 013 seule) selon `docs/04-runbooks/consigne-run-queue-013.md` : contrat `docs/03-slices/013-consultations-ecrans.md` (AC1 a AC12), perimetre gele, contrat `listMyOrganizations` ajoute a `api-contracts/organizations.ts` au texte de D-138, D-135 a D-139 au registre, backlog (ligne 013, ordre, cadrage de 012 par D-137) (98ac205).
- Verifie avant contrat : `signet_app` lit deja `member` et `app_user` et execute `organizations_for_user` ; aucune migration ni privilege necessaire (D-138 point 5 tenu).
- Tests ecrits avant le code par `test-writer` : 30 tests dans `tests/screen-reads/` (35520e5), 28 rouges (routes absentes), 2 verts d'emblee (RLS et fonction deja en place).
- Implementation par `slice-implementer` : lectures `listMyOrganizations` et `listMembers` (c3a85a2), routes `GET /api/organizations` (ajoutee au fichier existant, `POST` intact) et `GET /api/organizations/:id/members` (c3ae367). Aucune migration, aucune dependance, aucun privilege nouveau.
- Organisations de l'utilisateur de session seulement (jamais un parametre de la requete), de la plus recente a la plus ancienne ; membres par date d'arrivee, fondateur en premier, invitations en attente exclues ; `404` indistinguables ; membre de deux organisations borne au chemin ; lecture seule prouvee sur les lignes completes.
- Trois relectures en parallele, toutes PASS ; review-013 A CORRIGER 2 (helper de test qui suspendait les declencheurs sur une justification inexacte) corrige par `test-writer` (858a37b) ; suites au registre et au backlog (D-140, D-141).

## Decisions
- D-135 : D-132 a D-134 (tranche 009) validees (humain).
- D-136 : tranche 013 creee, en mode autonome, avant 012, dans l'objectif A (humain).
- D-137 : cadrage de la tranche 012, reporte au backlog (humain).
- D-138 : contrat `listMyOrganizations`, ordres, `listMembers` tel quel, pas de pagination, aucune migration (humain, sur recommandation de l'orchestrateur).
- D-139 : lectures de forme de l'orchestrateur, dont l'**ecart `minRole: "public"`** face a la definition de `_contract.ts` (D-109) — **a valider**.
- D-140 : decisions locales de l'implementeur — **a valider**.
- D-141 : suites des relectures — **a valider**.
Le detail est dans `docs/DECISIONS.md`.

## Preuves
Fiche `docs/04-runbooks/evidence/013.md` (produite par `close-slice.sh`) ; rapports `docs/04-runbooks/audits/{audit,contracts,review}-013.md` ; suite complete 748 passes, 1 ignore preexistant, 0 echec avant les relectures ; `tests/screen-reads` 30/30 apres le correctif du helper.

## Incidents
- Justification inexacte du helper d'AC3, reprise telle quelle par l'orchestrateur dans le journal du passage : le `42501` venait d'un contexte d'organisation absent, pas d'une exigence d'appartenance ; relevee par `code-reviewer`, corrigee dans le code de test et dans les journaux.
- Aucun echec intermittent de la suite pendant le passage.

## Etat a la fin
Tranche 013 implementee, trois relectures PASS, PR ouverte ; fusion a la decision de l'humain. Il reste la tranche 012 (ecrans, menee avec l'humain) pour les jalons de tranche de l'objectif A.

## Etape suivante
Decision humaine : fusion de la PR de 013 sur preuves, validation de D-139 a D-141, choix sur `minRole` ; puis ouverture de la tranche 012 avec l'humain.
