# 002 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : tests ecrits
- Branche : slice/002-abonnement-palier
- Dernier commit : df5d435 test(billing): ecrire les tests de la tranche 002
- Prochaine etape : `/implement`, en commencant par la migration de roles (`signet_billing`) ; trancher d'abord avec l'humain les ambiguites listees par test-writer (signature de la fonction definer, codes SQLSTATE, delais Stripe et file)

## Couches
- [ ] Migration (role `signet_billing` + INFO-1 ; `billing_event`, politiques, trigger, fonction definer)
- [ ] Acces donnees (connexion `signet_billing` isolee, lecture `subscription`)
- [ ] Logique metier (client Stripe, correspondance des statuts, fonction Inngest)
- [ ] API (`subscription` GET/POST, webhook Stripe, `/api/inngest`)
- [ ] UI — sans objet (Q-6, D-057)
- [ ] Documentation (ADR-0015, ADR-0016, ADR-0007, ADR-0011, ERD, contrat `subscriptions.ts`, runbook, `.env*.example`, CI)
- [ ] Suite complete verte + `pnpm run check`

## Blocages
<!-- cause, essais, options. Vide = aucun. -->
- A prevoir avant le premier `pnpm test` avec la nouvelle migration de roles : l'humain fixe le mot de passe de `signet_billing` et complete `.env.test.local` (noms dans `.env.test.example`).

## Decisions
<!-- Toute decision prise sans l'humain, avec sa raison. Reprise dans la PR. -->
- Gate d'ouverture : D-057 (humain), D-058 a D-064 (claude-code), voir `002-abonnement-palier.md` § Decisions du gate d'ouverture.

## Tests ecrits (test-writer, avant implementation)
Chemins et noms que les tests supposent (a respecter ou a renegocier avec l'orchestrateur, pas a contourner dans les tests) :
- Fonction Inngest : `apps/web/src/lib/inngest/process-stripe-event.ts`, export nomme `processStripeEvent`.
- Connexion `signet_billing` : `apps/web/src/lib/inngest/billing-db.ts` (AC16).
- Schema d'environnement : `apps/web/src/lib/env.ts`, export `parseServerEnv(raw: Record<string, string | undefined>)` qui leve une `Error` sans citer de valeur.
- Point de service : `apps/web/src/app/api/inngest/route.ts` (exports `GET`, `POST`, `PUT`).
- Fonction definer d'application d'etat Stripe : decouverte par le catalogue (seul `EXECUTE` explicite de `signet_billing`), appelee avec UN argument `jsonb` (cles : `stripe_event_id`, `occurred_at`, `event_type`, `stripe_subscription_id`, `stripe_customer_id`, `stripe_status`, `is_pro_price`, `cancel_at_period_end`, `current_period_end`, `metadata_organization_id`, `metadata_requested_by`). Voir `ApplyInput` dans `tests/helpers/billing-db.ts`.
- Les modules importes par les tests (`lib/env.ts`, `lib/inngest/*`, `app/api/inngest/route.ts`) utilisent des imports relatifs : vitest n'a pas d'alias `@/`.
