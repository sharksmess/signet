# Analyse — source de l'adresse IP du limiteur de connexions

- **Date** : 2026-11-26
- **Consigne** : `docs/04-runbooks/consigne-analyse-ip-limiteur.md` (orchestrateur)
- **Base analysee** : `main` a `af67d0e` (usine 1.6.7), `better-auth` 1.7.13 et `@better-auth/core` 1.7.13, `next` 16.4.5, lus dans `node_modules/.pnpm/`
- **Methode** : lecture seule (`git grep`, lecture du code installe). Aucun test lance, aucune branche, aucun commit. Aucun fichier `.env*.local` ni `*.local.ps1` ouvert ou cherche. Aucune sortie n'a atteint une limite de coupure ; aucun journal `.logs/analyse-ip-*.log` n'a donc ete necessaire.
- **Antecedent** : le meme mecanisme a deja ete decrit par l'audit-001 (MINEUR-11, sur better-auth 1.7.5) et figure au backlog (`docs/03-slices/000-backlog.md:76`, « avant tout choix d'hebergement »). Cette analyse le reverifie sur la version installee et y ajoute le role de Next.js.

## Verdict : B — falsifiable

Dans la configuration actuelle, l'adresse IP qui sert de cle au compteur est **celle que le client ecrit lui-meme** dans `X-Forwarded-For`, des qu'une requete atteint `next start` sans passer par un proxy qui ecrase cet en-tete. C'est le seul mode de deploiement que le depot connait aujourd'hui (le serveur de test l'utilise). Un hebergement adequat peut neutraliser le defaut, mais rien dans le depot ne le garantit et aucun hebergement n'est choisi.

Exposition reelle aujourd'hui : **aucune**, l'application n'est pas en ligne. C'est une condition de mise en ligne, deja inscrite au backlog.

## 1. Ou est le limiteur

Un seul limiteur : celui de better-auth. **Aucun limiteur maison** : `AUTH_RATE_LIMIT` n'est qu'un interrupteur, il ne compte rien.

| Element | Emplacement |
|---|---|
| Branchement | `apps/web/src/lib/auth.ts:40` — `rateLimit: buildRateLimitOptions(process.env)` |
| Options | `apps/web/src/lib/auth-rate-limit.ts:121-141` — `enabled` (vrai sauf `off` + `APP_ENV=test`), `customRules: { "/sign-up/*": { window: 10, max: 3 } }`. Ni `storage`, ni `window`, ni `max` |
| Options d'IP | **absentes** : `auth.ts:41-48`, le bloc `advanced` ne contient que `database.generateId`. Ni `ipAddress.ipAddressHeaders`, ni `trustedProxies`, ni `ipv6Subnet`, ni `disableIpTracking` (noms confirmes dans `@better-auth/core/dist/types/init-options.d.mts:250-279`) |
| Route | `apps/web/src/app/api/auth/[...all]/route.ts` — `toNextJsHandler(auth)`, aucun traitement d'en-tete. Pas de `middleware.ts` ni `proxy.ts` dans `apps/web` |
| Moteur | `better-auth/dist/api/rate-limiter/index.mjs` (`onRequestRateLimit`, `resolveRateLimitConfig`) |
| Valeurs par defaut | `better-auth/dist/context/create-context.mjs:172-175` — `window: 10`, `max: 100`, `storage: "memory"` |
| Regles integrees | `rate-limiter/index.mjs:305-318` — `/sign-in*`, `/sign-up*`, `/change-password*`, `/change-email*` : 3 par 10 s ; reinitialisation de mot de passe et e-mails de verification : 3 par 60 s |

## 2. D'ou vient l'IP

Chaine complete, du reseau au compteur :

**a) Next.js remplit l'en-tete seulement s'il est absent.** `next/dist/server/base-server.js:604` :
```js
req.headers['x-forwarded-for'] ??= originalRequest?.socket?.remoteAddress;
```
`??=` : si le client a envoye `X-Forwarded-For`, Next le laisse **tel quel** et n'y ajoute pas l'adresse reelle de la connexion.

**b) better-auth lit l'en-tete.** `@better-auth/core/dist/utils/ip.mjs:196-219` :
```js
const DEFAULT_IP_HEADERS = ["x-forwarded-for"];
function getIP(req, options) {
  if (options.advanced?.ipAddress?.disableIpTracking) return null;
  const ipHeaders = options.advanced?.ipAddress?.ipAddressHeaders || DEFAULT_IP_HEADERS;
  for (const key of ipHeaders) { ... const ip = getIPFromHeader(value, { ipv6Subnet, trustedProxies }); if (ip) return ip; }
  if (isTest() || isDevelopment()) return LOCALHOST_IP;   // "127.0.0.1"
  return null;
}
```
Source unique : `x-forwarded-for`. Repli : `127.0.0.1` si `NODE_ENV` vaut `test`, `dev` ou `development` (`env-impl.mjs:30-36`), sinon `null`.

