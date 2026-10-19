# 002 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : corrections D-072 faites (277/277) ; troisieme relecture de code : `REVIEW: FAIL` pour un seul A CORRIGER documentaire (journaux en retard sur D-072), corrige ; **attente humaine** avant la cloture (nouvelle relecture, suggestion sur la borne haute)
- Branche : slice/002-abonnement-palier
- Dernier commit : voir `git log` ; corrections D-072 : 37ada6f (0013), 2e6d395 (concurrence Inngest), 7259b89 (409), 6282cc4 (tests), 303ded1 (docs) ; puis rapport de la troisieme relecture et mise a jour des journaux
- Prochaine etape : decision humaine sur la troisieme relecture (FAIL documentaire corrige) et sur la suggestion 3 (borne haute en refus definitif) ; puis relecture de code PASS, `bash scripts/close-slice.sh`, `bash scripts/ship-slice.sh`.

## Couches
- [x] Migration
  - [x] role `signet_billing` + INFO-1 : `0011_billing_role.sql` (42711ed), ADR-0007 amende, ERD §1, §8.1 et table des migrations, backlog INFO-1 barre
  - [x] `billing_event`, politiques, triggers, fonction definer : `0012_billing_event.sql` (3399cd1), suites base, 001 et 010 vertes (D-068)
- [x] Acces donnees : `lib/inngest/billing-db.ts` (316c9c6), regle de lint AC16
- [x] Logique metier : `lib/env.ts`, `lib/stripe.ts`, `lib/inngest/*`, `lib/billing/subscriptions.ts` (316c9c6, 07cead4)
- [x] API : `subscription` GET/POST, webhook Stripe, `/api/inngest` (07cead4)
- [ ] UI — sans objet (Q-6, D-057)
- [x] Documentation : ADR-0015 (d1e5051), ADR-0016, ADR-0011, ADR-0007, ERD, runbook (ee43428), contrat `subscriptions.ts` (07cead4), `.env*.example` et CI (115a813), journal de projet 14 (a049621)
- [x] Suite complete verte (277 tests, 24 fichiers, apres D-072) + `pnpm run check`

