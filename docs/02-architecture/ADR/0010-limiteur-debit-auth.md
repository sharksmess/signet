# ADR-0010 — Limiteur de debit better-auth : toujours actif, coupe seulement en APP_ENV=test

- **Statut** : accepte (decision humaine du 2026-09-28)
- **Date** : 2026-09-28
- **Phase** : 3 — tranche 001, adoption de l'usine 1.3 (etape 4)

## Contexte

Depuis l'usine 1.3, la suite de tests construit l'application et la demarre en
`NODE_ENV=production` (`tests/_factory/global-setup.ts`). better-auth 1.7.5 active alors son
limiteur de debit (`enabled: options.rateLimit?.enabled ?? isProduction`), avec une regle
integree de 3 requetes `/sign-up` par 10 s et par IP. La suite inscrit des dizaines
d'utilisateurs en quelques secondes : 26 tests HTTP echouaient en 429
(« Too many requests. Please try again later. »).

Avant 1.3, le serveur de test tournait en `next dev` : le limiteur etait coupe **sans que ce soit
une decision**. Rien ne garantissait non plus qu'il soit actif en production, puisque cela
dependait seulement de `NODE_ENV`.

## Options envisagees

### Option A — Tests qui respectent le limiteur (attente sur 429)
Aucun changement de production, mais environ 3 inscriptions par 10 s ralentissent fortement la
suite et la CI.

### Option B — Interrupteur `AUTH_RATE_LIMIT=on|off` seul
Suite rapide, mais un interrupteur de securite existe en production : une erreur de configuration
suffit a l'ouvrir.

### Option C — Limites relevees par variable d'environnement
Meme defaut que B, sous une forme moins visible.

### Option D — Interrupteur verrouille par l'environnement d'execution — retenue
Option B durcie : `off` n'est accepte qu'avec `APP_ENV=test`.

## Decision

`apps/web/src/lib/auth-rate-limit.ts`, fonction pure `buildRateLimitOptions(env)`, appelee au
chargement de `apps/web/src/lib/auth.ts` :

- `AUTH_RATE_LIMIT` : `on` | `off`, valide par Zod, **`on` par defaut** ;
- `APP_ENV` : `test` | `development` | `production`, valide par Zod, **`production` par defaut** ;
- `off` n'est accepte qu'avec `APP_ENV=test`. Toute autre combinaison avec `off`, ou toute valeur
  invalide (y compris vide), **leve au demarrage** : fail closed. Une erreur de configuration
  empeche le serveur de demarrer, elle n'ouvre jamais le limiteur ;
- le limiteur est explicitement `enabled: true` hors de ce cas, independamment de `NODE_ENV` ;
- la regle d'inscription (3 par 10 s, `customRules["/sign-up/*"]`) est ecrite dans notre
  configuration au lieu de s'appuyer sur le defaut integre de better-auth.

Tests sans HTTP (`tests/organizations/auth-rate-limit.test.ts`) : defaut actif avec la regle
sign-up, `off` + `production` leve, `off` + `development` leve, `off` sans `APP_ENV` leve,
`off` + `test` desactive, valeurs invalides levent.

Positionnement : `.env.test.local` porte `TEST_SERVER_ENV_AUTH_RATE_LIMIT=off` et
`TEST_SERVER_ENV_APP_ENV=test` (pose par l'humain) ; le job `ci` de `.github/workflows/ci.yml`
porte `AUTH_RATE_LIMIT=off` et `APP_ENV=test`.

## Consequences acceptees

- Le limiteur est desormais actif aussi en `next dev` (`APP_ENV` absent vaut `production`, et
  `development` refuse `off`). Un developpeur qui enchaine les inscriptions en local recoit des
  429 : c'est voulu.
- Aucun test de la suite HTTP n'exerce le limiteur reel : sa configuration est prouvee par le test
  pur, pas par une requete. Un test HTTP dedie exigerait un second serveur demarre avec le limiteur
  actif.
- Le stockage du limiteur reste celui par defaut de better-auth (memoire du processus) : avec
  plusieurs instances, chacune compte seule. Hors perimetre de cette decision.

## Signal de reexamen

- Une montee de better-auth qui change le nom ou la semantique de `rateLimit.enabled` ou de
  `customRules` : le test pur doit echouer, et cet ADR doit etre relu.
- Un deploiement dont l'hebergeur pose lui-meme une variable `APP_ENV` : verifier qu'elle ne vaut
  jamais `test`.
- Le passage a plusieurs instances : choisir un stockage partage pour le limiteur.
