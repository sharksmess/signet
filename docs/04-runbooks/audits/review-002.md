# Relecture de code, tranche 002, cinquieme serie (slice/002-abonnement-palier, 77c6463, base main)

## Methode
J'ai relu toute la tranche de facon independante, sur le diff `git diff main...HEAD` (45 commits, 70 fichiers). J'ai relu de plus pres les commits posterieurs a la quatrieme relecture, `git diff 49208ce..HEAD` (0aa5287, 3db0d2d, f43bc1b, 77c6463 ; 10 fichiers). Documents de reference lus :
- `CLAUDE.md` et `.claude/rules/` (documentation, git, drizzle-postgres, nextjs) ;
- le contrat `002-abonnement-palier.md` (AC1 a AC18, amende D-071) et `002-decisions-humaines.md` ;
- le journal `002-progress.md` (dont la « Phase 7 ») et le registre D-057 a D-077, plus D-016 (precedent de correction en place) et D-065 (regle n.2) ;
- ADR-0016 (« Garde monotone », « Limites restantes », table des codes, nouvelle section « Evenement abandonne »), ADR-0015, les amendements d'ADR-0007 et d'ADR-0011 ;
- l'ERD (§0 codes `SGxxx`, table des migrations) ;
- le runbook `stripe-facturation-locale.md` ;
- le journal de projet `14-tranche-002-abonnement-palier.md` et son index `JOURNAL.md` ;
- les rapports `audit-002.md`, `contracts-002.md` et la quatrieme version de `review-002.md`.

Code de production relu ligne a ligne : le corps complet d'`apply_stripe_subscription` dans `0013_subscription_sync_guard.sql` (validation, resolution de l'organisation, verrou, garde monotone, Q-7, Q-8, ecriture, journal), `lib/inngest/{process-stripe-event,billing-db}.ts`. Les autres fichiers de production (route webhook, `lib/billing/subscriptions.ts`, `env.ts`, `client.ts`) n'ont pas change depuis la quatrieme relecture ; je les ai relus en diagonale pour verifier qu'aucune hypothese ne dependait de la borne retiree.

Controle externe : declarations de type d'`inngest` 4.23.0 installe. `types.d.ts:94-121` : `FailureEventPayload.data` porte `run_id: string` et `event: P` (l'evenement d'origine), `FailureEventArgs.error: Error`. Le chemin `event.data.event` / `event.data.run_id` de `onFailure` est donc type, et `pnpm typecheck` le verifie. `components/InngestFunction.d.ts:331-336` : `retries` par defaut a 3, ce que la section « Evenement abandonne » d'ADR-0016 ecrit.

Je n'ai pas lance `pnpm test` (base de test partagee avec les autres relecteurs). Je reprends le resultat transmis par l'orchestrateur : 280/280 en 24 fichiers, `pnpm run check` vert. J'ai verifie la logique des tests a la lecture, en me demandant pour chacun s'il echouerait sans la correction qu'il couvre. Je n'ai lu ni `.env*.local` ni l'environnement.

