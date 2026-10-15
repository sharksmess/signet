# Relecture de code, tranche 002 (slice/002-abonnement-palier, 6de91b2, base main)

## Methode
J'ai lu le diff complet `git diff main...HEAD` (21 commits, 57 fichiers) et les documents de reference : contrat `002-abonnement-palier.md` (AC1 a AC18), `002-decisions-humaines.md`, journal `002-progress.md`, registre D-057 a D-070, ADR-0015, ADR-0016, l'ERD (§0, §1, §8, matrice, table des migrations), le runbook `stripe-facturation-locale.md`, `CLAUDE.md` et `.claude/rules/` (documentation, git, drizzle-postgres).

J'ai relu en detail le code de production : `0011_billing_role.sql`, `0012_billing_event.sql` (dont `apply_stripe_subscription` ligne a ligne), `schema/billing.ts`, `lib/env.ts`, `instrumentation.ts`, `lib/stripe.ts`, `lib/inngest/{client,billing-db,process-stripe-event}.ts`, `lib/billing/subscriptions.ts`, les trois routes, `errors.ts` et `eslint.config.mjs`. J'ai lu les tests `tests/billing/*` et les fixtures `tests/helpers/billing*.ts` qui portent les constats ci-dessous.

Je n'ai pas lance `pnpm test`, parce que d'autres relecteurs tournent en parallele sur la meme base de test. Je reprends le resultat transmis par l'orchestrateur : 245/245 en 22 fichiers, `pnpm run check` vert. Je n'ai lu ni `.env*.local` ni l'environnement.

Ce que j'ai verifie sans y trouver de constat :
- **Regle D-065 n.2.** `git diff df5d435..HEAD --stat -- tests/` ne montre qu'un seul ajout, `tests/billing/startup.test.ts` (e0c47b2). Aucun test existant n'est modifie, et aucun test de 001, 010 ou 011 n'est touche.
- **Regles absolues.** Pas de `any`, pas de `// TODO`. Les erreurs metier sont typees (`Result`, `ApplyOutcome`). `throw` est reserve aux invariants : la ligne `subscription` absente, un resultat SQL inattendu, et `NonRetriableError` impose par l'API Inngest. Toute entree externe est validee (zod pour les routes et les donnees de file, la signature avant `JSON.parse`, le `jsonb` valide champ par champ dans la fonction). Le filtre tenant est explicite dans `readAsOwner`.
- **Documentation.** ERD a jour avec les deux migrations ; ADR-0015 pour les trois dependances (versions exactes, `protobufjs` refuse, aucune exclusion de quarantaine) ; registre et journal renseignes pour D-057 a D-070.
- **AC18 (verifie par relecture).** Le runbook documente le reglage A6 « Annuler l'abonnement » apres l'echec des paiements (§4), les trois valeurs Stripe du mode test (§3), le lancement facultatif d'Inngest en local (§5), et la procedure `\password signet_billing` que l'humain lance lui-meme (§1, etape 2). AC18 est satisfait, a une phrase pres (constat 2).
- **Historique.** Sujets Conventional Commits de 70 caracteres au plus, un commit par couche, trailer `Slice: 002`.

## Constats

### BLOQUANT

