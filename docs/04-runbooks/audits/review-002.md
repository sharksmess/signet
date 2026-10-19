# Relecture de code, tranche 002, quatrieme serie (slice/002-abonnement-palier, c1e8071, base main)

## Methode
J'ai relu toute la tranche de facon independante, sur le diff `git diff main...HEAD` (40 commits, 70 fichiers). J'ai relu de plus pres les commits posterieurs a la troisieme relecture, `git diff 25e9885..HEAD` (a594017, 9ac3db7, 4453f1f, c1e8071 ; 10 fichiers). Documents de reference lus :
- `CLAUDE.md` et `.claude/rules/` (documentation, git) ;
- le contrat `002-abonnement-palier.md` (AC1 a AC18, amende D-071) et `002-decisions-humaines.md` ;
- le journal `002-progress.md` (dont la « Phase 6 ») et le registre D-057 a D-076, plus D-016 (precedent de correction en place) et D-065 (regle n.2) ;
- ADR-0016 (section « Garde monotone », « Limites restantes », table des codes), ADR-0015, les amendements d'ADR-0007 et d'ADR-0011 ;
- l'ERD (§0 codes `SGxxx`, table des migrations) ;
- le runbook `stripe-facturation-locale.md` ;
- le journal de projet `14-tranche-002-abonnement-palier.md` et son index `JOURNAL.md` ;
- les rapports `audit-002.md`, `contracts-002.md` et la troisieme version de `review-002.md`.

Code de production relu ligne a ligne : le corps d'`apply_stripe_subscription` dans `0013_subscription_sync_guard.sql` (validation, borne haute, resolution de l'organisation, verrou, garde monotone, Q-7, Q-8, ecriture), `lib/inngest/{process-stripe-event,billing-db}.ts`, la route webhook, `lib/billing/subscriptions.ts`.

Controle externe : la declaration de type d'`inngest` 4.23.0 installee (`components/InngestFunction.d.ts:331-336`) documente l'option `retries` : « maximum number of retries for all steps across this function [...] Defaults to `3` ». `processStripeEvent` ne fixe ni `retries` ni `onFailure`.

Je n'ai pas lance `pnpm test` (base de test partagee avec les autres relecteurs). Je reprends le resultat transmis par l'orchestrateur : 280/280 en 24 fichiers, `pnpm run check` vert. J'ai verifie la logique des tests a la lecture, en me demandant pour chacun s'il echouerait sans la correction qu'il couvre. Je n'ai lu ni `.env*.local` ni l'environnement.