Ce que j'ai verifie sans y trouver de constat :
- **Marque sur l'horloge de la base.** `billing-db.ts:35-42` : `databaseNow()` lit `clock_timestamp()` (et non `now()`, fige par transaction) sous `signet_billing`, hors transaction, sans table lue ; format `YYYY-MM-DD"T"HH24:MI:SS.US"Z"` en UTC, accepte par `c_iso_pattern` (`0013:41`, fraction `\.\d+`) et sans perte de precision face a `stripe_synced_at` (`timestamptz`, microseconde). `process-stripe-event.ts:129` l'appelle apres `subscriptions.retrieve`, dans le pas memorise `relire-abonnement` : la marque est figee avec l'etat relu et ne change pas aux rejeux du pas 2. Une panne de base pendant `databaseNow()` fait echouer le pas 1, rejoue en relisant Stripe (le `catch` ne transforme que `resource_missing`). Le `throw` de `databaseNow` sur resultat vide est un invariant, conforme a la regle des erreurs.
- **Le scenario de la quatrieme relecture (constat 1) est ferme.** Une seule horloge ordonne toutes les marques : un etat « actif » relu avant un `canceled` porte une marque anterieure, son rejeu est `stale` (`0013:194`), quelle que soit l'horloge de l'instance. Avec la limite de concurrence `limit: 1` par abonnement (`process-stripe-event.ts:113`), les pas de relecture d'un meme abonnement ne se chevauchent pas, donc l'ordre des marques suit l'ordre des relectures.
- **Borne et SG008 retires partout.** `0013` ne contient plus ni `interval '5 minutes'` ni `SG008` ; `REJECTION_CODES` et son commentaire (`billing-db.ts:64-74`), ERD §0 et table des migrations (`ERD.md:978`), table des codes d'ADR-0016 sont alignes. Les seules mentions restantes sont historiques (ADR-0016 lignes 71-74, journaux, registre D-076 marquee « Remplacee par D-077 »).
- **Correction en place de 0013.** `git log main -- packages/db/migrations/0013_subscription_sync_guard.sql` est vide : la migration n'est pas sur `main`, D-016 s'applique, et D-077 l'ecrit.
- **Test du serveur en avance : il discrimine.** `review-corrections.test.ts:381-430` avance `Date` d'une heure (`vi.useFakeTimers({ toFake: ["Date"] })`) pendant le premier passage, fait echouer le pas 2 (`REVOKE EXECUTE`), traite `deleted` a l'heure, puis rejoue le pas 1 memorise. Avec l'ancien `new Date()`, la marque serait T+1h, superieure a celle du `deleted`, l'etat « actif » s'appliquerait et les assertions `tier: "free"`, `stripe_subscription_id: null` et `["subscription_canceled"]` echoueraient. L'assertion intermediaire (marque < `Date.now()` + 60 s, en temps reel) prouve en plus que la marque memorisee vient de la base. Le `REVOKE` est sans danger pour les autres fichiers : `vitest.config.ts:19` fixe `fileParallelism: false`.
- **Test d'absence de borne.** `review-corrections.test.ts:365-377` : une marque a +1 h doit donner `updated` ; la borne de D-076 la ferait echouer en `SG008`.
- **Regle D-065 n.2.** Les trois tests de D-076 supprimes sont nommes dans D-077 (titres abreges mais identifiables sans ambiguite) avec la raison : la regle qu'ils verifiaient n'existe plus. Aucun autre test n'est modifie. Le compte reste a 280 (trois retires, trois ajoutes), coherent avec `002-progress.md:20`.
- **`onFailure` et journal d'abandon.** `process-stripe-event.ts:93-108` : niveau erreur, identifiant Stripe, abonnement, execution, nom de l'erreur ; donnees d'origine revalidees par Zod avant usage (`safeParse`), repli « inconnu » si elles sont mal formees ; ni corps d'evenement ni message d'erreur de base ou de Stripe (AC9 a). La section « Evenement abandonne » d'ADR-0016 (lignes 113-122) donne la borne reelle (3 relances par pas, defaut du SDK, non modifie) et la reprise. La promesse « jamais perdu » de la quatrieme relecture (constat 2) a disparu des commentaires et de l'ADR.
- **Documentation de D-077.** Registre (D-077, D-076 remplacee, options ecartees, tests nommes), ADR-0016 (en-tete D-072/D-076/D-077, limites, section abandon), ERD, journal de tranche (Phase 7, etat, commits de D-076 nommes), entree 14 du journal de projet (quatrieme relecture, Phase 7, etat), index `JOURNAL.md` borne a D-077.
- **Regles absolues.** Pas de `any`, pas de `// TODO`, pas d'`eslint-disable` ni de `@ts-` ajoutes. Les refus restent des valeurs typees (`ApplyOutcome`). `billing-db` reste importe par le seul module de la fonction (lint AC16 inchange). Le filtre tenant de la fonction definer (contexte pose avant la lecture verrouillee, `0013:180-186`) et la normalisation des identifiants a l'entree des routes n'ont pas change.
- **AC18 (verifie par relecture, inchange).** Le runbook couvre le reglage A6 (§4), les trois valeurs Stripe du mode test (§3, etape 2), Inngest en local (§5) et `\password signet_billing` lance par l'humain (§1, etape 2). Il ne mentionnait pas SG008 : rien a retirer. AC18 est satisfait.
- **Historique.** Quatre commits par couche (db, billing, test, docs), Conventional Commits, corps avec le pourquoi, trailer `Slice: 002`.

