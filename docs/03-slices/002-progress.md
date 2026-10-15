# 002 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : implementation, couche Migration ecrite (3399cd1) ; **arret : serveur de test sans mot de passe pour `signet_app`** (voir Blocages)
- Branche : slice/002-abonnement-palier
- Dernier commit : 3399cd1 feat(db): billing_event, RLS et fonction apply_stripe_subscription (avant : db0adee docs(slice-002): reponses D-067, runbook et backlog sur .env)
- Prochaine etape : quand l'humain a corrige la connexion `signet_app` du serveur de test (Blocages), relancer `pnpm test tests/billing/database.test.ts tests/organizations tests/isolation-hardening tests/_factory` (attendu vert), puis couche Acces donnees (`lib/inngest/billing-db.ts`, lecture `subscription`) et ERD §0 (codes SG003 a SG007), §1, §8.

## Couches
- [ ] Migration
  - [x] role `signet_billing` + INFO-1 : `0011_billing_role.sql` (42711ed), ADR-0007 amende, ERD §1, §8.1 et table des migrations, backlog INFO-1 barre
  - [~] `billing_event`, politiques, triggers, fonction definer : `0012_billing_event.sql` (3399cd1). Sonde manuelle sous `signet_billing` verte (transitions, idempotence, SG003 a SG007, `ON DELETE SET NULL`, mutation directe refusee) ; tests AC6 b et e verts ; tests a fixture HTTP bloques (Blocages)
- [ ] Acces donnees (connexion `signet_billing` isolee, lecture `subscription`)
- [ ] Logique metier (client Stripe, correspondance des statuts, fonction Inngest)
- [ ] API (`subscription` GET/POST, webhook Stripe, `/api/inngest`)
- [ ] UI — sans objet (Q-6, D-057)
- [ ] Documentation (ADR-0015, ADR-0016, ADR-0007, ADR-0011, ERD, contrat `subscriptions.ts`, runbook, `.env*.example`, CI)
- [ ] Suite complete verte + `pnpm run check`