Ce que j'ai verifie sans y trouver de constat :
- **SG008 hors des refus definitifs.** `billing-db.ts:55-60` : `REJECTION_CODES` ne contient que SG003 a SG006. `rejectionCodeOf` ne reconnait que ces cles, donc SG008 sort du `catch` par `throw error` apres `ROLLBACK`. `process-stripe-event.ts:120` appelle `applyStripeSubscription` dans `step.run("appliquer-etat")` sans `try` : l'erreur remonte a Inngest, qui rejoue le pas ; le pas 1 (`relire-abonnement`) est memorise, donc la marque ne change pas entre les tentatives. Le mecanisme decrit par D-076 est bien celui du code.
- **Borne haute en base.** `0013:150-153` : `v_read_at > now() + interval '5 minutes'` leve `SG008`, apres la validation ISO et le cast, avant toute lecture de table. Aucune ecriture n'est possible avant (la fonction n'a encore rien ecrit, et le pas Node fait `ROLLBACK`).
- **Tests de la limite exacte : ils discriminent.** `review-corrections.test.ts:370-385` calcule la marque dans la meme transaction que l'appel (`asBillingCommitted` ouvre `BEGIN`, `tests/helpers/billing-db.ts:312`), donc avec le meme `now()` que la fonction. A +0 µs le test exige `updated` : un `>=` le ferait echouer. A +1 µs il exige `SG008` : une tolerance plus large (par exemple `> now() + 5 min + 1 s`) le ferait echouer, et un code SG003 aussi. L'absence d'ecriture est verifiee par comparaison de la ligne avant/apres.
- **Rejouabilite.** `review-corrections.test.ts:421-439` appelle le vrai `applyStripeSubscription` : si SG008 etait ajoute a `REJECTION_CODES`, la promesse serait resolue en `{ kind: "rejected" }` et le test echouerait.
- **Concurrence.** `review-corrections.test.ts:441-449` fige `{ key: "event.data.subscriptionId", limit: 1 }` et verifie que `subscriptionId` est un champ du schema de l'evenement. Retirer l'option ou changer la cle fait echouer le test (suggestion 2 de la troisieme serie).
- **Correction en place de 0013.** `git log main -- packages/db/migrations/0013_subscription_sync_guard.sql` est vide : la migration n'est pas sur `main`, D-016 s'applique, et D-076 l'ecrit.
- **Regle D-065 n.2.** Le seul test modifie est le test « borne haute » ajoute en D-072 dans cette meme tranche : il attendait SG003, la decision D-076 change le code attendu. Il est remplace par trois tests plus stricts (limite exacte, +1 µs, rejouabilite), aucun critere n'est affaibli.
- **Documentation de D-076.** ERD §0 (`ERD.md:56-57`) et table des migrations (`ERD.md:980`) citent SG008 ; ADR-0016 (ligne 69 et table, ligne 104) ; commentaire de `billing-db.ts:48-54` ; registre D-073 a D-076 ; journal de tranche (Phase 6) ; entree 14 du journal de projet (Phase 6, decisions, etat) ; index `JOURNAL.md` borne a D-076.
- **Regles absolues.** Pas de `any`, pas de `// TODO`, pas d'`eslint-disable` ni de `@ts-` ajoutes. Les refus restent des valeurs typees (`ApplyOutcome`, `Result`). L'evenement de file est valide par Zod avant usage. Le filtre tenant de `readAsOwner` et la normalisation de l'identifiant a l'entree des routes n'ont pas change.
- **AC18 (verifie par relecture, inchange).** Le runbook couvre le reglage A6 (§4), les trois valeurs Stripe du mode test (§3, etape 2), Inngest en local (§5) et `\password signet_billing` lance par l'humain (§1, etape 2). AC18 est satisfait.

## Constats

### A CORRIGER

**1. Avec SG008 rejouable, l'etat d'une instance en avance s'applique en retard et ecrase un etat plus recent ; la consequence symetrique de celle que D-076 corrige n'est ecrite nulle part**
- **Emplacement :** `packages/db/migrations/0013_subscription_sync_guard.sql:143-153` et `:205` ; `apps/web/src/lib/inngest/process-stripe-event.ts:92` ; ADR-0016 lignes 68-71 (puce « horloge de chaque instance ») et ligne 104 ; `docs/DECISIONS.md` D-076.
- **Constat :** scenario concret, chaque etape lue dans le code :
  1. Une instance A, dont l'horloge avance de `d` > 5 minutes, relit l'abonnement « actif » a l'instant reel T1. Marque M1 = T1 + d. Le pas 2 leve SG008 et attend sa relance (Inngest ne compte pas une execution en attente de relance dans la limite de concurrence, ADR-0016 ligne 72-74).
  2. L'owner annule ; Stripe emet `deleted`. Une instance B, a l'heure, relit `canceled` a T2 (T1 < T2 < T1 + d). Marque T2. Elle s'applique : Free, `stripe_subscription_id` a NULL, `stripe_synced_at` = T2, `subscription_canceled`.
  3. La relance de A passe des que `now()` de la base atteint M1 - 5 min. La garde (`0013:205`) compare M1 a T2 : M1 > T2, l'etat n'est pas `stale`. La ligne n'a plus d'abonnement rattache, l'organisation est resolue par la metadonnee, Q-7 passe (meme client, prix Pro), le statut `active` mene a Pro : l'organisation **redevient Pro**, avec un `subscription_started` dans `billing_event`, sur un abonnement supprime chez Stripe. Aucun evenement Stripe ulterieur ne viendra corriger.
