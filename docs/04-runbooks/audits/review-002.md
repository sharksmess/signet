# Relecture de code, tranche 002, seconde serie (slice/002-abonnement-palier, a049621, base main)

## Methode
J'ai relu toute la tranche de facon independante, sur le diff `git diff main...HEAD` (29 commits, 66 fichiers). J'ai relu de plus pres les six commits de corrections posterieurs a la premiere serie, `git diff 6de91b2..HEAD` (d5cc5ee a a049621, 27 fichiers). Documents de reference lus :
- `CLAUDE.md` et `.claude/rules/` (documentation, git, drizzle-postgres, dependencies) ;
- le contrat `002-abonnement-palier.md`, amende par D-071, et `002-decisions-humaines.md` ;
- le journal `002-progress.md` (dont la « Phase 4 ») et le registre D-057 a D-071 ;
- ADR-0015 et ADR-0016, et les amendements d'ADR-0007 et d'ADR-0011 ;
- l'ERD (colonne `stripe_synced_at` et table des migrations) ;
- le runbook `stripe-facturation-locale.md` ;
- le journal de projet `14-tranche-002-abonnement-palier.md` et son index `JOURNAL.md` ;
- les trois rapports de la premiere serie.

Code de production relu ligne a ligne : `0013_subscription_sync_guard.sql` (fonction remplacee en entier, comparee a 0012), `schema/organizations.ts`, `lib/env.ts`, `instrumentation.ts`, `lib/inngest/{billing-db,process-stripe-event}.ts`, `lib/billing/subscriptions.ts`, la route `subscription`, `errors.ts` et la fonction `billingIsolation()` d'`eslint.config.mjs`.

Tests relus :
- **ajoutes** : `review-corrections.test.ts`, `lint-isolation-forms.test.ts` ;
- **modifies** depuis la premiere serie : `processing.test.ts` (AC3 c et e), `database.test.ts` (une ligne), `tests/helpers/billing-db.ts` (une cle) ;
- **fixtures** : `subscriptionFor` et `stripeSubscriptionObject` (`tests/helpers/billing.ts`).

Je n'ai pas lance `pnpm test`, parce que d'autres relecteurs tournent en parallele sur la meme base de test. Je reprends le resultat transmis par l'orchestrateur : 274/274 en 24 fichiers, `pnpm run check` vert. J'ai verifie la logique des tests a la lecture, en me demandant pour chacun s'il echouerait sans la correction qu'il couvre. Je n'ai lu ni `.env*.local` ni l'environnement.

Ce que j'ai verifie sans y trouver de constat :
- **Regle D-065 n.2 (aucun test affaibli).** `git diff 6de91b2..HEAD -- tests/` ne touche que cinq fichiers.
  - `database.test.ts` et `helpers/billing-db.ts` ajoutent seulement la cle `stripe_read_at`, devenue obligatoire.
  - AC3 c ajoute `canceled_by` a la fixture et garde toutes ses assertions.
  - AC3 e garde ses quatre cas et en ajoute un cinquieme : souscripteur dans `requested_by`, aucun `canceled_by`, `actor_user_id` NULL attendu. Ce cas est exactement celui que la premiere serie disait non detectable.
  - Ces modifications sont nommees et justifiees dans D-071.
  - Les tests sont discriminants ensemble. Une implementation qui lirait toujours `requested_by` echouerait au cinquieme cas d'AC3 e. Une implementation qui lirait toujours `canceled_by` echouerait a AC2 c, dont la fixture n'a que `requested_by`.