**c) Sans `trustedProxies`, une valeur unique est crue.** `ip.mjs:174-194` :
```js
if (forwardedIps.length !== 1) return null;
const selectedIp = forwardedIps[0];
if (!selectedIp || !isValidIP(selectedIp)) return null;
return normalizeIP(selectedIp, { ipv6Subnet: options.ipv6Subnet });
```
Le commentaire de la bibliotheque le dit lui-meme : « The leftmost token is spoofable ». IPv6 regroupe par /64 (`normalizeIP`, defaut 64) ; IPv4 mappee convertie en IPv4.

**d) Cle du compteur.** `rate-limiter/index.mjs:242-248` :
```js
const ip = getIP(req, ctx.options);
...
const key = createRateLimitKey(ip ?? NO_TRUSTED_IP_KEY, path);   // `${ip}|${path}`, ou "no-trusted-ip|<chemin>"
```
Stockage : `Map` en memoire du processus (`index.mjs:6`, `213-231`).

## 3. Est-ce falsifiable

**Oui.** Scenarios concrets, application servie par `next start` sans proxy qui ecrase l'en-tete (c'est aussi le cas d'un proxy qui transmet l'en-tete du client sans y toucher) :

1. **Contournement (bourrage d'identifiants).** L'attaquant envoie `POST /api/auth/sign-in/email` avec un mot de passe different a chaque essai et `X-Forwarded-For: 203.0.113.N`, `N` change a chaque requete (en IPv6 : un /64 different). Next garde l'en-tete (`??=`), better-auth le croit (valeur unique valide), la cle `203.0.113.N|/sign-in/email` est neuve a chaque fois : la regle « 3 par 10 s » ne s'applique jamais. Le compteur etant par IP et par chemin, et non par compte, rien d'autre ne freine les essais sur un meme compte. Meme effet sur `/sign-up/email` (creation de comptes en masse).
2. **Blocage cible.** L'attaquant envoie 3 requetes par 10 s avec `X-Forwarded-For: <IP de la victime>`. La victime, sans en-tete, recoit de Next son adresse de connexion dans le meme en-tete, donc la meme cle : elle est bloquee (429) tant que l'attaquant entretient le compteur.
3. **Sans aucun en-tete** (client direct) : Next remplit avec l'adresse de la socket, chaque client a son compteur. Correct dans ce seul cas.
4. **Compteur partage pour tous.** Si l'IP ne peut pas etre resolue en production (`NODE_ENV=production`), la cle devient `no-trusted-ip|<chemin>` pour tout le monde, avec un seul avertissement dans les journaux (`index.mjs:244-247`). Cas typique : un proxy qui **ajoute** a l'en-tete (nginx `$proxy_add_x_forwarded_for`) produit deux valeurs, donc `null`. Trois tentatives de connexion par 10 s suffisent alors a bloquer la connexion et l'inscription de tous les utilisateurs. En `next dev` (`NODE_ENV=development`), le repli `127.0.0.1` a le meme effet de compteur unique.

Effet secondaire, hors limiteur : la meme valeur alimente la colonne `session.ip_address` (`better-auth/dist/db/internal-adapter.mjs:275`). Elle est donc elle aussi falsifiable ; aucune logique du projet ne la lit (verifie par `git grep`), c'est une information de journal non fiable.

## 4. Ce que prouvent les tests existants

**Aucun test n'exerce la source d'IP ni le limiteur reel.**

- `tests/organizations/auth-rate-limit.test.ts` : test pur de `buildRateLimitOptions` (interrupteur, `customRules`). Aucune requete, aucun en-tete.
- Toute la suite HTTP tourne avec le limiteur coupe (`AUTH_RATE_LIMIT=off`, `APP_ENV=test` : `.env.test.example:31`, `.github/workflows/ci.yml:71`). ADR-0010, « Consequences acceptees », le dit : « Aucun test de la suite HTTP n'exerce le limiteur reel ».
- `tests/screens/messages.test.ts` et `requests.test.ts` : seulement l'affichage d'un 429 simule.
- Aucune occurrence de `x-forwarded-for`, `x-real-ip` ou `forwarded` dans `tests/` ou `apps/web/src`.

## 5. Ce qui depend de l'hebergement

Ce que le projet dit deja :

- `docs/01-product/PRD.md:127` : « Hebergement : Union europeenne ». Rien d'autre sur la plateforme.
- `docs/01-product/PRD.md:122-124` : charge negligeable, banc d'essai, pas de SLA (une instance suffit ; le stockage en memoire n'est pas un probleme a ce stade).
- `docs/03-slices/000-backlog.md:76` : fixer `ipAddressHeaders`/`trustedProxies` et le consigner dans ADR-0010 **avant tout choix d'hebergement**.
- `docs/03-slices/000-backlog.md:159` et `:177` : controle d'origine et anti-encadrement, « a traiter avec le choix d'hebergement ».
- ADR-0010, « Signal de reexamen » : plusieurs instances, donc stockage partage ; `APP_ENV` pose par l'hebergeur. **La source d'IP n'y figure pas** (la remediation de l'audit-001 demandait de l'y ajouter).
- `docs/04-runbooks/audits/audit-014.md:29` : `baseURL` et `trustedOrigins` a fixer avant la mise en production.