- **Consequence :** D-076 a ete decide pour ne plus perdre un `deleted` relu par une instance en avance (« un `deleted` perdu laisserait l'organisation en Pro »). Le meme resultat, organisation en Pro sans paiement, survient maintenant dans l'ordre inverse, et l'option retenue ne le mentionne pas : l'humain a tranche sur une presentation qui ne montrait qu'un cote. Sous SG003 definitif, l'erreur d'ordre due a une horloge etait plafonnee a 5 minutes. Sous SG008 rejouable, elle n'est plus bornee que par la fenetre de relance d'Inngest (constat 2). La justification ecrite dans l'ADR (« sinon une instance en avance figerait l'organisation ») ne decrit plus ce que fait la borne : elle retarde l'etat en avance, elle ne l'empeche plus de gagner.
- **Direction :** remonter le compromis a l'humain avant la cloture, avec les deux scenarios cote a cote. Options a lui presenter :
  - (a) accepter et l'ecrire dans ADR-0016 (Limites restantes) et en complement de D-076 ;
  - (b) supprimer la cause : prendre la marque sur l'horloge de la base plutot que sur celle de l'instance, par exemple un `SELECT clock_timestamp()` sous `signet_billing` dans le pas 1, juste apres la reponse de Stripe. Il n'y aurait alors plus qu'une seule horloge, et la borne SG008 deviendrait inutile.
  - Quelle que soit l'option, ajouter un test qui rejoue ce scenario (etat en avance applique apres un `canceled` plus recent) et fige le comportement choisi.

**2. « L'etat relu n'est jamais perdu » est faux : la relance est bornee par le nombre de tentatives d'Inngest, et l'abandon n'est pas journalise**
- **Emplacement :** `0013_subscription_sync_guard.sql:143-149` (« l'etat relu (par exemple un `deleted`) n'est jamais perdu ») ; `apps/web/src/lib/inngest/billing-db.ts:51-53` (« Inngest rejoue le pas jusqu'a ce que l'horloge de la base rattrape la marque ») ; ADR-0016 ligne 104 ; D-076 (« jusqu'a ce que ») ; `process-stripe-event.ts:87-93` (ni `retries` ni `onFailure`).
- **Constat :** `processStripeEvent` ne fixe pas `retries`. D'apres la declaration du SDK installe (`inngest` 4.23.0, `InngestFunction.d.ts:334`), le defaut est de 3 relances par pas, avec un delai croissant fixe par Inngest. Si l'avance de l'horloge depasse 5 minutes plus cette fenetre, le pas echoue definitivement : l'etat est perdu, exactement comme avec l'ancien SG003. Mais, contrairement a SG003, l'abandon ne passe pas par `logRejection`. Il n'existe qu'un echec generique dans le tableau de bord d'Inngest, sans le message « traite sans effet » ni l'identifiant d'evenement au format du reste du journal de facturation. Le commentaire `process-stripe-event.ts:13-16`, qui enumere les cas, ne cite pas SG008. Aucun document ne donne la taille de la fenetre.
- **Consequence :** la documentation promet une garantie que le code ne donne pas. Un exploitant qui lit ADR-0016 ou 0013 conclura qu'aucun etat ne peut se perdre, et ne cherchera pas d'echec Inngest apres un decalage d'horloge. Le cas le plus grave (un `deleted` perdu, organisation en Pro) reste possible, simplement moins visible.
- **Direction :** remplacer « jamais perdu » et « jusqu'a ce que » par la borne reelle : relances du SDK par defaut ou valeur fixee explicitement (`retries`), avec la fenetre qu'elles couvrent. Journaliser l'abandon, par un `onFailure` ou en citant SG008 dans le message, et completer le commentaire d'en-tete de `process-stripe-event.ts`. L'option (b) du constat 1 rend ce constat sans objet.

### SUGGESTION

**3. Commits de la Phase 6 crees en lot, tests apres le code**
- **Emplacement :** a594017, 9ac3db7, 4453f1f, c1e8071 (horodates de 15:49:23 a 15:49:26).
- **Constat :** les quatre commits ont ete crees en quatre secondes, et le test (4453f1f) vient apres la correction qu'il couvre (a594017). Les messages sont conformes (Conventional Commits, corps avec le pourquoi, trailer `Slice: 002`). Meme remarque que la suggestion 5 de la troisieme serie : `rules/git.md` demande un commit au fil de l'eau, et le workflow de `CLAUDE.md` demande le test avant le code.
- **Direction :** rien a reecrire, le squash a la fusion limite l'effet. Pour la correction des constats 1 et 2 : ecrire le test du scenario d'abord, puis committer par couche.

**4. Petits retards de journaux sur D-076**
- **Emplacement :** `docs/03-slices/002-progress.md:8` ; `docs/00-context/JOURNAL.md:22` ; `docs/DECISIONS.md` D-076.
- **Constat :**
  - « Dernier commit » nomme les commits de D-072, mais pas ceux de D-076 (a594017, 9ac3db7, 4453f1f, c1e8071).
  - Le resume de l'index du journal de projet dit « corrections apres deux series de relectures (D-071, D-072) », sans D-076, alors que la colonne des decisions va jusqu'a D-076.
  - D-076 ne nomme pas le test remplace (`review-corrections.test.ts`, test « borne haute » qui attendait SG003). La regle D-065 n.2 demande que tout test modifie soit justifie au registre. Ici la justification se deduit de la decision, mais elle n'est pas ecrite.
- **Direction :** trois retouches d'une ligne, a faire avec la correction des constats 1 et 2.

## Suivi des constats de la troisieme serie

| # | Gravite (3e serie) | Constat | Etat |
|---|---|---|---|
| 1 | A CORRIGER | Journal de projet sans D-072 ni troisieme relecture ; commits de D-072 non nommes | **Corrige** (25e9885, puis c1e8071) : entree 14 a jour jusqu'a la Phase 6, index borne a D-076, commits de D-072 nommes dans `002-progress.md:8`. Petit retard sur D-076 : constat 4. |
| 2 | SUGGESTION | Limite de concurrence gardee par aucun test | **Corrige.** `review-corrections.test.ts:441-449`, discriminant (voir Methode). |
| 3 | SUGGESTION | Refus SG003 definitif : etat perdu ; tolerance de 5 minutes non testee a la frontiere | **Retenu par D-076, en partie juste.** Frontiere testee a la microseconde. SG008 rejouable. Mais la relance est bornee et l'abandon n'est pas journalise (constat 2), et l'etat en avance peut ecraser un etat plus recent (constat 1). |
| 4 | SUGGESTION | ERD : la ligne 0013 ne mentionne pas la borne | **Corrige.** `ERD.md:980` et code SG008 en §0 (`ERD.md:56-57`). |
| 5 | SUGGESTION | Commits en lot, tests apres le code | **Non suivi** pour la Phase 6 : constat 3. |

## Bilan
- **Solide :** le mecanisme SG008 est exactement celui qui est decrit (hors `REJECTION_CODES`, pas memorise, aucune ecriture). La frontiere des 5 minutes est testee a la microseconde, sur le meme `now()` que la fonction, et la limite de concurrence est figee par un test. La documentation (ERD, ADR, registre, journaux) suit la decision, et aucun test n'est affaibli.
- **Fragile :** l'ordre des etats depend encore de l'horloge de chaque instance. Avec SG008, un etat relu par une instance en avance peut ecraser, en retard, un `canceled` plus recent, et l'organisation redevient Pro sans paiement. La relance qui doit « rattraper » l'horloge est bornee par le defaut d'Inngest, et son abandon n'est pas journalise.
- **Manquant :** le compromis de D-076 presente a l'humain avec ses deux cotes (ou une marque prise sur l'horloge de la base), la borne reelle des relances ecrite dans 0013, ADR-0016 et `billing-db.ts`, et un test du scenario d'ecrasement.

REVIEW: FAIL
