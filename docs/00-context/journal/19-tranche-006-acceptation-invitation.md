# 19 — Tranche 006 : acceptation d'une invitation

- **Dates** : 2026-10-25 → 2026-10-26
- **Objectif** : permettre a l'invite de rejoindre l'organisation en `member` avec le jeton recu par e-mail (US-03), avec usage unique, expiration en UTC et isolation tenant prouvee, sans aucune dependance nouvelle.

## Ce qui a ete fait
- Usine 1.6.4 adoptee par un commit distinct en tete de branche (1bb5acd, D-101).
- Ouverture : contrat, perimetre, journal (479052c) apres gate humain (D-102, D-103).
- Tests ecrits avant l'implementation par `test-writer` (3a13253) : 5 fichiers sous `tests/invitation-acceptance/`, 55 tests, plus la restriction du test AC15 de 003 aux politiques `signet_app` (Q-3).
- Migration `0015_accept_invitation.sql` (e91446c) : `signet.lookup_invitation` et `signet.accept_invitation`, `SECURITY DEFINER`, contexte pose depuis la ligne d'invitation, rapprochement d'adresse par la base, `SET TimeZone = 'UTC'` ; seule ecriture nouvelle de `signet_definer` : `UPDATE` des deux colonnes d'acceptation.
- Logique et route `POST /api/invitations/accept` (98258de, 36ac917) : session obligatoire, decodage strict du jeton (empreinte des 32 octets, D-090), 404 identiques pour jeton inconnu ou malforme, 410, 409, 403, 401.
- Documentation (7f7b47f) : ADR-0018, ERD, ADR-0003/0011/0017, contrat `invitations.ts`, backlog ; `minRole` « authenticated » (8d7fde5, D-109).
- Premiere execution de l'implementeur figee sans rien ecrire, relancee une fois avec succes.
- Trois relectures : AUDIT: PASS, CONTRACTS: PASS, REVIEW: PASS (8355e0a) ; suites donnees (2e441c1, D-110).

## Decisions
- D-101 : usine 1.6.4 dans la PR de la tranche (cowork).
- D-102 : gate d'ouverture — session obligatoire et adresse verifiee par la base, `403 INVITATION_EMAIL_MISMATCH`, test de 003 restreint, P-1 a P-7 (humain).
- D-103 : condition de Q-3 reformulee, seule ecriture nouvelle = `UPDATE` borne a l'acceptation (humain).
- D-104 : titre du test AC15 de 003 corrige (humain).
- D-105 a D-108 : effacement du contexte, forme canonique du jeton, textes fixes des erreurs, 401 au lieu de 403 sur compte modifie (claude-code, validees par l'humain).
- D-109 : `minRole` « authenticated » (humain).
- D-110 : ecarts de test et lectures valides, suites de review-006 (humain, orchestration claude-code).
Le detail est dans `docs/DECISIONS.md`.

## Preuves
Fiche `docs/04-runbooks/evidence/006.md` (produite par `close-slice.sh`) ; rapports `docs/04-runbooks/audits/audit-006.md`, `contracts-006.md`, `review-006.md` ; suite complete 418 passes, 1 ignore avant la cloture ; CI de la PR.

## Incidents
- Implementeur fige 600 s des sa premiere commande, relance une fois (regle d'orchestration).
- `_contract.ts` absent du perimetre : `scope-add` par l'humain (D-109).
- `tests/stack-upgrade/lint-scope.test.ts` a depasse son delai une seconde fois en une semaine : `docs/04-runbooks/FRICTION.md`, decision humaine a prendre sur le delai.
- `pnpm db:migrate` sur la base de developpement refuse faute de `DATABASE_URL_MIGRATE` (backlog D-067, action humaine).

## Etat a la fin
Tranche 006 implementee, 14 criteres coches, trois relectures PASS. Points a connaitre avant la fusion : trois decisions locales (D-106, D-107, D-108) n'ont pas encore de test qui echouerait si on les retirait (review-006 A CORRIGER 1 a 3, au backlog) ; la limite des adresses non verifiees est acceptee dans ADR-0018.

## Etape suivante
Fusion par l'humain sur preuves, puis tranche 004 (collections) en mode autonome (objectif A, D-083).
