# Passage autonome du 2026-10-28 (/run-queue)

Budget fixe par l'humain : **1 tranche, la 013** (consultations pour les ecrans), selon `docs/04-runbooks/consigne-run-queue-013.md`, y compris D-135 a D-138 (decisions humaines). Arret apres `ship-slice.sh` ou a la premiere condition d'arret. Jamais de fusion.

## Prerequis
- `.gates/02-architecture.approved` present ; aucune tranche active.
- `main` a jour sur 5f87b32 (PR #37, tranche 009, fusionnee). Arbre : seulement la consigne, non committee, incluse dans le commit d'ouverture.
- File : 013 (depend de 001 et 006, closes et fusionnees). 007 et 008 ont aussi leurs dependances closes : **hors file** (consigne). 012 depend de 013 : **hors file** (menee avec l'humain). PR ouverte : #35 (Dependabot), sans lien avec 013.

## Tranche 013 — Consultations pour les ecrans
- Debut : 2026-10-28, 15:05. Branche `slice/013-consultations-ecrans`.
- Sources relues : consigne ; contrats `createOrganization`, `listMembers`, `_contract.ts` ; `lib/organizations.ts`, route `/api/organizations` ; migrations 0003 (`member`, `app_user_visible_to_co_members`, privileges) et 0009 (`organizations_for_user`) ; contrat et journaux de 009.
- Verifications avant contrat : (1) `signet_app` a `SELECT` sur `member` et `app_user` (0003) et `EXECUTE` sur `organizations_for_user` (0009) ; `member.created_at` existe : **aucune migration ni privilege necessaire**, D-138 point 5 tenu ; (2) **ecart** : D-138 fixe `minRole: "public"` « comme `createOrganization` », mais `_contract.ts` (depuis D-109) reserve `"public"` a « aucune authentification ». Le comportement n'est pas en cause (`401` sans session) : texte de D-138 applique tel quel, ecart inscrit en D-139 point 6 et au backlog (decision humaine). Pas une condition d'arret : aucune regle metier comblee par hypothese, l'etiquette n'a aucun effet a l'execution.
- Ouverture : contrat `docs/03-slices/013-consultations-ecrans.md` (AC1 a AC12), perimetre `.gates/scope-013.txt`, journal de tranche ; contrat `listMyOrganizations` ajoute a `api-contracts/organizations.ts` (texte de D-138 point 1) ; registre D-135 a D-138 (humain), D-139 (a valider) ; index du journal (ligne 22), backlog (ligne 013, ordre, objectif A, section 012 par D-137, ecart `minRole`).
