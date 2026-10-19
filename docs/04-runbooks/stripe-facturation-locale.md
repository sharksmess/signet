# Facturation en local : role `signet_billing`, Stripe et Inngest

Runbook de la tranche 002 (AC18, Q-1, Q-9, A6). Destinataire : l'humain. Les agents ne lisent, n'ecrivent ni n'affichent aucun mot de passe ni aucun fichier d'environnement local ; ils ecrivent ce runbook, l'humain execute.

Etat au 2026-10-15 : section 1 (role `signet_billing`) faite ; section 2 (variables de test de la facturation) a faire une fois, avant le prochain `pnpm test` ; sections 3 a 5 (Stripe en mode test, reglage A6, Inngest en local) facultatives, seulement pour un essai manuel du parcours reel.

## 1. Mot de passe du role `signet_billing`

### Pourquoi
La migration `packages/db/migrations/0011_billing_role.sql` cree le role Postgres `signet_billing` (`LOGIN`, `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, aucun droit de table ; ADR-0007 amende). Comme pour `signet_owner`, `signet_app` et `signet_auth`, **aucun mot de passe n'est dans la migration** : sans mot de passe, la connexion `signet_billing` est refusee et les tests de la tranche 002 qui l'utilisent echouent au premier acces.

Les roles sont communs a tout le cluster Postgres : un seul mot de passe vaut pour la base de developpement et pour la base de test si elles sont sur la meme instance (cas du poste local, port 5432).

### Etape 1 — Creer le role (jouer la migration)
**Voie principale** — depuis la racine du depot, sur la branche `slice/002-abonnement-palier` a jour :

```powershell
pnpm test
```

Le globalSetup recree la base de test et y joue toutes les migrations, dont `0011_billing_role.sql` : le role est cree sur le cluster (les roles sont communs a toutes les bases de l'instance). Les tests de la tranche 002 qui se connectent sous `signet_billing` echouent tant que l'etape 2 n'est pas faite : c'est attendu.

**Variante, base de developpement** : `pnpm db:migrate` joue la migration sur la base de developpement, mais exige `DATABASE_URL_MIGRATE` dans `.env` (modele `.env.example`). Sans elle, la commande s'arrete sur « DATABASE_URL_MIGRATE n'est pas definie » (constate le 2026-10-15 sur le poste de developpement, dont le `.env` ne porte que `DATABASE_URL`). Ligne attendue quand elle est definie : `applique : 0011_billing_role.sql`.

Si la migration leve (dans l'une ou l'autre voie) :
- « appartenance impliquant un role signet_* » : un role du cluster est membre d'un role `signet_*`, ou l'inverse. Revoquer l'appartenance citee (`REVOKE <role parent> FROM <role membre>;` sous le superutilisateur), puis rejouer.
- « reglage par role sur un role signet_* » : un `ALTER ROLE ... SET` existe pour ce role. Le retirer (`ALTER ROLE <role> RESET ALL;` ou `ALTER ROLE <role> IN DATABASE <base> RESET ALL;` selon la base citee), puis rejouer.

### Etape 2 — Fixer le mot de passe (vous seul)
Ouvrir `psql` sous le superutilisateur du cluster local :

```powershell
psql -h localhost -p 5432 -U postgres -d postgres
```

Puis, dans `psql` :

```
\password signet_billing
```

`psql` demande le mot de passe deux fois sans l'afficher, le chiffre cote client et n'ecrit rien dans l'historique de commandes : c'est la forme recommandee, plutot qu'un `ALTER ROLE ... WITH PASSWORD '...'` qui laisse le mot de passe en clair dans l'historique `psql` et dans les journaux du serveur si `log_statement` est actif.

Choisir un mot de passe propre a ce role (pas celui de `signet_app`). Puis verifier les attributs, toujours dans `psql` :

```
\du signet_billing
```

Attendu : une ligne `signet_billing` dont la colonne des attributs est vide (ni `Superuser`, ni `Create role`, ni `Create DB`, ni `Replication`, ni `Bypass RLS`, ni `Cannot login`). Quitter par `\q`.

### Etape 3 — Fichier local de test
Ajouter a `.env.test.local` (a la racine, ignore par git) les deux lignes `TEST_DATABASE_URL_BILLING` et `TEST_SERVER_ENV_DATABASE_URL_BILLING` du modele `.env.test.example`, en remplacant `MOT_DE_PASSE` par le mot de passe de l'etape 2 et le nom de base par la valeur de votre `TEST_DATABASE_NAME`. Forme : la meme URL que votre `TEST_DATABASE_URL_APP` actuelle, en changeant l'utilisateur `signet_app` en `signet_billing` et le mot de passe.

- `TEST_DATABASE_URL_BILLING` : connexion de la suite de tests sous `signet_billing` (`tests/helpers/billing-db.ts`, `tests/helpers/billing.ts`). Elle **doit** designer la base de test : le helper refuse une autre base.
- `TEST_SERVER_ENV_DATABASE_URL_BILLING` : transmise au serveur de test sous le nom `DATABASE_URL_BILLING` (globalSetup, prefixe retire). Le schema d'environnement du serveur l'exige au demarrage (AC13).
- Les deux valeurs sont identiques.
- Si votre `.env.test.local` utilise `TEST_ROLE_PASSWORDS` (normalement reserve a la CI), y ajouter aussi `signet_billing:MOT_DE_PASSE` ; sinon ne rien faire : ce reglage reecrit le mot de passe du role sur tout le cluster a chaque lancement.

Modele : `.env.test.example` (noms et valeurs factices).

### Etape 4 — Fichier de developpement (avant tout essai manuel de Stripe)
Non requise pour `pnpm test` ni pour livrer la tranche : seulement pour lancer `pnpm dev` et essayer le parcours Stripe a la main.

Etat constate le 2026-10-15 sur le poste de developpement : `.env` ne porte qu'une variable, `DATABASE_URL`, sous le superutilisateur `postgres`, et **aucune URL de role**. Or le serveur lit `DATABASE_URL_APP`, `DATABASE_URL_AUTH` et `DATABASE_URL_BILLING`, chacune sous son role (ADR-0007) : avec ce `.env`, `pnpm dev` refuse de demarrer, et une URL superutilisateur placee sous un de ces noms contournerait la RLS. Avant tout essai manuel :

1. Aligner `.env` sur le modele `.env.example` : `DATABASE_URL_MIGRATE` (superutilisateur, migrations seulement), `DATABASE_URL_APP`, `DATABASE_URL_AUTH`, `DATABASE_URL_BILLING` (chacune sous son role `signet_*`, avec le mot de passe de ce role), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_ENV=development`.
2. `DATABASE_URL_BILLING` : la meme URL que `DATABASE_URL_APP`, en changeant l'utilisateur `signet_app` en `signet_billing` et le mot de passe. Lue par la seule fonction Inngest de traitement des evenements Stripe (AC16).
3. Retirer `DATABASE_URL` si aucun outil ne la lit plus.
4. `pnpm db:migrate` pour amener la base de developpement a jour.

Suivi au backlog (`docs/03-slices/000-backlog.md`, Notes).

### Etape 5 — Signaler
Indiquer a l'agent que le mot de passe est fixe et que les deux fichiers sont completes, sans jamais lui transmettre la valeur. L'agent reprend alors l'implementation (`docs/03-slices/002-progress.md`).

### En CI
Rien a faire : le workflow `.github/workflows/ci.yml` pose le mot de passe factice de la base jetable par `TEST_ROLE_PASSWORDS` (`signet_billing:ci_only_not_a_secret`), et les URL de `signet_billing` n'en portent aucun (`PGPASSWORD`).

## 2. Variables de test de la facturation (`.env.test.local`)

Les tests de la tranche 002 demarrent un faux Stripe et un faux point d'evenements Inngest sur deux ports locaux, et le serveur de test leur parle (D-059). Toutes les valeurs sont **inventees** : aucune vraie cle Stripe n'est jamais utilisee par les tests, ni en local ni en CI.

Copier dans `.env.test.local` le bloc « Facturation (tranche 002) » de `.env.test.example`, tel quel (neuf lignes : `TEST_FAKE_STRIPE_PORT`, `TEST_FAKE_INNGEST_PORT`, `TEST_STRIPE_WEBHOOK_SECRET`, `TEST_SERVER_ENV_STRIPE_WEBHOOK_SECRET`, `TEST_SERVER_ENV_STRIPE_SECRET_KEY`, `TEST_SERVER_ENV_STRIPE_PRICE_ID_PRO`, `TEST_SERVER_ENV_STRIPE_API_BASE_URL`, `TEST_SERVER_ENV_INNGEST_DEV`, `TEST_SERVER_ENV_APP_URL`). Contraintes verifiees par les tests au demarrage :

- `TEST_STRIPE_WEBHOOK_SECRET` et `TEST_SERVER_ENV_STRIPE_WEBHOOK_SECRET` ont la meme valeur ;
- `TEST_SERVER_ENV_STRIPE_API_BASE_URL` vise le port `TEST_FAKE_STRIPE_PORT`, `TEST_SERVER_ENV_INNGEST_DEV` le port `TEST_FAKE_INNGEST_PORT` ;
- formes attendues par le schema d'environnement (`apps/web/src/lib/env.ts`) : `whsec_...`, `sk_test_...`, `price_...` (lettres, chiffres, `_`).

Si un des deux ports est deja pris sur le poste, en choisir un autre et l'utiliser aux deux endroits.

## 3. Stripe en mode test (facultatif, essai manuel)

Prerequis : `.env` aligne sur les roles (section 1, etape 4). Dans le tableau de bord Stripe, **mode test** uniquement :

1. Creer un produit « Signet Pro » avec un prix recurrent ; noter son identifiant `price_...`.
2. Ajouter a `.env` (modele `.env.example`, bloc « Facturation ») : `APP_URL`, `STRIPE_SECRET_KEY` (cle secrete du mode test, `sk_test_...`), `STRIPE_PRICE_ID_PRO`, et `STRIPE_WEBHOOK_SECRET` (etape 3). Ne jamais mettre de cle `sk_live_` dans un fichier du poste de developpement.
3. Recevoir les webhooks en local : `stripe listen --forward-to localhost:3100/api/webhooks/stripe` (Stripe CLI) ; la commande affiche un secret `whsec_...` a placer dans `STRIPE_WEBHOOK_SECRET`. Seuls `customer.subscription.created`, `.updated` et `.deleted` sont traites (D-060) ; les autres sont acquittes et ignores.
4. `STRIPE_API_BASE_URL` reste **absente** : elle est refusee hors `APP_ENV=test`.

## 4. Reglage Stripe obligatoire avant la production (A6)

Dans le tableau de bord Stripe (mode test, puis mode production), parametres de facturation des abonnements, rubrique de gestion des paiements en echec (« Manage failed payments » dans l'interface anglaise ; l'emplacement exact du menu peut changer, chercher « failed payments ») : pour le cas ou toutes les tentatives de paiement ont echoue, choisir **« Annuler l'abonnement »** (« Cancel the subscription »).

Pourquoi : Signet garde Pro un abonnement `past_due` ou `unpaid` (Q-8, Stripe n'a pas encore resilie). Si Stripe laissait l'abonnement `unpaid` indefiniment, l'organisation resterait Pro sans payer. Avec ce reglage, Stripe resilie l'abonnement a la fin des relances, emet `customer.subscription.deleted`, et Signet repasse l'organisation en Free avec un `subscription_canceled` sans auteur (`actor_user_id` NULL).

A verifier a nouveau a chaque nouveau compte Stripe (le reglage n'est pas copie du mode test au mode production).

## 5. Inngest en local (facultatif, Q-9)

Rien n'est impose : les tests n'utilisent jamais le serveur Inngest (D-059). Pour voir la fonction tourner pendant un essai manuel :

1. Dans `.env` : `INNGEST_DEV=1`, et **aucune** `INNGEST_EVENT_KEY` ni `INNGEST_SIGNING_KEY` (mode developpement, accepte seulement avec `APP_ENV=development` ou `test`).
2. Lancer le serveur de developpement Inngest (`npx inngest-cli@latest dev -u http://localhost:3100/api/inngest`), puis `pnpm dev`. Interface sur `http://localhost:8288`.
3. Sans serveur Inngest, le webhook repond `503` a Stripe (file indisponible) et Stripe renverra l'evenement plus tard : c'est le comportement voulu (A1).

En production : `INNGEST_DEV` absente (refusee avec `APP_ENV=production`), `INNGEST_EVENT_KEY` et `INNGEST_SIGNING_KEY` exigees au demarrage ; un appel non signe a `/api/inngest` recoit 401 (A2).
