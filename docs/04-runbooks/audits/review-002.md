# Relecture de code, tranche 002, troisieme serie (slice/002-abonnement-palier, 303ded1, base main)

## Methode
J'ai relu toute la tranche de facon independante, sur le diff `git diff main...HEAD` (34 commits, 70 fichiers). J'ai relu de plus pres les cinq commits de corrections posterieurs a la deuxieme serie, `git diff 32abc19..HEAD` (37ada6f a 303ded1, 14 fichiers). Documents de reference lus :
- `CLAUDE.md` et `.claude/rules/` (documentation, git, drizzle-postgres, nextjs) ;
- le contrat `002-abonnement-palier.md` (AC1 a AC18, amende D-071) et `002-decisions-humaines.md` ;
- le journal `002-progress.md` (dont la « Phase 5 ») et le registre D-057 a D-072, plus D-016 (precedent de correction en place) ;
- ADR-0015 et ADR-0016 (section « Garde monotone » et ses « Limites restantes »), les amendements d'ADR-0007 et d'ADR-0011 ;
- l'ERD (colonne `stripe_synced_at`, codes `SGxxx`, table des migrations) ;
- le runbook `stripe-facturation-locale.md` ;
- le journal de projet `14-tranche-002-abonnement-palier.md` et son index `JOURNAL.md` ;
- les rapports `audit-002.md`, `contracts-002.md` et la deuxieme version de `review-002.md`.

Code de production relu ligne a ligne : le corps complet de `apply_stripe_subscription` dans `0013_subscription_sync_guard.sql`, `lib/inngest/{process-stripe-event,client,billing-db}.ts`, la route webhook, `lib/billing/subscriptions.ts`, la route `subscription`, `errors.ts`, `instrumentation.ts`, et le contrat `api-contracts/subscriptions.ts`.

Tests relus : les trois tests directs ajoutes dans `tests/billing/review-corrections.test.ts:299-379`, et la fixture `createProOrganization` (`tests/helpers/billing.ts`, qui ne pose pas `stripe_synced_at`).

Je n'ai pas lance `pnpm test`, parce que d'autres relecteurs peuvent tourner sur la meme base de test. Je reprends le resultat transmis par l'orchestrateur : 277/277 en 24 fichiers, `pnpm run check` vert. J'ai verifie la logique des tests a la lecture, en me demandant pour chacun s'il echouerait sans la correction qu'il couvre. Je n'ai lu ni `.env*.local` ni l'environnement.

Ce que j'ai verifie sans y trouver de constat :
- **Limite de concurrence Inngest.** `process-stripe-event.ts:92` : `concurrency: { key: "event.data.subscriptionId", limit: 1 }`. La cle designe un champ qui existe et qui est obligatoire dans le schema de l'evenement (`client.ts:45`, `subscriptionId: z.string().min(1)`), rempli par le webhook (`webhooks/stripe/route.ts:86`). L'option est acceptee par le type d'`inngest` 4.23 (`pnpm run check` vert). Le raisonnement tient : les pas d'un meme abonnement sont serialises. Si deux executions s'entrecroisent (pas 1 de A, pas 1 de B, pas 2 de B, pas 2 de A), A porte une marque anterieure a celle de B et la garde le rend `stale`. Le seul ordre faux restant est celui des horloges de deux instances, et il est ecrit.
- **Garde monotone (0013, etape 3).** Elle est placee apres le verrou `FOR UPDATE` et avant les controles Q-7, avec une comparaison stricte (`<`). Le commentaire en place decrit maintenant le cas couvert et les limites, sans promettre plus. La borne haute (`v_read_at > now() + interval '5 minutes'`, SG003) vient apres la validation ISO et avant toute lecture de table. Elle compare a l'horloge de la base, et `now()` reste stable dans la transaction.
- **Correction en place de 0013.** 0013 n'est pas sur `main` (`git log main` ne la contient pas) et D-016 sert de precedent. La base de test est recreee a chaque `pnpm test`. Le journal (D-067, FRICTION) indique que `pnpm db:migrate` n'a jamais tourne sur le poste de developpement : aucune base persistante ne garde l'ancienne version de la fonction.
- **Tests directs de la garde : ils discriminent.**
  - *Egalite des marques* : la fixture laisse `stripe_synced_at` a NULL. Le premier appel l'ecrit a `readAt`, et le second, a marque egale, doit rendre `updated`. Un `<=` le rendrait `stale` : le test echouerait.
  - *`stale` avant SG006* : l'abonnement `sub_other` n'est pas rattache, donc l'organisation est resolue par la metadonnee. La ligne verrouillee porte un autre `stripe_subscription_id`. Si la garde passait apres Q-7, SG006 serait leve : le test echouerait.
  - *Borne haute* : hormis la marque, l'entree est identique a celles qui reussissent dans les deux autres tests. Le SG003 attendu ne peut donc venir que de la borne.
