## Rapport de contrôle des contrats, tranche 011 (Next 15.5.26 vers 16.3.7)

**Verdict : aucune rupture de contrat constatée.** Je n'ai lancé ni `pnpm test` ni le build. Je me suis appuyé sur `git`, le code et la documentation de Next livrée dans `apps/web/node_modules/next/dist/docs/`.

### 1. Périmètre déclaré (AC3)
La commande `git diff main -- tests/organizations docs/02-architecture/api-contracts packages/db apps/web/src` est vide. Sont donc inchangés :
- les contrats d'API, le schéma de base et les migrations (`packages/db/**`) ;
- tout `apps/web/src/**` ;
- les tests de la tranche 001 (`tests/organizations/**`).

`git diff main...HEAD --stat` ne touche que les fichiers suivants :
- `apps/web/package.json` (bascule `next` de 15.5.26 à 16.3.7) ;
- `apps/web/tsconfig.json` ;
- `eslint.config.mjs`, `package.json`, `pnpm-lock.yaml` ;
- `.github/dependabot.yml` ;
- la documentation (ADR, journal, registre, backlog) ;
- les nouveaux tests `tests/stack-upgrade/*`.

`docs/02-architecture/ERD.md` n'apparaît pas dans le diff. Aucune migration n'est ajoutée, donc ce n'est pas un écart.

### 2. Ruptures implicites dues à Next 16
Ces points s'appuient sur la lecture du code et du guide `upgrading/version-16.md` de Next. Les tests de la tranche 001 (107/107 verts contre le serveur Next 16.3.7 construit) les confirment sans les épuiser.
- **Signature des gestionnaires.** `apps/web/src/app/api/organizations/[organizationId]/route.ts` déclare déjà `params: Promise<{ organizationId: string }>` et fait `await params`. C'est la forme asynchrone que Next 16 impose (section « Async Request APIs ») : aucune adaptation nécessaire.
- **Route catch-all d'authentification.** `apps/web/src/app/api/auth/[...all]/route.ts` exporte `toNextJsHandler(auth)` avec `GET` et `POST` seulement. Cela n'est pas modifié, et better-auth reste figé à 1.7.6. Les méthodes non exportées restent traitées par Next. Le guide de montée ne signale aucun changement de ce comportement (vérifié par grep sur les titres, sans lecture exhaustive). Le 405 n'est pas fixé par un test de la tranche 001.
- **Routes dynamiques.** Les gestionnaires lisent la session via `request.headers` et le corps via `request.json()`. Ils restent dynamiques (`ƒ`), ce qui correspond au listing du build. Je n'ai pas relu le guide sur le cache des `GET`.
- **Middleware et proxy.** Aucun `middleware` ni `proxy` dans `apps/web` (`git grep` vide). Le renommage `middleware` vers `proxy` de Next 16 ne s'applique donc pas.
- **`next.config.ts`.** Il est inchangé et ne contient que `reactStrictMode: true`. Il n'y a aucune option retirée en 16 (`runtimeConfig`, AMP, `next lint`, etc.).
- **`/_not-found`.** Route générée par Next, sans contrat déclaré. Je ne relève aucune rupture.

### 3. Contrat de types visible des consommateurs
Les deux changements touchent `apps/web/tsconfig.json`, une configuration interne à l'application :
- `jsx` passe de `preserve` à `react-jsx`, réécriture automatique par `next build` ;
- `include` ajoute `.next/dev/types/**/*.ts`, ce qui est additif.

`apps/web` est une application, pas un paquet publié. Aucun type partagé ni type de contrat (`apps/web/src/lib/contracts.ts`, `docs/02-architecture/api-contracts/**`) n'est modifié. Le changement n'est pas visible d'un consommateur externe.

### 4. Événements et webhooks
Aucun fichier de webhook ou de file de messages n'est touché.

### Synthèse
- Aucune rupture de requête, de réponse, de statut, de schéma de base, d'énumération ou d'événement.
- Aucun ADR de migration n'est requis au titre des contrats.
- Seul point non couvert par un test : le 405 sur les méthodes non exportées. Je n'ai pas de preuve d'un changement, mais pas non plus de test qui le garantisse.

CONTRACTS: PASS
