# ADR-0015 — Dependances de la facturation (`stripe`, `inngest`, `@inngest/test`) et doublures de test

- **Statut** : propose (2026-10-15, claude-code) — l'ajout des dependances et les doublures sont acceptes par le contrat de tranche (D-057, D-059) ; cette ADR consigne les versions retenues, a valider par l'humain a la revue de la PR de la tranche 002.
- **Date** : 2026-10-15
- **Phase** : 3 — tranche 002 (abonnement et changement de palier)
- **Decisions du registre** : D-057, D-059, D-063, D-067

## Contexte

La tranche 002 est la premiere a parler a Stripe et a traiter un evenement de facon asynchrone
(ADR-0005 : l'etat ne change qu'au traitement de l'evenement Stripe ; ADR-0006 : file Inngest).
`stack.json` fige `billing: stripe` et `queue: inngest` depuis le 2026-09-22 ; ces paquets n'etaient
pas encore installes. Les tests ne doivent faire aucun appel reseau reel ni utiliser aucune vraie
cle, en local comme en CI (D-059).

## Options envisagees

### Appels a Stripe
- **SDK officiel `stripe`** : retenu. Verification de signature des webhooks, types de l'API,
  relances et delai configurables.
- Appels HTTP ecrits a la main (`fetch`) : ecarte. Reecrire la verification de signature et
  l'encodage de formulaire a crochets de l'API, sans les types, pour economiser une dependance
  deja figee par `stack.json`.

### File d'attente
- **SDK `inngest`** (`stack.json`, ADR-0006) : retenu. Pas d'alternative ouverte : changer de file
  exigerait de rouvrir ADR-0006.

### Execution de la fonction en test
- **`@inngest/test`** (`InngestTestEngine`, paquet officiel, devDependency) : retenu. Execute la
  fonction dans le processus de test, contre la base reelle, avec memorisation des pas : le rejeu
  d'un pas apres echec (AC8 e, D-061) se prouve sans service.
- Serveur de developpement Inngest (`inngest-cli`) : ecarte. Binaire telecharge a l'execution
  (reseau, Smart App Control, D-049), service de plus en CI.
- Execution synchrone dans la route quand `APP_ENV=test` : ecarte. Testerait un chemin qui
  n'existe pas en production.
- Ne rien ajouter (appeler la fonction a la main) : ecarte. Il faudrait reimplementer la
  memorisation des pas, c'est-a-dire tester une imitation d'Inngest.

### Doublures (D-059)
- **Signature des webhooks** : calculee par les tests avec `node:crypto` (HMAC-SHA256 de
  `t.corps`, schema documente de Stripe), secret de test invente. Ecarte :
  `generateTestHeaderString` du SDK (le SDK se verifierait lui-meme).
- **Faux Stripe** (`tests/billing/fakes/fake-stripe.ts`, `node:http`, port fixe) raccorde au
  serveur de test par `STRIPE_API_BASE_URL` (options `host`, `port`, `protocol` du SDK), acceptee
  seulement avec `APP_ENV=test` (`apps/web/src/lib/env.ts`). Ecartes : msw et nock (ne voient pas
  le serveur, processus separe), `stripe-mock` (reponses statiques, binaire ou Docker).
- **Faux point d'evenements Inngest** (`tests/billing/fakes/fake-inngest.ts`) vise par
  `INNGEST_DEV`, accepte seulement avec `APP_ENV=test` ou `development`.

## Decision

| Paquet | Ou | Version epinglee | Publication | Licence | Remarque |
|---|---|---|---|---|---|
| `stripe` | `apps/web` (dependencies) | **23.0.0** | 2026-10-01 | MIT | `latest` du registre au 2026-10-15 |
| `inngest` | `apps/web` (dependencies) | **4.23.0** | 2026-10-09 | Apache-2.0 | `latest` = 4.24.0 (publiee le 2026-10-14 13:54Z), encore en quarantaine pnpm au moment de `pnpm add` (2026-10-15 13:51Z) : pnpm a retenu la derniere version hors quarantaine. Aucune exclusion `minimumReleaseAgeExclude`. Montee en 4.24.x par Dependabot |
| `@inngest/test` | racine (devDependencies) | **1.0.0** | 2026-03-25 | Apache-2.0 | pair `inngest ^4.0.0` |

Les trois sont actifs (publications de moins de 12 mois, mainteneurs : Stripe, Inngest).

Reglages du SDK Stripe (`apps/web/src/lib/stripe.ts`, D-067) : delai **10 s** par appel, **une**
relance (`maxNetworkRetries: 1`). Le delai par defaut (80 s) depasse ce qu'une requete owner peut
attendre ; au pire environ 20 s avant `502 STRIPE_UNAVAILABLE` (AC10).

Reglages du client Inngest (`apps/web/src/lib/inngest/client.ts`) : `fetch` borne a 2 s par
tentative ; le SDK refait jusqu'a 5 tentatives a l'envoi d'un evenement, et le webhook abandonne a
5 s (`503`, AC14, D-065 regle 3).

### Script d'installation
`protobufjs` 7.6.6 (tire par `inngest` -> OpenTelemetry -> gRPC) declare un `postinstall`. Il ne sert
que l'outillage en ligne de commande de protobufjs : refuse explicitement (`allowBuilds:
protobufjs: false` dans `pnpm-workspace.yaml`), comme `unrs-resolver` (ADR-0009).

## Preuves

| Commande | Resultat (2026-10-15) |
|---|---|
| `pnpm --filter @signet/web add stripe inngest` puis epinglage exact | `stripe` 23.0.0, `inngest` 4.23.0 |
| `pnpm add -D -w @inngest/test` | 1.0.0 |
| `pnpm i` | lockfile conforme aux controles de chaine d'approvisionnement |
| `pnpm audit --prod --audit-level=high` | aucune vulnerabilite connue |

## Consequences acceptees

- `inngest` tire `zod` 3 alors que le projet est en `zod` 4 : deux copies coexistent, chacune
  utilisee par son proprietaire ; aucun schema n'est echange entre elles.
- `inngest` tire un jeu de paquets OpenTelemetry (dont gRPC) : poids d'installation, surface
  d'audit plus large. Surveille par `pnpm audit` a chaque cloture et par Dependabot.
- Les faux sont du code du depot : ils doivent suivre le format de l'API Stripe que le SDK
  consomme (fin de periode lue sur l'article d'abonnement, version d'API du SDK 23).

## Signal de reexamen

- Une montee majeure de `stripe` change la version d'API par defaut : relire la projection de
  l'abonnement (`process-stripe-event.ts`) et le faux Stripe.
- `@inngest/test` n'accompagne plus une majeure d'`inngest` : rouvrir le choix de l'execution en test.
