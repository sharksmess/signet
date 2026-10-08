# 002 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : implementation, phase 1 terminee (role `signet_billing` + runbook) ; **point d'arret D-065 regle 1**
- Branche : slice/002-abonnement-palier
- Dernier commit : e0f825c docs(billing): runbook du mot de passe de signet_billing (avant : 42711ed feat(db): creer le role signet_billing et etendre l'assertion de roles)
- Prochaine etape : quand l'humain a fixe le mot de passe et complete ses fichiers locaux (runbook `docs/04-runbooks/stripe-facturation-locale.md` § 1) **et** repondu aux questions ouvertes de D-065 (signature de la fonction definer : un `jsonb` ou des arguments types ; codes d'erreur `SGxxx` ou `P0001` ; delai et relances des appels Stripe), migration `billing_event` (`pnpm db:generate` + SQL des politiques, trigger, fonction definer, `GRANT EXECUTE` a `signet_billing`), puis acces donnees. Premier `pnpm test` a ce moment-la (AC6 e attendu vert).

## Couches
- [ ] Migration
  - [x] role `signet_billing` + INFO-1 : `0011_billing_role.sql` (42711ed), ADR-0007 amende, ERD §1, §8.1 et table des migrations, backlog INFO-1 barre
  - [ ] `billing_event`, politiques, trigger, fonction definer (attend les reponses humaines de D-065)
- [ ] Acces donnees (connexion `signet_billing` isolee, lecture `subscription`)
- [ ] Logique metier (client Stripe, correspondance des statuts, fonction Inngest)
- [ ] API (`subscription` GET/POST, webhook Stripe, `/api/inngest`)
- [ ] UI — sans objet (Q-6, D-057)
- [ ] Documentation (ADR-0015, ADR-0016, ADR-0007, ADR-0011, ERD, contrat `subscriptions.ts`, runbook, `.env*.example`, CI)
- [ ] Suite complete verte + `pnpm run check`

## Blocages
<!-- cause, essais, options. Vide = aucun. -->
- **Attente humaine (D-065 regle 1)** : fixer le mot de passe de `signet_billing` et ajouter `TEST_DATABASE_URL_BILLING`, `TEST_SERVER_ENV_DATABASE_URL_BILLING` a `.env.test.local` et `DATABASE_URL_BILLING` a `.env` (runbook `stripe-facturation-locale.md` § 1, noms dans `.env.test.example` / `.env.example`). Aucun `pnpm test` lance en phase 1 (consigne) : 0011 n'a pas encore ete jouee contre une base.
- **Questions humaines ouvertes (D-065)** : signature de la fonction definer, codes d'erreur, delai et relances Stripe. Bloquent la suite de la couche Migration.
- `pnpm run check` rouge **avant et apres** la phase 1, pour une cause attendue : les tests ecrits en df5d435 importent des modules encore absents (`lib/env.ts`, `api/inngest/route.ts`, `lib/inngest/process-stripe-event.ts`, `@inngest/test`), d'ou TS2307 et des erreurs de lint `no-unsafe-*` dans `tests/billing/environment.test.ts` et `tests/helpers/billing.ts` seulement. `@signet/web` et `@signet/db` passent leur typecheck.

## Decisions
<!-- Toute decision prise sans l'humain, avec sa raison. Reprise dans la PR. -->
- Gate d'ouverture : D-057 (humain), D-058 a D-064 (claude-code), voir `002-abonnement-palier.md` § Decisions du gate d'ouverture.
- Phase 1 (registre D-066) :
  - 0011 **leve** si un reglage `pg_db_role_setting` existe pour un des cinq roles, sans l'effacer ; message limite aux noms de roles et de bases, jamais aux valeurs. Raison : meme principe que 0010 pour les appartenances (etat commun au cluster, configuration d'administrateur a ne pas cacher). Ecarte : `ALTER ROLE ... RESET ALL` silencieux.
  - Appartenances dans le sens inverse : 0011 leve aussi si un role quelconque est membre d'un role `signet_*` (INFO-1), pour les cinq roles. 0010 reste inchangee (immuable).
  - Migration de roles ecrite a la main (`0011_billing_role.sql`), sans `pnpm db:generate` : precedent 0004 a 0010, aucune table touchee, `meta/` inchange.
  - CI : `signet_billing:ci_only_not_a_secret` ajoute a `TEST_ROLE_PASSWORDS`, `TEST_DATABASE_URL_BILLING` et `TEST_SERVER_ENV_DATABASE_URL_BILLING` sans mot de passe (`PGPASSWORD`), comme les autres roles. Les autres variables CI de la tranche (Stripe, Inngest) viendront avec leurs couches.
  - `.env.example` n'existait pas : cree avec les noms deja lus par l'application (`DATABASE_URL_MIGRATE`, `DATABASE_URL_APP`, `DATABASE_URL_AUTH`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_ENV`) et `DATABASE_URL_BILLING`. Les noms Stripe et Inngest seront ajoutes avec le code qui les lit. Ecarte : les ajouter des maintenant (valeurs de test et ports dependants de couches non ecrites ; l'humain devra donc completer ses fichiers une seconde fois pour ces variables).
  - Runbook : `\password signet_billing` dans `psql` plutot que `ALTER ROLE ... WITH PASSWORD` (mot de passe en clair dans l'historique `psql` et les journaux) ; les URL completes ne sont pas recopiees dans le runbook (refus du pre-commit, FRICTION 2026-10-08), il renvoie aux lignes des modeles.

## Tests ecrits (test-writer, avant implementation)
Chemins et noms que les tests supposent (a respecter ou a renegocier avec l'orchestrateur, pas a contourner dans les tests) :
- Fonction Inngest : `apps/web/src/lib/inngest/process-stripe-event.ts`, export nomme `processStripeEvent`.
- Connexion `signet_billing` : `apps/web/src/lib/inngest/billing-db.ts` (AC16).
- Schema d'environnement : `apps/web/src/lib/env.ts`, export `parseServerEnv(raw: Record<string, string | undefined>)` qui leve une `Error` sans citer de valeur.
- Point de service : `apps/web/src/app/api/inngest/route.ts` (exports `GET`, `POST`, `PUT`).
- Fonction definer d'application d'etat Stripe : decouverte par le catalogue (seul `EXECUTE` explicite de `signet_billing`), appelee avec UN argument `jsonb` (cles : `stripe_event_id`, `occurred_at`, `event_type`, `stripe_subscription_id`, `stripe_customer_id`, `stripe_status`, `is_pro_price`, `cancel_at_period_end`, `current_period_end`, `metadata_organization_id`, `metadata_requested_by`). Voir `ApplyInput` dans `tests/helpers/billing-db.ts`.
- Les modules importes par les tests (`lib/env.ts`, `lib/inngest/*`, `app/api/inngest/route.ts`) utilisent des imports relatifs : vitest n'a pas d'alias `@/`.