Aucune plateforme n'est choisie, et je n'en choisis pas. Ce qui compte pour le choix : (i) la plateforme **ecrase**-t-elle `X-Forwarded-For`, ou pose-t-elle un en-tete dedie que le client ne peut pas forcer ; (ii) l'application est-elle **joignable seulement par ce proxy** ; (iii) combien d'instances.

## Options de correction (aucune appliquee)

| Option | Configuration | Ce qu'elle suppose de l'hebergement | Limite |
|---|---|---|---|
| **1. En-tete dedie de la plateforme** | `advanced.ipAddress.ipAddressHeaders: ["<en-tete de la plateforme>"]` (par exemple un en-tete d'IP client pose et ecrase par le proxy) | Le proxy ecrase toujours cet en-tete ; l'application n'est joignable que par lui | Depend d'un nom d'en-tete propre a la plateforme : a revoir a chaque changement d'hebergeur |
| **2. Proxys de confiance** | `advanced.ipAddress.trustedProxies: ["<CIDR du proxy>"]` avec `X-Forwarded-For` : better-auth retire de droite a gauche les adresses de confiance et garde la premiere qui ne l'est pas (`ip.mjs:177-189`) | Proxy qui **ajoute** a l'en-tete ; plages d'adresses du proxy connues et stables ; application non joignable directement (sinon un client direct envoie une valeur unique qui n'est pas de confiance et qui est retenue) | Plages a maintenir ; une plage mal saisie est ignoree (`parseCIDR` rend `null`) et fait retomber sur le compteur partage |
| **3. Limite par compte, en plus de l'IP** | Compteur cle sur l'adresse e-mail visee, pour `/sign-in/email` (code maison ou crochet better-auth) | Aucune : independant des en-tetes | Ne protege pas l'inscription en masse ; permet a un tiers de bloquer la connexion d'un compte connu : **regle metier** (seuil, duree, message) a decider. Code nouveau, ADR |

Ecartees : `disableIpTracking: true` coupe purement le limiteur (`resolveRateLimitConfig` rend `null`, `index.mjs:243`) ; reecrire `X-Forwarded-For` dans la route, car Next 16 ne donne pas acces a l'adresse de la socket dans un gestionnaire de route.

Les options 1 et 2 sont exclusives selon la plateforme ; l'option 3 se combine avec l'une d'elles.

## Ce qu'exigerait une tranche de correction

- **Fichiers** : `apps/web/src/lib/auth.ts` (bloc `advanced.ipAddress`) ; `apps/web/src/lib/auth-rate-limit.ts` (construction des options d'IP depuis l'environnement, valide par Zod, par exemple un en-tete ou une liste de CIDR, avec refus de demarrer si la valeur est absente ou invalide en production, sur le modele de `buildRateLimitOptions`) ; `.env.example`, `.env.test.example`, `ci/build.env` si une variable est ajoutee ; ADR-0010 complete ou nouvel ADR ; `docs/DECISIONS.md` ; backlog (ligne 76) ; journal de tranche. Pour l'option 3 : module de limite par compte et, s'il faut une table, migration et `docs/02-architecture/ERD.md`.
- **Tests a ecrire** :
  - test pur des options d'IP (valeurs valides, absentes, CIDR invalide, combinaison avec `APP_ENV`) ;
  - **test HTTP sur un serveur dont le limiteur est actif** (ADR-0010 note qu'il faut un second serveur : la suite actuelle tourne limiteur coupe) : 4 tentatives de `POST /api/auth/sign-in/email` dans la fenetre, **chacune avec un `X-Forwarded-For` different**, la 4e doit rendre 429 ;
  - deux clients reellement distincts (selon l'option : deux valeurs de l'en-tete de confiance, ou deux chaines terminees par un proxy de confiance) ne partagent pas le compteur ;
  - option 2 : une chaine a deux valeurs n'aboutit pas au compteur partage `no-trusted-ip` ;
  - option 3 : la limite par compte tient quelles que soient les IP.
- **Decisions humaines prealables** : la plateforme d'hebergement, ou au minimum son modele de proxy (ecrase, ajoute, en-tete dedie) et la garantie que l'application n'est joignable que par lui ; l'option 3 oui ou non, et sa regle metier. Rappel connexe deja note dans ADR-0010 : plusieurs instances imposeraient un stockage partage du limiteur.