- **Le test de la garde monotone est discriminant.** `review-corrections.test.ts:158-198` rejoue le pas « appliquer-etat » avec l'instantane memorise (`stripe_read_at` anterieur au `deleted`). Sans la garde, ce rejeu repasserait l'organisation en Pro (abonnement detache, metadonnee valide) et ecrirait un `subscription_started` : les assertions `tier: "free"` et `["subscription_canceled"]` echoueraient.
- **Migration 0013.** 0012 n'est pas modifiee. Le fichier a ete genere puis renomme, avec l'etiquette du journal alignee. La colonne nullable est justifiee dans le schema Drizzle et dans l'ERD. La fonction garde les points 1, 2 et 5 de la liste `SECURITY DEFINER` (`search_path`, proprietaire `signet_definer`, `REVOKE`/`GRANT`), le controle `ROW_COUNT`, l'effacement du contexte ambiant et la validation complete du `jsonb` (`stripe_read_at` est soumise au format ISO). La comparaison SG004 en `uuid` passe par un `CASE` qui evite tout cast d'une valeur invalide. La garde est placee apres le verrou et avant les controles Q-7, comme le dit le journal.
- **Regles absolues.** Pas de `any`, pas de `// TODO`, pas de `eslint-disable` dans le code ni les tests de la tranche. `stale` est un resultat type (`ApplyResult`). Les refus restent des valeurs (`ApplyOutcome`). L'identifiant d'organisation est mis en minuscules a l'entree des deux routes, et le filtre tenant de `readAsOwner` est inchange.
- **Isolement AC16 (constat 8 de la premiere serie).**
  - Couvert par la regle : toutes les extensions, tout chemin relatif, `import()`, `require()`, les trois formes d'acces a `process.env.DATABASE_URL_BILLING`, et l'accesseur `billingDatabaseUrl`. L'exception du module de la fonction ne retire plus que le motif `./billing-db`.
  - Prouve par les tests : chaque refus a son temoin positif, et les temoins ecartent le faux vert d'une analyse en echec (`fatal`).
  - Non couvert : la limite residuelle (chaine calculee) est ecrite dans ADR-0016.
- **`ServerEnv` sans `DATABASE_URL_BILLING`.** La variable est toujours exigee au demarrage, mais `getServerEnv()` ne l'expose plus. `grep` confirme que seul `billing-db.ts` appelle `billingDatabaseUrl()`.
- **AC18 (verifie par relecture).** Le runbook documente :
  - le reglage A6 « Annuler l'abonnement » (§4), dont la phrase « sans auteur » est maintenant vraie pour une resiliation par Stripe seul ;
  - les trois valeurs Stripe du mode test (§3, etape 2) ;
  - le lancement facultatif d'Inngest (§5) ;
  - `\password signet_billing`, lance par l'humain (§1, etape 2).

  AC18 est satisfait.
- **Documentation.**
  - D-071 decrit chaque decision avec les options ecartees, et le journal en donne le detail (« Phase 4 »).
  - ADR-0016 est a jour : garde, auteur, statut relu, isolement renforce.
  - Le contrat est amende : AC3 a, c, e, AC9 e, AC17.
  - L'ERD est a jour : colonne, table des migrations, numerotation.
  - L'entree 14 du journal de projet est ecrite et indexee.
  - Les deux reports sont ecrits au backlog : audit MINEUR-1 et INFO-3.

## Constats

### A CORRIGER

**1. Les limites de la garde monotone ne sont pas ecrites, et le commentaire SQL promet plus que la garde ne tient**
- **Emplacement :** `packages/db/migrations/0013_subscription_sync_guard.sql:182-187` (« execution concurrente plus lente »), `apps/web/src/lib/inngest/process-stripe-event.ts:97-99`, ADR-0016 « Garde monotone » (l. 57-63), `process-stripe-event.ts:84-85` (toujours aucune option `concurrency`).
- **Constat :** la garde ordonne les etats selon `stripe_read_at`, c'est-a-dire l'horloge du processus qui a recu la reponse de Stripe, lue apres cette reponse. Elle couvre le scenario bloquant de la premiere serie (rejeu de plusieurs secondes ou minutes, test a l'appui). Elle couvre aussi deux executions concurrentes dont les ecritures se croisent. En revanche, `stripe_read_at` borne l'instantane Stripe par le haut, pas par le bas. Une execution dont l'instantane est plus ancien, mais dont la reponse arrive plus tard (lenteur reseau, ou relance du SDK Stripe sur une autre execution), porte une marque plus recente et ecrase l'etat plus frais. De plus, les marques viennent d'horloges de processus differents : un ecart entre instances fait le meme effet. Aucune cle de concurrence Inngest ne serialise les executions d'un meme abonnement. Le cas reste etroit : au moment de la Checkout, un `created` relu `incomplete` peut arriver apres un `updated` relu `active`, et laisser `status = 'incomplete'` jusqu'a l'evenement suivant, sans effet sur le palier. Mais ni le commentaire SQL ni l'ADR ne le disent, et le commentaire affirme le contraire.
- **Consequence :** un auditeur qui lit le code croit le desordre concurrent entierement couvert. La prochaine tranche qui s'appuiera sur `status` (affichage, relance d'impaye) heritera d'une garantie qui n'existe pas.
- **Direction :** decrire la limite dans ADR-0016 (marque = instant de reception, horloges des instances) et corriger le commentaire de 0013 dans une prochaine migration, ou a defaut dans l'ADR seul (0013 est appliquee). L'option peu couteuse qui la ferme presque entierement : `concurrency: { key: "event.data.subscriptionId", limit: 1 }` sur la fonction Inngest. Elle merite une ligne au registre, retenue ou ecartee.

