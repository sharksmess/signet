# Consigne — ouvrir la tranche 002 (abonnement et changement de palier)

Redigee par l'orchestrateur (cowork) le 2026-10-08. A lire au lancement de `/slice 002`, **en plus** de la skill. Premiere tranche qui touche a l'argent : le contrat est relu par l'orchestrateur et valide par l'humain **avant** d'etre active.

## Sources a relire
PRD US-08 ; ADR-0005 (etat local pilote par les webhooks), ADR-0006 (Inngest), ADR-0011 ; ERD §8 (`subscription`, `billing_event`, `propagate_subscription_quota`) ; `docs/02-architecture/api-contracts/subscriptions.ts` ; backlog § Notes (audit-010 MINEUR-2).

## Exigences pour le contrat
1. **AC obligatoire (D-033)** : la regle d'audit-010 MINEUR-2 ecrite dans ADR-0011 (« toute fonction definer executable par `signet_app` pose son contexte depuis une valeur de confiance ou filtre sur `current_user_id()` en premiere instruction »), avec un test par fonction definer de la tranche sous contexte etranger force (modele d'AC2 de 010). Le traitement du webhook, qui n'a pas d'utilisateur, doit dire d'ou vient sa valeur de confiance.
2. **Aucun appel reseau reel dans les tests, aucune vraie cle** ni en local ni en CI (la CI n'a aucun secret Stripe) :
   - webhook : evenements signes dans les tests avec un secret de test ; signature absente ou fausse -> 400 `INVALID_SIGNATURE` avant tout traitement ;
   - appels sortants vers Stripe (session Checkout, modification, annulation) : un faux Stripe controle par les tests ; dis lequel et pourquoi ;
   - Inngest : dis comment la fonction est executee dans les tests sans service externe, et comment on prouve qu'elle est rejouable sans doubler l'effet.
3. **Idempotence** : meme evenement Stripe recu deux fois (et deux fois en parallele) -> un seul `billing_event`, un seul changement d'etat.
4. **ADR-0005 respecte** : aucun test ne verifie le nouveau palier juste apres l'appel de l'owner ; l'etat change seulement apres le webhook.
5. **Cas limites listes** : member -> 403 (lecture et modification) ; tenant B -> 404 (AC5) ; evenement pour un abonnement ou un client inconnu ; evenements dans le desordre ; `past_due` reste Pro ; annulation en fin de periode ; Pro sans `stripe_subscription_id` impossible (contrainte de l'ERD).
6. **Dependances nouvelles** (`stripe`, `inngest`, tout outil de test) : versions du registre hors quarantaine pnpm, `pnpm audit`, un ADR qui les nomme (ADR-0015).
7. **Variables d'environnement** : liste leurs **noms** (jamais de valeur) dans `.env.example` / `.env.test.example`, et dis lesquelles l'humain doit remplir lui-meme, avec quoi (valeur de test inventee, ou cle du compte Stripe de test). Tu ne lis jamais `.env*` hors `*.example`.
8. Le contrat dit ce qui est **hors tranche** (portail client Stripe, factures, TVA, essais gratuits, interface soignee, etc.).

## Deroule
- Etapes 1 a 4 de la skill (choisir, branche, contrat, perimetre), puis **arrete-toi avant l'etape 5** : n'ecris pas `.gates/current-slice`, ne committe pas, ne lance pas `test-writer`.
- Rapport court : contrat (AC et cas limites), perimetre, dependances et variables prevues, decisions prises et options ecartees, questions pour l'humain.
- Apres validation humaine : etape 5, puis un seul commit d'ouverture `chore(slice-002): ouvrir la tranche` qui inclut aussi cette consigne et la ligne 13 de `docs/00-context/JOURNAL.md` (PR #24 fusionnee), puis `test-writer`.