## Blocages
<!-- cause, essais, options. Vide = aucun. -->
- ~~Attente humaine (D-065 regle 1)~~ : levee le 2026-10-15 (D-067). Mot de passe fixe, `.env.test.local` complete (15 variables). `.env` non aligne (ne porte que `DATABASE_URL`) : non bloquant pour la tranche, suivi au backlog et au runbook etape 4.
- ~~Questions humaines ouvertes (D-065)~~ : tranchees le 2026-10-15 (D-067) : `jsonb` valide par la fonction elle-meme, codes `SGxxx`, Stripe 10 s et une relance.
- ~~Serveur de test sans mot de passe `signet_app`~~ : corrige par l'humain le 2026-10-15 (mot de passe vide sur les deux URL `_APP`), suites vertes (D-068).
- ~~`pnpm run check` rouge (modules absents)~~ : vert depuis 316c9c6.
- ~~Questions 503 et `instrumentation.ts`~~ : tranchees le 2026-10-15 (D-070) : 503 au contrat, `instrumentation.ts` dans le perimetre avec un test. `.env.test.local` complete par l'humain (bloc Facturation).
- ~~Perimetre fige~~ : elargi par l'humain (93403bb, D-070).
- ~~Relectures, premiere serie (2026-10-15)~~ : audit FAIL (CRITIQUE-1, UUID compare en texte), review FAIL (etat perime rejoue, auteur d'une resiliation par Stripe seul) ; decisions humaines D-071, perimetre elargi a `packages/db/src/schema/organizations.ts` (d5cc5ee). Corrections faites, seconde serie lancee.
- ~~Relectures, seconde serie (2026-10-19)~~ : audit PASS, contrats PASS, code PASS avec trois A CORRIGER ; decision humaine de les corriger avant la cloture (D-072), fait.

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
  - Valide par l'humain le 2026-10-15 (D-068), avec la condition : SG003 a SG006 non rejouables dans la fonction Inngest.
- Phase 3, code applicatif (registre D-069) :
  - `inngest` epingle en **4.23.0** et non 4.24.0 (`latest`) : 4.24.0 publiee le 2026-10-14 13:54Z, encore en quarantaine pnpm a l'ajout (2026-10-15 13:51Z) ; aucune exclusion. ADR-0015.
  - `protobufjs` (postinstall, tire par `inngest` via OpenTelemetry gRPC) refuse dans `allowBuilds` : il ne sert que l'outillage CLI de protobufjs. ADR-0015.
  - Environnement valide au chargement du premier module de facturation (`lib/env.ts`, `getServerEnv`), pas au demarrage du processus Next : le crochet de demarrage (`instrumentation.ts`) est hors perimetre de la tranche. Un serveur mal configure demarre, mais toute route de facturation echoue. Question a l'humain : ajouter `apps/web/src/instrumentation.ts` au perimetre (tranche 002 ou backlog) ? Ecarte : valider dans `db.ts` (charge par toutes les routes, y compris celles de 001 qui n'ont pas besoin de Stripe). **Tranche par l'humain (D-070) : `instrumentation.ts` ajoute au perimetre ; le serveur refuse de demarrer (`process.exit(1)`, place dans `lib/env.ts` pour rester hors du bundle Edge), preuve `tests/billing/startup.test.ts` (temoin + deux refus).**
  - Webhook : `503 SERVICE_UNAVAILABLE` si la file echoue ou ne repond pas en 5 s (AC14). Code **absent du contrat** `subscriptions.ts` : `_contract.ts` ne prevoit pas 503 et l'anti-regression limite la tranche a l'ajout de `409`. Question a l'humain : l'ajouter au contrat (avec 503 dans `_contract.ts`) ou le laisser hors contrat comme reponse d'infrastructure ? Ecarte : `500` generique (meme effet pour Stripe, mais confondu avec un bug). **Tranche par l'humain (D-070) : ajoute au contrat `subscriptions.ts`, 503 ajoute a `_contract.ts`.**
  - Client Inngest : `fetch` borne a 2 s par tentative (le SDK n'a aucun delai, 5 tentatives) ; le webhook abandonne a 5 s. Mesure : 503 en environ 5 s quand le faux Inngest ne repond pas.
  - Gestionnaires de `/api/inngest` enveloppes dans la signature standard `(request) => Response` : celle du SDK (`(NextRequest, res)`) refusait l'appel a un argument du test AC15 (TS2554). Le test n'est pas modifie.
  - `is_pro_price` : vrai seulement pour un abonnement a un seul article au prix `STRIPE_PRICE_ID_PRO` ; tout autre montage donne SG006 (D-068).
  - Abonnement introuvable a la relecture (`resource_missing`) : journalise et non rejoue, comme SG003 a SG006.
  - URL de retour Checkout : `APP_URL/organizations/<id>/billing?checkout=success|cancel` (chemin qui n'a pas besoin d'exister, Q-6).
  - Journal serveur : prefixe `[facturation]`, identifiants Stripe et code de refus seulement (AC9 a).
  - Execution locale des tests : les neuf variables de test inventees de `.env.test.example` ont ete passees par le terminal (le globalSetup trace leur provenance), en attendant que l'humain les copie dans `.env.test.local` (runbook § 2). Aucun fichier local lu ni modifie.
- Phase 4, corrections des relectures (D-071) :
  - Migration `0013_subscription_sync_guard.sql` plutot qu'une modification de 0012 (regle : migration appliquee immuable ; 0012 a deja ete jouee sur les bases de test). Fichier genere par `pnpm db:generate` sous `0003_ambiguous_naoko.sql`, renomme, etiquette alignee.
  - Garde monotone sur l'instant de RELECTURE pris apres la reponse de Stripe (milliseconde), comparaison stricte (`<`) : un etat relu au meme instant que le dernier applique s'applique (idempotent). Placee avant les controles de coherence : un etat perime ne leve jamais SG006.
  - Auteur de la transition choisi par la fonction Inngest (`canceled_by` si le statut relu mene a Free, `requested_by` sinon) et transmis dans la cle existante `metadata_requested_by` : l'entree de la fonction SQL ne gagne qu'une cle (`stripe_read_at`). Ecarte : une treizieme cle `metadata_canceled_by` (meme effet, deux cles a valider). La demande d'annulation continue de poser `requested_by` (AC3 a inchange) en plus de `canceled_by`.
  - Comparaison SG004 en `uuid` par `CASE` entre parentheses : Postgres ne garantit pas l'ordre d'evaluation d'un `OR` (cast possible sur une valeur invalide), et PL/pgSQL coupe la condition d'un `IF` au premier `THEN` hors parentheses (erreur rencontree, corrigee).
  - Regle de lint : selecteurs `no-restricted-syntax` pour `import()`, `require()` et `process.env.DATABASE_URL_BILLING` ; esquery n'accepte pas de `/` dans une expression reguliere de selecteur, meme echappe : la barre est ecrite `\x2F`). Limite : un `import()` d'une chaine calculee n'est pas detecte (ecrit dans ADR-0016).
  - `DATABASE_URL_BILLING` toujours validee au demarrage (`instrumentation.ts`) mais retiree de `ServerEnv` ; `billingDatabaseUrl()` revalide l'environnement a chaque construction du pool (une seule fois par processus).

- Phase 5, apres la seconde serie de relectures (D-072) : concurrence Inngest par abonnement ; borne haute de `stripe_read_at` (5 minutes, SG003) et commentaire de la garde corriges en place dans 0013 (hors `main`, precedent D-016) ; 409 decrit (contrat et message) ; trois tests directs de la garde dans `review-corrections.test.ts` (plutot que `database.test.ts`, pour ne pas modifier un test existant) ; ligne au backlog sur `canceled_by` ; commentaires perimes ; memoire des relecteurs committee.
## Tests ecrits (test-writer, avant implementation)
Chemins et noms que les tests supposent (a respecter ou a renegocier avec l'orchestrateur, pas a contourner dans les tests) :
- Fonction Inngest : `apps/web/src/lib/inngest/process-stripe-event.ts`, export nomme `processStripeEvent`.
- Connexion `signet_billing` : `apps/web/src/lib/inngest/billing-db.ts` (AC16).
- Schema d'environnement : `apps/web/src/lib/env.ts`, export `parseServerEnv(raw: Record<string, string | undefined>)` qui leve une `Error` sans citer de valeur.
- Point de service : `apps/web/src/app/api/inngest/route.ts` (exports `GET`, `POST`, `PUT`).
- Fonction definer d'application d'etat Stripe : decouverte par le catalogue (seul `EXECUTE` explicite de `signet_billing`), appelee avec UN argument `jsonb` (cles : `stripe_event_id`, `occurred_at`, `event_type`, `stripe_subscription_id`, `stripe_customer_id`, `stripe_status`, `is_pro_price`, `cancel_at_period_end`, `current_period_end`, `metadata_organization_id`, `metadata_requested_by`). Voir `ApplyInput` dans `tests/helpers/billing-db.ts`.
- Les modules importes par les tests (`lib/env.ts`, `lib/inngest/*`, `app/api/inngest/route.ts`) utilisent des imports relatifs : vitest n'a pas d'alias `@/`.