**2. Le refus « abonnement `incomplete` rattache » renvoie un message et une description de contrat qui ne le couvrent pas**
- **Emplacement :** `apps/web/src/lib/errors.ts:61-65`, `docs/02-architecture/api-contracts/subscriptions.ts:77`, `apps/web/src/lib/billing/subscriptions.ts:116`.
- **Constat :** D-071 (3) ajoute un nouveau cas de `409 ALREADY_ON_TIER` : `POST pro` sur une organisation **Free** dont un abonnement est rattache. Le message renvoye au client dit « L'organisation est deja sur ce palier, ou son annulation est deja programmee. » : c'est faux pour une organisation Free. Le `trigger` du 409 dans le contrat `subscriptions.ts` n'a pas ete amende (seul AC17 l'a ete).
- **Consequence :** l'owner d'une organisation Free recoit un message qui contredit le `GET` (`tier: "free"`). Il ne peut pas savoir qu'il doit attendre la fin du paiement en cours, ou son expiration par Stripe en environ 23 h. Le contrat machine reste en retard sur la decision.
- **Direction :** amender le `trigger` du 409 dans `subscriptions.ts`, et elargir le message (par exemple « ... ou un abonnement est deja en cours de paiement »). Le code `ALREADY_ON_TIER` reste inchange. `contract-guardian` jugera l'anti-regression du contrat.

**3. Journal de tranche en partie perime**
- **Emplacement :** `docs/03-slices/002-progress.md:8`, `:19`, `:20`.
- **Constat :** l'Etat est a jour. En revanche, « Dernier commit » renvoie a `git log` au lieu de nommer a049621 (`rules/git.md` : mettre a jour le dernier commit). La couche Documentation indique encore « reste : journal de projet 14 », alors que l'entree existe. La suite est annoncee a « 242 tests », pour 274 en realite.
- **Consequence :** a la reprise apres interruption, le journal dit d'ecrire une entree deja ecrite. L'ecart de 32 tests ne permet pas de savoir lesquels ont ete ajoutes.
- **Direction :** trois lignes a corriger avant `close-slice.sh`.

### SUGGESTION

**4. `stripe_read_at` n'est borne ni par le haut ni par rapport a l'horloge de la base**
- **Emplacement :** `packages/db/migrations/0013_subscription_sync_guard.sql:127-135` et `:240`.
- **Constat :** une marque dans le futur, par exemple une instance dont l'horloge avance de plusieurs heures, est ecrite dans `stripe_synced_at`. Tous les etats suivants deviennent alors `stale`, journalises en `info` seulement, jusqu'a ce que l'horloge les rattrape. L'organisation peut rester Pro apres une resiliation pendant ce temps.
- **Direction :** refuser en SG003 un `stripe_read_at` superieur a `now()` plus une tolerance (quelques minutes), avec un test, dans la prochaine migration qui touchera la fonction. Ou ecrire la limite dans ADR-0016 avec le constat 1.

**5. `canceled_by` survit a une reactivation**
- **Emplacement :** `apps/web/src/lib/billing/subscriptions.ts:160`, `apps/web/src/lib/inngest/process-stripe-event.ts:54-55`.
- **Constat :** la cle n'est jamais effacee. Si une annulation programmee est retiree (tableau de bord Stripe aujourd'hui, ou tranche Q-4 plus tard), puis que Stripe resilie pour impaye, l'owner qui avait demande puis retire l'annulation est enregistre comme auteur. Le cas est hors perimetre (Q-4), mais rien ne le signale a la tranche qui l'ouvrira.
- **Direction :** une ligne au backlog, a cote de Q-4 : « la reactivation efface `canceled_by` ».