- **Contrat et message du 409.** `subscriptions.ts:77` couvre maintenant « pro demande sur un Free dont un abonnement Stripe est deja rattache et en cours de paiement ». Le message d'`errors.ts:65` le dit aussi, et le code `ALREADY_ON_TIER` n'a pas change. Le code (`lib/billing/subscriptions.ts:116`) refuse tout Free dont `stripe_subscription_id` n'est pas NULL. Par la correspondance Q-8, ce cas est seulement `incomplete` : contrat, message et code concordent, et AC17 du contrat est deja amende.
- **Regle D-065 n.2.** `git diff 32abc19..HEAD -- tests/` n'ajoute que 85 lignes a `review-corrections.test.ts` : aucun test existant n'est modifie (le journal dit pourquoi les tests directs ne vont pas dans `database.test.ts`).
- **Regles absolues.** Pas de `any`, pas de `// TODO`, pas de `eslint-disable` ni de `@ts-` dans le diff de code et de tests. Les refus restent des valeurs typees (`ApplyOutcome`, `Result`). L'evenement de file est valide par Zod avant usage. Le filtre tenant de `readAsOwner` et l'identifiant normalise a l'entree des routes n'ont pas change.
- **Suggestions 5 et 8 de la deuxieme serie.** La ligne `canceled_by` est au backlog (`000-backlog.md:70`), a cote de Q-4. Le commentaire d'`instrumentation.ts` cite `INNGEST_EVENT_KEY`. Le titre de section d'ADR-0016 indique « remplacee par 0013 ».
- **ADR-0016, « Limites restantes ».** La section decrit la marque comme un instant de reception, l'effet des horloges des instances, la borne de 5 minutes, et ce que la concurrence Inngest serialise ou non. Les options ecartees sont ecrites. D-072 au registre donne les options ecartees de la decision humaine (0014, cloture sans correction).
- **AC18 (verifie par relecture, inchange depuis la deuxieme serie).** Le runbook couvre le reglage A6 (§4), les trois valeurs Stripe du mode test (§3, etape 2), Inngest en local (§5) et `\password signet_billing`, lance par l'humain (§1, etape 2). AC18 est satisfait.
- **Commits.** Ils suivent Conventional Commits avec le trailer `Slice: 002`, et chaque corps donne maintenant le pourquoi (amelioration par rapport a la suggestion 7).

## Constats

### A CORRIGER

**1. Le journal de projet ne connait ni D-072 ni la troisieme relecture, et le journal de tranche ne nomme pas les commits de D-072**
- **Emplacement :** `docs/00-context/journal/14-tranche-002-abonnement-palier.md` (sections « Ce qui a ete fait », « Decisions », « Preuves », « Etat a la fin ») ; `docs/00-context/JOURNAL.md:22` (« D-057 a D-071 ») ; `docs/03-slices/002-progress.md:8`.
- **Constat :** l'entree 14 s'arrete a la « Seconde serie de relectures ». Elle ne cite pas D-072 (decision humaine : corriger les trois A CORRIGER, concurrence Inngest, borne haute, correction en place de 0013), ni la Phase 5, ni cette troisieme relecture. « Etat a la fin » dit la cloture « en attente des verdicts de la seconde serie », alors que cette serie a rendu trois PASS. « Preuves » parle de la suite « apres la phase 4 ». L'index `JOURNAL.md` borne les decisions a D-071. Dans `002-progress.md:8`, « Dernier commit » nomme encore 32abc19 et renvoie les corrections a « commitees ensuite », sans les identifier (37ada6f, 2e6d395, 7259b89, 6282cc4, 303ded1).
- **Consequence :** d'apres `documentation.md`, l'entree du journal de projet est ce que l'humain et un auditeur externe lisent en premier, et elle part dans la PR. En l'etat, elle decrit une tranche qui attend des verdicts deja rendus et omet une decision humaine qui a modifie en place une migration. `close-slice.sh` ne verifie que la presence de la tranche dans le journal : ce retard passerait sans signal. Ce constat reprend le n.3 de la deuxieme serie, deplace vers le journal de projet.
- **Direction :** completer l'entree 14 (Phase 5 et D-072, troisieme relecture, etat et preuves a jour), etendre l'index a D-072, et nommer les commits de D-072 dans `002-progress.md`. La correction est purement documentaire et ne demande pas de nouvelle relecture du code : un controle de ces trois fichiers suffit.

### SUGGESTION

**2. La limite de concurrence n'est gardee par aucun test**
- **Emplacement :** `apps/web/src/lib/inngest/process-stripe-event.ts:92`.
- **Constat :** si l'on retirait l'option `concurrency`, ou si l'on changeait sa cle en un champ absent de l'evenement (par exemple `event.data.subscriptionID`), la suite resterait verte : les doublures executent les pas en sequence. C'est pourtant la mesure retenue par D-072 (1) pour le cas concurrent, que la garde ne couvre pas seule, comme le dit ADR-0016.
- **Direction :** un test de configuration qui lit les options de `processStripeEvent`, verifie `limit: 1`, et verifie que la cle designe un champ de `stripeSubscriptionEventData`.