## Blocages
<!-- cause, essais, options. Vide = aucun. -->
- ~~Attente humaine (D-065 regle 1)~~ : levee le 2026-10-15 (D-067). Mot de passe fixe, `.env.test.local` complete (15 variables). `.env` non aligne (ne porte que `DATABASE_URL`) : non bloquant pour la tranche, suivi au backlog et au runbook etape 4.
- ~~Questions humaines ouvertes (D-065)~~ : tranchees le 2026-10-15 (D-067) : `jsonb` valide par la fonction elle-meme, codes `SGxxx`, Stripe 10 s et une relance.
- **Attente humaine (2026-10-15) : le serveur de test ne peut pas ouvrir sa connexion `signet_app`.** Symptome : toute creation d'organisation par l'API renvoie 500 ; journal du serveur : `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` (10 occurrences, aucune autre erreur). Ce message de `pg` signifie que l'URL lue par le serveur sous le nom `DATABASE_URL_APP` (fournie par `TEST_SERVER_ENV_DATABASE_URL_APP` de `.env.test.local`) ne porte pas de mot de passe exploitable : absent, vide, ou rendu illisible par un caractere non encode dans l'URL (`@`, `#`, `/`, `:`, `%` doivent etre encodes en `%40`, `%23`, `%2F`, `%3A`, `%25`). Preuves que la cause n'est pas le code de la tranche : (1) les suites de 001, non modifiees, echouent pareil (`tests/organizations` : 8 echecs, meme 500) ; (2) `signet.create_organization` appelee directement en base sous `signet_app` reussit ; (3) l'inscription (connexion `signet_auth` du serveur) reussit ; (4) les tests qui se connectent sous `signet_billing` et les tests de catalogue passent. Essais : relance apres retrait du trigger `TRUNCATE` (premiere cause, corrigee, voir Decisions) ; meme symptome. Aucun fichier local lu (regle). Action humaine : verifier dans `.env.test.local` que `TEST_SERVER_ENV_DATABASE_URL_APP` (et `TEST_DATABASE_URL_APP`) portent le mot de passe de `signet_app`, encode si besoin, sous la forme de `TEST_DATABASE_URL_BILLING` qui, elle, fonctionne.
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
- Phase 2, migration `0012_billing_event.sql` (a inscrire au registre avec ADR-0016) :
  - Fichier genere par `pnpm db:generate` sous le nom `0002_regular_ricochet.sql` (drizzle-kit numerote par son propre journal, qui ne compte que les migrations generees) : renomme `0012_billing_event.sql` et etiquette du journal `meta/_journal.json` alignee, comme pour 0002 et 0003. Instantane `meta/0002_snapshot.json` garde son nom (index drizzle).
  - Fonction `signet.apply_stripe_subscription(jsonb) RETURNS text` (`subscription_started`, `subscription_canceled` ou `updated`). Codes : SG003 entree invalide, SG004 metadonnee contradictoire avec la ligne deja rattachee (AC6 c, AC5 c), SG005 organisation non resolue (AC9 a), SG006 incoherence Stripe (Q-7 : autre abonnement rattache, client different, identifiant deja rattache ailleurs ; AC9 b, f), SG007 mutation du journal. Les cas « sans effet » levent plutot que de rendre un statut : regle 3 de `drizzle-postgres.md` (« echouer bruyamment, jamais conclure rien a faire ») et annulation de toute ecriture ; la fonction Inngest les convertira en resultat type (SG005, SG006) ou en erreur non rejouable (SG003, SG004).
  - Validation stricte : champ inconnu refuse, dates au format ISO 8601 complet (le cast Postgres accepterait `now`, `infinity`), textes de 1 a 255 caracteres, `event_type` et `stripe_status` dans leur liste fermee (statut inconnu = SG003, non rejouable : un nouveau statut Stripe doit etre decide, pas devine).
  - **Hypothese a valider par l'humain** : un abonnement dont le prix n'est pas `STRIPE_PRICE_ID_PRO` (`is_pro_price = false`) leve SG006, aucune ecriture, journalise. Le contrat ne tranche pas ce cas ; option la plus restrictive retenue, sur le modele de Q-7 (incoherence Stripe = aucune ecriture). Ecarte : l'ignorer pour le palier mais ecrire le statut (etat hybride).
  - `customer.subscription.deleted` force Free quel que soit le statut relu (un abonnement supprime ne revit pas chez Stripe ; contrat AC9 e « et `deleted` »).
  - Recherche par identifiant Stripe : politique `subscription_definer_stripe_lookup` (SELECT seul, `TO signet_definer`, sur `app.stripe_subscription_id` pose puis efface par la fonction). Ecartes : `BYPASSRLS` ou proprietaire `signet_owner` (interdits, ERD §1) ; passer l'organisation en argument (valeur choisie par l'appelant, ce qu'AC6 c interdit).
  - `reject_mutation` laisse passer l'action referentielle `ON DELETE SET NULL` d'`actor_user_id` (sinon la suppression d'un compte echoue, contraire a ERD §8.2 et a AC12) : `pg_trigger_depth() > 1` et seule colonne modifiee = `actor_user_id` vers NULL.
  - Trigger `TRUNCATE` ajoute puis retire dans le meme travail : `resetDatabase` des tests fait `TRUNCATE app_user ... CASCADE`, qui atteint `billing_event` par la FK ; l'ERD ne prevoit que UPDATE et DELETE, `signet_app` n'a pas `TRUNCATE`. Limite acceptee (proprietaire et superutilisateur peuvent vider la table), a ecrire dans ADR-0016.
  - `GRANT USAGE ON SCHEMA signet TO signet_billing` (resolution du nom de la fonction ; jamais `CREATE`).

## Tests ecrits (test-writer, avant implementation)
Chemins et noms que les tests supposent (a respecter ou a renegocier avec l'orchestrateur, pas a contourner dans les tests) :
- Fonction Inngest : `apps/web/src/lib/inngest/process-stripe-event.ts`, export nomme `processStripeEvent`.
- Connexion `signet_billing` : `apps/web/src/lib/inngest/billing-db.ts` (AC16).
- Schema d'environnement : `apps/web/src/lib/env.ts`, export `parseServerEnv(raw: Record<string, string | undefined>)` qui leve une `Error` sans citer de valeur.
- Point de service : `apps/web/src/app/api/inngest/route.ts` (exports `GET`, `POST`, `PUT`).
- Fonction definer d'application d'etat Stripe : decouverte par le catalogue (seul `EXECUTE` explicite de `signet_billing`), appelee avec UN argument `jsonb` (cles : `stripe_event_id`, `occurred_at`, `event_type`, `stripe_subscription_id`, `stripe_customer_id`, `stripe_status`, `is_pro_price`, `cancel_at_period_end`, `current_period_end`, `metadata_organization_id`, `metadata_requested_by`). Voir `ApplyInput` dans `tests/helpers/billing-db.ts`.
- Les modules importes par les tests (`lib/env.ts`, `lib/inngest/*`, `app/api/inngest/route.ts`) utilisent des imports relatifs : vitest n'a pas d'alias `@/`.