**6. La garde n'est testee qu'au travers de la fonction Inngest**
- **Emplacement :** `tests/billing/database.test.ts`, `tests/billing/review-corrections.test.ts:157-198`.
- **Constat :** deux branches de la garde n'ont aucun test : l'egalite des marques (choix explicite du journal : « un etat relu au meme instant s'applique ») et l'ordre « `stale` avant SG006 » (un etat perime ne leve jamais SG006). Un `<` change en `<=`, ou la garde deplacee apres les controles Q-7, laisseraient la suite verte.
- **Direction :** deux cas en appel direct de la fonction dans `database.test.ts`.

**7. Commits de corrections crees en lot, avec des etats intermediaires rouges**
- **Emplacement :** d67dfe6, d9a1b62, 563f580 et 2accc16, crees en moins de trois secondes.
- **Constat :** d67dfe6 rend `stripe_read_at` obligatoire, alors que `process-stripe-event.ts` ne l'envoie qu'a partir de d9a1b62 et que `database.test.ts` ne la fournit qu'a partir de 2accc16. Ces deux commits ne passent donc pas les tests de leur couche (`rules/git.md`). Les tests sont committes apres le code qu'ils couvrent. Les corps de commit sont vides alors que le pourquoi n'est pas evident (garde, auteur). Le squash a la fusion limite l'effet sur `main`.
- **Direction :** rien a reecrire, la branche sera ecrasee au squash. Pour les prochaines corrections, committer chaque couche verte au fil de l'eau, avec une ligne de pourquoi dans le corps.

**8. Petites derives de commentaires**
- **Emplacement :** `apps/web/src/instrumentation.ts:139-143`, ADR-0016 titre de section « (migration 0012) » (l. 34).
- **Constat :** le commentaire du crochet liste encore les seuls refus d'avant D-071 : il ne cite pas `INNGEST_EVENT_KEY`. La section de l'ADR attribue la fonction a 0012, alors qu'elle est remplacee par 0013.
- **Direction :** les aligner a la prochaine occasion.

## Suivi des constats de la premiere serie

| # | Gravite (1re serie) | Constat | Etat |
|---|---|---|---|
| 1 | BLOQUANT | Instantane perime rejoue apres un `deleted` | **Corrige.** Garde monotone (`stripe_synced_at`, 0013, D-071 (1)), test discriminant `review-corrections.test.ts:158`. Limite residuelle en concurrence non ecrite : constat 1 ci-dessus. |
| 2 | BLOQUANT | `requested_by` sert a la fois au souscripteur et a l'auteur de l'annulation | **Corrige.** Cle `canceled_by` (D-071 (2)), lue seulement quand le statut relu mene a Free ; AC3 c/e amendes ; cas « souscripteur present, aucun `canceled_by` » ajoute ; runbook §4 desormais exact. |
| 3 | A CORRIGER | Branche « `deleted` force Free » non discriminee | **Corrige par changement de regle.** D-071 (4) : le statut relu decide seul ; test « `deleted` relu actif » (`review-corrections.test.ts:218`) et « `incomplete` depuis Pro » (`:229`). |
| 4 | A CORRIGER | Second Checkout sur un Free avec abonnement `incomplete` | **Corrige.** 409 (D-071 (3)), AC17 amende, test `review-corrections.test.ts:243`. Message et contrat a aligner : constat 2 ci-dessus. Double Checkout paye : backlog (INFO-3). |
| 5 | A CORRIGER | Journal de tranche perime, journal de projet absent | **Corrige en partie.** Etat a jour, entree 14 ecrite et indexee ; trois lignes encore perimees : constat 3 ci-dessus. |
| 6 | A CORRIGER | `INNGEST_EVENT_KEY` exigee sans decision ni test | **Corrige.** D-071, commentaire d'`env.ts`, runbook §5, test `review-corrections.test.ts:277`. |
| 7 | A CORRIGER | Table des migrations de l'ERD coupee | **Corrige** (366190d), ligne 0013 ajoutee. |
| 8 | SUGGESTION | Regle d'import AC16 contournable | **Corrige.** Regle etendue, un test par forme (`lint-isolation-forms.test.ts`), exception limitee a `./billing-db`. |
| 9 | SUGGESTION | SG004 compare des UUID en texte | **Corrige.** Comparaison en `uuid` (0013:159-163), UUID normalise a l'entree de l'API, test en majuscules de bout en bout. |
| 10 | SUGGESTION | Commentaire du verrou trop affirmatif | **Corrige.** En-tete de 0013 point 4 et ADR-0016 « Verrou » decrivent l'ordre reel. |

## Bilan
- **Solide :** les deux bloquants sont corriges sur decision humaine ecrite et prouves par des tests qui echoueraient sans la correction ; aucun test n'est affaibli ; l'isolement de `signet_billing` est nettement renforce et teste forme par forme ; la documentation (registre, contrat, ADR, ERD, journaux) suit chaque changement.
- **Fragile :** la garde monotone repose sur des horloges de processus et sur l'instant de reception, sans serialisation par abonnement et sans borne superieure (constats 1 et 4) ; deux branches de la garde n'ont pas de test direct.
- **Manquant :** la limite de la garde ecrite dans ADR-0016, le contrat et le message du 409 pour le cas `incomplete`, trois lignes du journal de tranche.

REVIEW: PASS