**3. Un evenement porte par une instance en avance est perdu, et la tolerance de 5 minutes n'est pas testee a la frontiere**
- **Emplacement :** `packages/db/migrations/0013_subscription_sync_guard.sql:146-149`, `process-stripe-event.ts:122-129`, ADR-0016 (puce « horloge de chaque instance »), `tests/billing/review-corrections.test.ts:364-378`.
- **Constat :**
  - SG003 est un refus definitif (`NonRetriableError`), donc l'etat relu par une instance en avance de plus de 5 minutes n'est jamais applique. L'etat de l'organisation ne se corrige qu'a l'evenement Stripe suivant. Si l'evenement perdu est un `deleted`, il n'y a pas d'evenement suivant : l'organisation reste Pro. L'ADR dit « leve SG003 », mais pas cette consequence.
  - Une alternative existe. Le pas « relire-abonnement » est memorise, donc la marque du rejeu ne change pas. Une erreur rejouable laisserait `now()` rattraper la marque au fil des relances Inngest, et l'etat serait applique avec au plus 5 minutes d'avance.
  - Le test verifie seulement une marque a +1 h. Une borne sans tolerance (`> now()`) le passerait aussi, alors qu'elle refuserait en production toute instance en avance de quelques millisecondes.
- **Direction :** ecrire la consequence dans ADR-0016, ou reclasser ce cas en erreur rejouable (decision a porter au registre). Ajouter un cas a +1 minute qui doit s'appliquer.

**4. La ligne 0013 de l'ERD ne mentionne pas la borne haute**
- **Emplacement :** `docs/02-architecture/ERD.md:978`.
- **Constat :** la table des migrations decrit 0013 sans la borne SG003 ajoutee en place par D-072. Le code SG003 « entree invalide » (ERD:51) la couvre en substance, mais un lecteur de l'ERD ne sait pas qu'une marque trop recente est refusee.
- **Direction :** une demi-ligne dans la description de 0013 (« marque de plus de 5 minutes dans le futur : SG003, D-072 »).

**5. Commits de corrections encore crees en lot, tests apres le code**
- **Emplacement :** 37ada6f a 303ded1, crees en quatre secondes.
- **Constat :** chaque commit compile ici, car les changements sont independants. Les corps de commit expliquent maintenant le pourquoi, ce qui ameliore la suggestion 7 precedente. Mais les tests (6282cc4) sont committes apres le code qu'ils couvrent, et l'ensemble a ete committe d'un coup en fin de travail, pas au fil de l'eau (`rules/git.md`). Le squash a la fusion limite l'effet sur `main`.
- **Direction :** rien a reecrire. Garder la pratique « test avant code, commit par couche verte » pour les prochaines corrections.

## Suivi des constats de la deuxieme serie

| # | Gravite (2e serie) | Constat | Etat |
|---|---|---|---|
| 1 | A CORRIGER | Limites de la garde non ecrites, commentaire SQL trop affirmatif, pas de concurrence par abonnement | **Corrige.** Concurrence `{ key: event.data.subscriptionId, limit: 1 }` (`process-stripe-event.ts:92`), limites ecrites dans ADR-0016, commentaire de 0013 corrige en place (D-072, precedent D-016). Sans test de configuration : constat 2. |
| 2 | A CORRIGER | Message et contrat du 409 ne couvrent pas l'abonnement `incomplete` | **Corrige.** Declencheur du contrat (`subscriptions.ts:77`) et message (`errors.ts:65`) amendes, code inchange. |
| 3 | A CORRIGER | Journal de tranche en partie perime | **Corrige en partie.** Couche Documentation et nombre de tests a jour (277). « Dernier commit » ne nomme pas les commits de D-072, et le journal de projet 14 n'a pas suivi : constat 1. |
| 4 | SUGGESTION | `stripe_read_at` sans borne haute | **Retenu.** SG003 au-dela de 5 minutes (0013:146-149), avec un test. Effet d'un refus definitif et frontiere non testee : constat 3. |
| 5 | SUGGESTION | `canceled_by` survit a une reactivation | **Retenu.** Ligne au backlog (`000-backlog.md:70`). |
| 6 | SUGGESTION | Garde testee seulement au travers d'Inngest | **Retenu.** Trois tests directs sous `signet_billing`, discriminants (voir Methode). |
| 7 | SUGGESTION | Commits en lot, corps vides | **En partie.** Corps renseignes ; commits toujours crees en lot, tests apres le code : constat 5. |
| 8 | SUGGESTION | Commentaires perimes (`instrumentation.ts`, titre de section d'ADR-0016) | **Corrige.** |

## Bilan
- **Solide :** le desordre des evenements est maintenant ferme a trois niveaux : la relecture fait foi, les pas d'un meme abonnement sont serialises, et la garde monotone est testee directement en base sur ses deux branches sensibles. Le contrat, le message et le code du 409 concordent. Aucun test n'est affaibli, et chaque decision de D-072 a sa trace au registre, dans ADR-0016 et dans le journal de tranche.
- **Fragile :** l'ordre depend encore des horloges des instances. Un etat refuse par la borne haute est perdu plutot que differe, et la limite de concurrence n'est gardee par aucun test.
- **Manquant :** le journal de projet (entree 14 et index) a jour de D-072 et de cette relecture, et les commits de D-072 nommes dans le journal de tranche.

REVIEW: FAIL
