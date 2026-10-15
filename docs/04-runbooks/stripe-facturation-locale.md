# Facturation en local : role `signet_billing`, Stripe et Inngest

Runbook de la tranche 002 (AC18, Q-1, Q-9, A6). Destinataire : l'humain. Les agents ne lisent, n'ecrivent ni n'affichent aucun mot de passe ni aucun fichier d'environnement local ; ils ecrivent ce runbook, l'humain execute.

Etat au 2026-10-08 : la section 1 (role `signet_billing`) est complete et doit etre executee **avant** le premier `pnpm test` de la tranche. Les sections Stripe (valeurs du mode test, reglage « annuler l'abonnement » apres echec des relances, A6) et Inngest en local (Q-9) sont ajoutees a ce fichier par les couches suivantes de la tranche 002, avec le code qui les lit.

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
