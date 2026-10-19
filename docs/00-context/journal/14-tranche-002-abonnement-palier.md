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
- Seconde serie de relectures, en contexte neuf : verdicts dans `docs/04-runbooks/audits/{audit,contracts,review}-002.md`.

## Decisions
- D-057 a D-064 : gate d'ouverture (humain ; claude-code).
- D-065, D-067 : regles de l'humain pour l'implementation, signature `jsonb`, codes `SGxxx`, Stripe 10 s et une relance (humain).
- D-066, D-069 : decisions locales des phases 1 et 3 (claude-code).
- D-068, D-070, D-071 : validations et arbitrages de l'humain (refus non rejouables, 503 au contrat, `instrumentation.ts`, corrections des relectures, perimetre elargi deux fois).
Le detail est dans `docs/DECISIONS.md`.

## Preuves
- `pnpm test` : suite complete verte apres la phase 4 (nombre exact dans la fiche de preuves), `pnpm run check` vert, `pnpm audit --prod --audit-level=high` propre.
- Fiche de preuves `docs/04-runbooks/evidence/002.md` : produite par `scripts/close-slice.sh`, apres des verdicts PASS.
- Rapports des relecteurs : `docs/04-runbooks/audits/audit-002.md`, `contracts-002.md`, `review-002.md`.

## Incidents
- Runbook § 1 inapplicable (`pnpm db:migrate` sans `DATABASE_URL_MIGRATE` sur le poste) ; `.env` de developpement sans URL de role (backlog) ; serveur de test sans mot de passe `signet_app` apres une modification de `.env.test.local`. Voir `docs/04-runbooks/FRICTION.md` (2026-10-15).
- Perimetre fige par le hook `gate-check.sh` : deux elargissements ecrits par l'humain (D-070, D-071), jamais contournes.
- Un trigger `BEFORE TRUNCATE` sur `billing_event` cassait la remise a zero de la base de test : retire, limite ecrite dans ADR-0016.

## Etat a la fin
Code, migrations 0011 a 0013, tests et documentation sur la branche `slice/002-abonnement-palier`. Cloture (`close-slice.sh`) et livraison (`ship-slice.sh`) en attente des verdicts de la seconde serie de relectures et de la decision humaine.

## Etape suivante
Si les trois verdicts passent : `bash scripts/close-slice.sh`, puis `bash scripts/ship-slice.sh`, puis fusion par l'humain sur preuves. Sinon : arbitrage humain des constats.