## Constats

### BLOQUANT
Aucun.

### A CORRIGER
Aucun.

### SUGGESTION

**1. Un refus definitif produit maintenant aussi une ligne d'erreur « a reprendre a la main », ce qui brouille la gradation voulue par D-071**
- **Emplacement :** `apps/web/src/lib/inngest/process-stripe-event.ts:93-100` et `:106-108` ; ADR-0016 lignes 119-122.
- **Constat :** Inngest appelle `onFailure` pour toute fin en echec, y compris apres un `NonRetriableError` (SG003 a SG006, abonnement introuvable, evenement de file mal forme). ADR-0016 l'ecrit (« deux lignes »). Mais la ligne d'abandon est au niveau erreur et dit « etat non applique, a reprendre a la main », alors que `billing-db.ts:65-67` dit d'un refus definitif que « rejouer l'evenement donnerait le meme refus », et que D-071 a reserve le niveau erreur a SG004.
- **Consequence :** une alerte branchee sur le niveau erreur se declenche pour chaque refus attendu (SG003, SG005, abonnement introuvable), avec une consigne de reprise qui, suivie, reproduirait le meme refus. Aucune donnee n'est faussee, c'est un cout d'exploitation : le vrai abandon (panne prolongee) se noie dans les refus ordinaires. Le comportement est documente, donc ce n'est pas une divergence.
- **Direction :** dans `reportAbandonedEvent`, distinguer `error.name === "NonRetriableError"` (refus deja journalise par `logRejection` : pas de seconde ligne, ou une ligne `info` sans consigne de reprise) de l'epuisement des relances (ligne d'erreur actuelle). Verifier d'abord que le nom survit a la serialisation d'Inngest. Mettre ADR-0016 a jour en consequence.

**2. Le cablage de `onFailure` n'est garde que par le typage**
- **Emplacement :** `tests/billing/review-corrections.test.ts:433-459`.
- **Constat :** le test verifie que `opts.onFailure` est une fonction et appelle `reportAbandonedEvent` directement. Il n'appelle pas le crochet lui-meme. Si `onFailure` passait `event.data` au lieu de `event.data.event`, la ligne afficherait « inconnu (donnees mal formees) » et le test passerait. Aujourd'hui ce cas est rattrape par `pnpm typecheck` (le chemin est type, voir Methode), d'ou la simple suggestion.
- **Direction :** appeler `processStripeEvent.opts.onFailure` avec une charge `inngest/function.failed` construite a la main (`data: { event, run_id, function_id, error }`) et verifier que la ligne contient les identifiants de l'evenement d'origine.

