# 14 — Tranche 002 : abonnement et changement de palier (Stripe, Inngest)

- **Dates** : 2026-10-08 → 2026-10-19
- **Objectif** : permettre a l'owner de consulter son palier et de passer de Free a Pro (Stripe Checkout) ou de Pro a Free (annulation en fin de periode), chaque changement confirme par Stripe laissant un evenement facturable horodate (US-08).

## Ce qui a ete fait
- Gate d'ouverture : neuf recommandations retenues et six complements de l'orchestrateur (D-057), tests ecrits avant le code par `test-writer`.
- Phase 1 : role Postgres `signet_billing` (migration 0011, audit-010 INFO-1 inclus) ; point d'arret pour que l'humain fixe son mot de passe (D-065, D-066, D-067).
- Phase 2 : table `billing_event` append-only et fonction `SECURITY DEFINER` `signet.apply_stripe_subscription(jsonb)`, seule a ecrire le palier, executable par `signet_billing` seul, qui valide elle-meme son entree (migration 0012, D-068).
- Phase 3 : dependances `stripe`, `inngest`, `@inngest/test` (ADR-0015) ; routes `GET`/`POST /api/organizations/:id/subscription`, webhook Stripe (signature verifiee avant lecture, mise en file, `503` si la file ne repond pas), point de service `/api/inngest` (signe hors mode developpement), fonction Inngest en deux pas (relecture Stripe, puis ecriture) ; schema d'environnement et refus de demarrer par `instrumentation.ts` (D-069, D-070) ; doublures de test ecrites dans le depot (D-059) ; ADR-0016.
- Premiere serie de relectures (2026-10-15) : contrats PASS, securite FAIL (un UUID en majuscules dans l'URL donnait Pro a vie), code FAIL (etat Stripe perime rejoue apres une resiliation ; auteur d'une resiliation par Stripe seul).
- Phase 4 (2026-10-19) : corrections decidees par l'humain (D-071) : garde monotone (`subscription.stripe_synced_at`, migration 0013), cle `canceled_by`, `409` tant qu'un abonnement est rattache, passage en Free par le statut relu, comparaison en `uuid` et identifiant normalise, regle de lint d'isolement etendue (un test par forme), SG004 journalise en erreur, `DATABASE_URL_BILLING` reservee a `billing-db.ts`.
- Seconde serie de relectures, en contexte neuf : securite PASS, contrats PASS, code PASS avec trois A CORRIGER.
- Phase 5 (2026-10-19) : corrections decidees par l'humain (D-072) : limite de concurrence Inngest par abonnement, limites de la garde ecrites dans ADR-0016, borne haute de `stripe_read_at` et commentaire corriges en place dans 0013 (hors `main`), `409` decrit dans le contrat et son message, trois tests directs de la garde, ligne au backlog sur `canceled_by`, memoire des relecteurs committee. Suite : 277/277 en 24 fichiers.
- Troisieme relecture de code (seule, contexte neuf) : `REVIEW: FAIL` pour un seul A CORRIGER documentaire (ce journal, son index et le journal de tranche en retard sur D-072), corrige ensuite ; une suggestion sur la borne haute (refus definitif) est soumise a l'humain.
- Phase 6 (2026-10-19, D-076) : borne haute de `stripe_read_at` en refus rejouable (`SG008`), test a la limite exacte des 5 minutes, test de la limite de concurrence Inngest, ERD complete ; puis quatrieme relecture de code en contexte neuf.
- Quatrieme relecture de code : `REVIEW: FAIL` (`SG008` rejouable pouvait remettre en Pro une organisation resiliee ; abandon d'Inngest non journalise).
- Phase 7 (2026-10-19, D-077, remplace D-076) : marque prise sur l'horloge de la base, borne et `SG008` retires, `onFailure` journalise l'abandon en erreur ; cinquieme relecture de code en contexte neuf.
- Cinquieme relecture de code : `REVIEW: PASS` (aucun A CORRIGER, cinq suggestions). Verdicts finaux : securite PASS, contrats PASS, code PASS.

## Decisions
- D-057 a D-064 : gate d'ouverture (humain ; claude-code).
- D-065, D-067 : regles de l'humain pour l'implementation, signature `jsonb`, codes `SGxxx`, Stripe 10 s et une relance (humain).
- D-066, D-069 : decisions locales des phases 1 et 3 (claude-code).
- D-068, D-070, D-071, D-072, D-076 (remplacee), D-077 : validations et arbitrages de l'humain (refus non rejouables, 503 au contrat, `instrumentation.ts`, corrections des relectures successives, perimetre elargi deux fois).
- D-073 a D-075 (projet) : explications en langage courant avant chaque commande ; plan de la semaine (toutes les fonctionnalites d'ici vendredi, mise en ligne visee le week-end, aucun controle supprime) ; abonnement payant conserve, vrais paiements actives apres validation du compte Stripe.
Le detail est dans `docs/DECISIONS.md`.

## Preuves
- `pnpm test` : 277/277 en 24 fichiers apres la phase 5, `pnpm run check` vert, `pnpm audit --prod --audit-level=high` propre.
- Fiche de preuves `docs/04-runbooks/evidence/002.md` : produite par `scripts/close-slice.sh`, apres des verdicts PASS.
- Rapports des relecteurs : `docs/04-runbooks/audits/audit-002.md`, `contracts-002.md`, `review-002.md`.

## Incidents
- Runbook § 1 inapplicable (`pnpm db:migrate` sans `DATABASE_URL_MIGRATE` sur le poste) ; `.env` de developpement sans URL de role (backlog) ; serveur de test sans mot de passe `signet_app` apres une modification de `.env.test.local`. Voir `docs/04-runbooks/FRICTION.md` (2026-10-15).
- Perimetre fige par le hook `gate-check.sh` : deux elargissements ecrits par l'humain (D-070, D-071), jamais contournes.
- Un trigger `BEFORE TRUNCATE` sur `billing_event` cassait la remise a zero de la base de test : retire, limite ecrite dans ADR-0016.

## Etat a la fin
Code, migrations 0011 a 0013, tests (280/280) et documentation sur la branche `slice/002-abonnement-palier`. Trois verdicts PASS (securite et contrats a la seconde serie, code a la cinquieme relecture). Cloture et livraison enchainees sur accord de l'humain (D-077).

## Etape suivante
`bash scripts/close-slice.sh` (fiche de preuves), `bash scripts/ship-slice.sh` (PR), puis fusion par l'humain sur preuves.