**1. Un instantane Stripe perime peut ecraser un etat plus recent, jusqu'a remettre en Pro un abonnement resilie (AC9 c)**
- **Emplacement :** `apps/web/src/lib/inngest/process-stripe-event.ts:80-95` (deux pas, aucune option `concurrency`), `packages/db/migrations/0012_billing_event.sql:294-364` (aucune garde d'anteriorite), ADR-0016 « Verrou » (l. 49-50).
- **Constat :** l'etat ecrit au pas 2 est celui relu au pas 1. D-061 veut justement que ce resultat soit memorise et rejoue sans rappeler Stripe, eventuellement longtemps apres, au fil des relances d'Inngest apres un echec de la base. Or rien n'ordonne les executions d'un meme abonnement : la fonction Inngest n'a pas de cle de concurrence, et la fonction SQL n'a pas de garde d'anteriorite. Le `FOR UPDATE` ordonne bien deux ecritures, mais il ne dit rien de l'age des instantanes qu'elles appliquent. Scenario : un evenement `updated` relit `active` (pas 1), son pas 2 echoue (base indisponible) ; Stripe resilie l'abonnement ; l'evenement `deleted` est traite entierement (Free, `subscription_canceled`) ; puis le pas 2 de `updated` est rejoue avec l'instantane `active`. La recherche par identifiant ne trouve plus rien (`stripe_subscription_id` est a NULL), la metadonnee designe l'organisation, aucune incoherence n'est detectee : l'organisation repasse Pro et un `subscription_started` est ecrit. Le meme entrelacement existe sans panne, en plus etroit, quand deux executions tournent en parallele.
- **Consequence :** aucun evenement Stripe ne suivra pour un abonnement supprime, donc l'organisation reste Pro sans payer, indefiniment. Le journal facturable, append-only, garde un faux `subscription_started` qu'on ne pourra pas corriger. AC9 c (« jamais un etat perime ; un `updated` traite apres la suppression ne refait pas passer l'organisation en Pro ») n'est prouve qu'en sequence (`tests/billing/processing.test.ts:491-506`). ADR-0016 presente le verrou comme suffisant (« deux traitements concurrents s'ordonnent »), et c'est faux pour ce cas.
- **Direction :** decision a faire trancher par l'humain, car elle touche D-061 et Q-2. Options : (a) serialiser par abonnement (`concurrency` avec une cle sur `event.data.subscriptionId`, limite 1) et relire Stripe dans le meme pas que l'ecriture, ou a chaque tentative du pas 2 ; (b) garde monotone en base, par exemple l'horodatage de relecture compare a celui de la derniere application, au prix d'une colonne ; (c) refuser en SQL de rattacher a nouveau un abonnement deja detache par un `deleted`. Ajouter un test du scenario « pas 2 rejoue apres un `deleted` complet », sur le modele d'AC8 e, puis mettre ADR-0016 et le registre a jour.

**2. `metadata.requested_by` designe a la fois le souscripteur et l'auteur de l'annulation : une resiliation par Stripe seul est attribuee au souscripteur**
- **Emplacement :** `apps/web/src/lib/billing/subscriptions.ts:135` (pose au Checkout) et `:156` (pose a l'annulation), `packages/db/migrations/0012_billing_event.sql:288-292` et `:398-404`, `tests/billing/processing.test.ts:257-285`, `docs/04-runbooks/stripe-facturation-locale.md:105`, contrat AC2 a et AC3 e.
- **Constat :** AC2 a impose `subscription_data.metadata.requested_by = owner` sur tout abonnement cree par notre Checkout. Tout abonnement reel porte donc cette cle des sa creation. Quand Stripe resilie seul (impaye apres le reglage A6), la relecture renvoie encore le `requested_by` du souscripteur, et `subscription_canceled` est ecrit avec `actor_user_id` = ce souscripteur. AC3 e (« une resiliation par Stripe seul (impaye, sans `requested_by`) porte aussi `NULL` ») et le runbook §4 (« sans auteur (`actor_user_id` NULL) ») decrivent un cas qui n'arrive pas. Le test correspondant passe parce que sa fixture construit un abonnement sans `requested_by` (`stripeSubscriptionObject` avec `metadata = { organization_id }`), ce que notre propre Checkout ne produit jamais. L'incoherence vient du contrat (AC2 a contre AC3 e) ; le code l'applique fidelement.
- **Consequence :** sur toute resiliation pour impaye, US-08.3 attribue l'arret a un owner qui ne l'a pas demande. `billing_event` est append-only, donc ces attributions sont definitives. C'est faux au regard du critere et du runbook, et le test ne peut pas le detecter.
- **Direction :** remonter a l'humain, car le contrat change (cle d'AC2 a). Par exemple, deux cles distinctes : une cle de souscription posee au Checkout et lue seulement pour `subscription_started`, et une cle d'annulation posee par `cancelAtPeriodEnd` et lue seulement pour `subscription_canceled`. Aligner la fixture d'AC3 e sur un abonnement cree par notre Checkout (avec la cle de souscription), puis corriger le runbook §4 et le registre.

### A CORRIGER

**3. AC9 e : la branche « evenement `deleted` force Free » n'est discriminee par aucun test**
- **Emplacement :** `packages/db/migrations/0012_billing_event.sql:341`, `tests/billing/processing.test.ts:539-581` et `:207-238`.
- **Constat :** le contrat exige « un test par ligne », dont « `deleted` -> Free ». Le tableau d'AC9 e n'a pas de ligne `deleted`, et AC3 c/d envoient `deleted` avec un statut relu `canceled`, qui donne Free par la branche du statut. Si l'on retire `v_event_type = 'customer.subscription.deleted' OR` de la ligne 341, toute la suite reste verte. De meme, « `incomplete` -> palier inchange » n'est verifie qu'en partant de Free, cas ou « inchange » et « Free » se confondent.
- **Consequence :** la decision du journal (« `deleted` force Free quel que soit le statut relu ») n'est pas protegee contre une regression.
- **Direction :** ajouter un cas `deleted` avec un statut relu non terminal (par exemple `active`) et attendre Free, plus un cas `incomplete` depuis Pro. Les deux sont de simples lignes en plus dans les tests.

**4. Organisation Free avec un abonnement `incomplete` rattache : un second Checkout est accepte, puis son abonnement paye est refuse**
- **Emplacement :** `apps/web/src/lib/billing/subscriptions.ts:111-113`, `packages/db/migrations/0012_billing_event.sql:327-330` et `:350-364`.
- **Constat :** sur Free, `incomplete` rattache `stripe_subscription_id` en gardant le palier Free (comme le prevoit Q-8). `changeTier` ne regarde que `tier` et ouvre un nouveau Checkout. Les evenements du second abonnement, paye, levent alors SG006 (« un autre abonnement deja rattache ») et ne sont jamais rejoues. L'organisation reste Free jusqu'a l'expiration du premier puis un evenement ulterieur du second, typiquement le renouvellement suivant.
- **Consequence :** un client qui paie reste Free pendant jusqu'a une periode de facturation. Le cas n'est ni teste ni ecrit dans une decision.
- **Direction :** faire trancher le comportement par l'humain : 409 sur `pro` si un abonnement est rattache, quel que soit le palier, ou rattachement du plus recent dans ce cas precis. A defaut, l'inscrire au backlog avec sa consequence.

**5. Journal de tranche perime et journal de projet absent**
- **Emplacement :** `docs/03-slices/002-progress.md:6` et `:8`, `docs/00-context/journal/` (pas de `14-*`).
- **Constat :** l'etat annonce « 242 tests, 21 fichiers », « attente humaine : deux questions (503 hors contrat, `instrumentation.ts`) » et le dernier commit `ee43428`. Ces deux questions sont tranchees (D-070) et quatre commits ont suivi, dont `6de91b2`. L'entree 14 du journal de projet, prevue par la tranche et verifiee par `close-slice.sh`, n'existe pas encore.
- **Consequence :** un lecteur qui reprend la tranche sur la foi du journal croit qu'elle est bloquee. La cloture echouera sur le controle du journal de projet.
- **Direction :** mettre a jour la section Etat (245/22, dernier commit, plus de blocage) et ecrire `journal/14-*` avec sa ligne dans `JOURNAL.md` avant `close-slice.sh`.

**6. `INNGEST_EVENT_KEY` exigee hors mode developpement sans decision ecrite ni test**
- **Emplacement :** `apps/web/src/lib/env.ts:64-66`, contrat l. 144, D-069.
- **Constat :** le contrat et A2 n'exigent que `INNGEST_SIGNING_KEY`. Le schema refuse aussi le demarrage sans `INNGEST_EVENT_KEY`. Le choix est raisonnable (sans elle, `inngest.send` echoue en production), mais il n'apparait ni dans le journal ni au registre (D-069 ne le cite pas), et aucun test ne couvre son absence. `validProductionEnv` la fournit toujours.
- **Consequence :** c'est une regle de demarrage en production non documentee. Un auditeur ne peut pas savoir si elle est voulue.
- **Direction :** une ligne dans les Decisions du journal (et dans D-069 ou une nouvelle entree), plus un cas « `INNGEST_EVENT_KEY` absente hors mode developpement -> refus » dans `environment.test.ts`.

**7. Table des migrations de l'ERD coupee en deux**
- **Emplacement :** `docs/02-architecture/ERD.md:976` (ligne vide entre les lignes 0011 et 0012).
- **Constat :** la ligne vide termine le tableau Markdown. La ligne 0012 devient un paragraphe isole, sans en-tete, rendu comme du texte brut.
- **Consequence :** la migration de la tranche est mal lisible dans le document de reference.
- **Direction :** supprimer la ligne vide.

### SUGGESTION

**8. La regle `no-restricted-imports` d'AC16 se contourne par des formes d'import non couvertes**
- **Emplacement :** `eslint.config.mjs:74` et `:85`.
- **Constat :** l'expression ne couvre ni l'extension `.js` (`@/lib/inngest/billing-db.js`, resolu vers le `.ts` par TypeScript), ni `../billing-db` depuis un sous-dossier de `lib/inngest/`, ni `import()` dynamique. Par ailleurs, la regle entiere est mise a `"off"` pour `process-stripe-event.ts`, ce qui y desactivera toute future restriction d'import, pas seulement celle-ci.
- **Direction :** elargir l'expression a toute fin de chemin `billing-db` avec ou sans extension, ajouter un cas de test par forme, et reexprimer l'exception par une surcharge qui ne retire que ce motif. `security-auditor` jugera l'enjeu.

**9. SG004 compare des UUID comme du texte**
- **Emplacement :** `packages/db/migrations/0012_billing_event.sql:304`.
- **Constat :** `v_metadata_org IS DISTINCT FROM v_org::text` est sensible a la casse, alors que la branche de premier rattachement convertit en `uuid`. Une metadonnee en majuscules designant la bonne organisation leverait SG004, refus definitif.
- **Direction :** comparer en `uuid` quand la valeur respecte `c_uuid_pattern`, et lever SG004 sinon.

**10. La recherche par identifiant precede le verrou**
- **Emplacement :** `packages/db/migrations/0012_billing_event.sql:295-321` et commentaire l. 172-176.
- **Constat :** l'organisation est resolue avant le `FOR UPDATE`. Les controles Q-7 faits ensuite sur `v_current` rattrapent les cas connus, mais le commentaire « verrouillee avant toute decision » surestime la garantie. Ce point s'ajoute au constat 1.
- **Direction :** preciser le commentaire et l'ADR quand le constat 1 sera traite.

## Bilan
- **Solide :** fonction definer rigoureuse (validation `jsonb` complete, contexte ambiant efface, codes SG distincts, rejeu absorbe), isolement de `signet_billing` en base et au lint, webhook verifie avant analyse avec 503 borne, refus de demarrer prouve de bout en bout, documentation abondante et tracee.
- **Fragile :** l'ordre des instantanes Stripe entre executions (constat 1), l'attribution des annulations (constat 2), une branche Q-8 sans test discriminant (constat 3).
- **Manquant :** decision humaine sur les constats 1, 2 et 4, journal de tranche a jour, entree 14 du journal de projet, trace de la regle `INNGEST_EVENT_KEY`.

REVIEW: FAIL