**3. La limite residuelle de l'horloge de la base n'est pas ecrite**
- **Emplacement :** ADR-0016 lignes 64-77 (« Limites restantes ») ; ADR-0016 ligne 63 (« milliseconde »).
- **Constat :** la garde suppose maintenant que l'horloge de la base est monotone. Un recul de cette horloge (correction NTP en saut, bascule vers une instance dont l'horloge retarde) ferait juger `stale` les etats relus pendant la duree du recul. L'organisation resterait dans l'etat precedent jusqu'au prochain evenement Stripe de l'abonnement. Le risque est faible et bien moindre que celui des horloges d'instance, mais c'est la limite qui remplace celle que D-077 a retiree, et l'ADR ne la nomme pas. Detail : la ligne 63 parle encore de precision a la milliseconde, la marque est desormais a la microseconde.
- **Direction :** une puce dans « Limites restantes » (recul de l'horloge de la base : etats juges `stale` pendant le recul, signal = lignes `stale` dans le journal), et « microseconde » ligne 63.

**4. Deux formulations perimees dans l'entree 14 du journal de projet**
- **Emplacement :** `docs/00-context/journal/14-tranche-002-abonnement-palier.md:24` et `:42`.
- **Constat :** la ligne des decisions parle encore des « corrections des deux series de relectures » alors qu'elle cite D-076 et D-077, issues des troisieme et quatrieme relectures. L'« Etape suivante » commence par « Decision humaine », deja prise (D-077).
- **Direction :** deux retouches d'une ligne, a la mise a jour du journal apres cette relecture.

**5. Commits de la Phase 7 encore crees en lot, tests apres le code**
- **Emplacement :** 0aa5287, 3db0d2d, f43bc1b, 77c6463 (horodates de 16:00:33 a 16:00:36).
- **Constat :** meme remarque que la suggestion 3 de la quatrieme serie : quatre commits en trois secondes, le test (f43bc1b) apres les corrections qu'il couvre. Le decoupage par couche et les messages sont conformes. Le test discrimine bien l'ancien comportement (voir Methode), donc l'ordre n'a pas masque d'erreur ici.
- **Direction :** rien a reecrire, le squash a la fusion limite l'effet. Pour les tranches suivantes : test d'abord, commit au fil de l'eau (`rules/git.md`, workflow de `CLAUDE.md`).

## Suivi des constats de la quatrieme serie

| # | Gravite (4e serie) | Constat | Etat |
|---|---|---|---|
| 1 | A CORRIGER | SG008 rejouable : l'etat d'une instance en avance ecrase un `canceled` plus recent | **Corrige** par l'option (b), retenue par l'humain (D-077) : marque lue sur l'horloge de la base (`billing-db.ts:35-42`, `process-stripe-event.ts:129`), borne et SG008 retires de 0013. Scenario rejoue par un test qui echouerait avec l'ancienne marque (`review-corrections.test.ts:381-430`). Limite residuelle (recul de l'horloge de la base) a ecrire : suggestion 3. |
| 2 | A CORRIGER | « Jamais perdu » faux ; abandon d'Inngest non journalise | **Corrige.** SG008 n'existe plus. La promesse a disparu. La borne reelle est ecrite (ADR-0016 « Evenement abandonne », 3 relances par pas). `onFailure` journalise l'abandon en erreur, sans corps ni message. Gradation des niveaux a affiner : suggestion 1 ; cablage teste par le typage seul : suggestion 2. |
| 3 | SUGGESTION | Commits de la Phase 6 en lot, tests apres le code | **Non suivi** pour la Phase 7 : suggestion 5. |
| 4 | SUGGESTION | Petits retards de journaux sur D-076 | **Corrige.** Commits de D-076 nommes (`002-progress.md:8`), index du journal de projet a jour (D-077), tests remplaces nommes au registre (D-077). Deux formulations restantes dans l'entree 14 : suggestion 4. |

## Bilan
- **Solide :** une seule horloge (celle de la base) ordonne desormais toutes les marques, ce qui supprime a la racine le scenario de reprise en Pro et rend la borne inutile. La correction est minimale (un `SELECT clock_timestamp()` dans le pas memorise) et couverte par un test de bout en bout qui echouerait avec l'ancienne marque. L'abandon d'Inngest est journalise sans fuite, et la documentation (registre, ADR, ERD, journaux) suit D-077, avec les tests supprimes nommes.
- **Fragile :** la ligne d'abandon au niveau erreur double chaque refus definitif, avec une consigne de reprise inadaptee. Le cablage de `onFailure` n'est garde que par le typage.
- **Manquant :** la limite residuelle de l'horloge de la base dans ADR-0016, et deux retouches de l'entree 14 du journal de projet. Rien qui engage l'exactitude ni la suite.

REVIEW: PASS

---

# Sixieme relecture (D-079, reouverture apres CI Build rouge, 0c6d9de..8e8e1a5)

## Methode
J'ai relu `git diff 0c6d9de..HEAD`, soit 4 commits : 09334e8 (reouverture, D-079), fa84dab (test rouge), a1cfa0b (correction), 8e8e1a5 (journaux). J'ai relu aussi les modules qui entourent la correction : `lib/env.ts`, `lib/stripe.ts`, `lib/auth.ts`, `lib/db.ts`, `instrumentation.ts`, et les tests d'AC15 dans `tests/billing/environment.test.ts:197-256`. Documents lus : D-079 dans le registre, ADR-0016, `002-progress.md` (Phase 8), FRICTION et l'entree 14 du journal de projet.

J'ai lance `pnpm run check` moi-meme : typecheck et lint sont verts. Je n'ai pas relance `pnpm test`, parce que la base de test est partagee avec les relectures paralleles. Je reprends le resultat de l'implementeur (283/283) et je n'ai pas rejoue l'etape Build. J'ai verifie le rouge de fa84dab par lecture : dans `client.ts`, a 0c6d9de, la ligne 20 est `const env = getServerEnv();`, et c'est le seul appel de premier niveau a un accesseur liste. Dans `process-stripe-event.ts`, `inngest.createFunction` n'etait pas un accesseur liste a cette date. Le message du commit et le journal disent bien la meme chose.

## Verification des points demandes
1. **Exactitude.** Le comportement a l'execution est inchange :
   - Le client, la fonction et le gestionnaire sont memoises par `??=`. Les trois ont la meme forme que `getStripe()`.
   - `serve()` recoit le meme client que `createFunction`, puisque les deux passent par `getInngest()`.
   - AC15 : `stubProductionServe()` appelle `vi.resetModules()` avant le `import()` dynamique de la route. Le gestionnaire memoise vient donc d'un module neuf a chaque test, construit avec l'environnement de production simule, et le test recoit toujours 401.
   - AC13 : le refus de demarrer reste dans `instrumentation.ts`, qui n'est pas touche. `startup.test.ts` n'est pas modifie.
   - Si l'environnement est invalide, la construction leve. Rien n'est memoise dans ce cas, donc l'appel suivant reessaie. Cela ne peut pas arriver une fois le serveur demarre.
   - Le typage passe par `ReturnType<typeof create...>`, sans `any`.
2. **Le test `build-env.test.ts` discrimine reellement.** Le detecteur a lui-meme un test positif et un test negatif (`:85-95`). Un garde-fou (`:97-102`) empeche qu'un renommage d'accesseur desarme le test. Le parcours AST exclut correctement le corps des fonctions, des fleches et des methodes, mais garde les initialiseurs `static` et les blocs `static`, qui s'executent eux aussi au chargement. Ses angles morts ne sont ecrits nulle part : voir le constat 1.
3. **Autres modules.** Aucun appel de premier niveau a `getServerEnv`, `parseServerEnv`, `billingDatabaseUrl`, `getStripe`, `getInngest` ni `getProcessStripeEvent` dans `apps/web/src`. Seul `lib/auth.ts:34-40` lit l'environnement au chargement, directement dans `process.env` : `getAuthPool()`, `requiredEnv("BETTER_AUTH_SECRET")` et `buildRateLimitOptions(process.env)`. Ces trois variables sont posees par l'etape Build, donc ce n'est pas le defaut de D-079. C'est en revanche la meme classe de risque, et le test ne la couvre pas (constat 1).
4. **Documentation.** D-079 donne la cause, les options ecartees A et C ainsi que la suppression de l'etape Build, et le decideur humain. ADR-0016 (`:170-173`), l'en-tete de `env.ts`, la Phase 8 du journal (avec l'option ecartee « le SDK lit `INNGEST_DEV` »), FRICTION et l'entree 14 sont a jour. Aucune dependance nouvelle : `typescript` etait deja dans le `package.json` racine. Les commits suivent Conventional Commits, le test est committe avant la correction, et chaque couche a son commit.

## Constats

### A CORRIGER
1. **Les angles morts du test statique ne sont pas ecrits.**
   - **Emplacement :** `tests/billing/build-env.test.ts:1-19` et `:29-36`.
   - **Constat :** l'en-tete dit que le test « refuse tout appel » a un accesseur, sans en donner les limites. Le detecteur ne voit pas :
     - un accesseur absent de `ENV_ACCESSORS`, par exemple un futur `getResend()` ;
     - un appel indirect, c'est-a-dire une fonction locale qui appelle `getServerEnv()` et qui est elle-meme appelee au premier niveau ;
     - une fonction immediatement appelee, `(() => getServerEnv())()` ;
     - `getServerEnv.call(...)` ;
     - une lecture directe de `process.env` au chargement, comme dans `lib/auth.ts:34-40`.
   - **Consequence :** un lecteur ou un auditeur peut croire que le test garantit l'invariant de D-079. En realite, le vrai filet reste l'etape Build de la CI, et celle-ci ne tourne qu'apres le push. La tranche 003, en ajoutant un client paresseux sans l'inscrire dans la liste, peut repasser au vert en local et casser le Build comme dans la PR #26.
   - **Direction :** lister ces limites dans l'en-tete du test, avec la regle « tout nouvel accesseur d'environnement s'ajoute a `ENV_ACCESSORS` ». Si possible, mentionner aussi cette regle dans l'en-tete de `env.ts`. La couverture de fond est deja prevue dans la ligne FRICTION : rejouer l'etape Build dans `close-slice.sh`, usine 1.6.

### SUGGESTION
2. **Noms obsoletes apres le renommage.**
   - **Emplacement :** `docs/03-slices/002-progress.md:80`, qui dit « export nomme `processStripeEvent` », et `docs/03-slices/000-backlog.md:75`, qui dit « appeler `processStripeEvent.opts.onFailure` ».
   - **Constat :** depuis a1cfa0b, l'export s'appelle `getProcessStripeEvent()`.
   - **Consequence :** celui qui reprendra cette entree du backlog cherchera un symbole qui n'existe plus.
   - **Direction :** dans le backlog, remplacer par `getProcessStripeEvent().opts.onFailure`. Dans le journal, ajouter une note « renomme par D-079 » plutot que reecrire l'historique.
3. **Minuterie laissee en place sur un chemin qui ne devrait pas arriver.**
   - **Emplacement :** `apps/web/src/app/api/webhooks/stripe/route.ts:43-46`.
   - **Constat :** `getInngest()` est desormais appele apres `setTimeout`. S'il levait (environnement invalide), la minuterie ne serait jamais annulee.
   - **Consequence :** aucune en pratique, parce que la route lit deja `getServerEnv()` plus tot pour le secret du webhook et que `instrumentation.ts` refuse de demarrer.
   - **Direction :** appeler `getInngest()` avant de creer la minuterie, si la route est retouchee.

## Bilan
- **Solide :** la correction est minimale, sur le modele deja eprouve de `getStripe()`. Le comportement a l'execution est inchange (AC13, AC14, AC15) et le rouge avant la correction est verifiable. Le registre explique la cause, ecrit les options ecartees et nomme le decideur humain.
- **Fragile :** l'invariant « pas de lecture de l'environnement au chargement » repose sur une liste d'accesseurs tenue a la main. Ses angles morts ne sont pas ecrits.
- **Manquant :** l'ecriture de ces limites, et deux noms obsoletes dans le journal et le backlog. Rien qui engage l'exactitude.

REVIEW: PASS
