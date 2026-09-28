# 001 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : en cours (adoption de l'usine 1.3, cf. `docs/04-runbooks/consigne-adoption-1.3.md`)
- Branche : slice/001-creation-organisation
- Dernier commit : a50feeb build: lint ESLint type-aware et script check (ADR-0009) (etape 3) ; migrations 0007/0008 committees a la suite
- Prochaine etape : une fois `.env.test.local` complete par l'humain, relancer `pnpm test` (attendu : vert) et `pnpm run check`, puis etape 5 (re-audit, close-slice)

## Couches
Reconstitue depuis `git log main..HEAD` et l'historique anterieur :
- [x] Migration — `54e98b5` (tests), `c8adb9f`/`e65d4b6` (0001-0003), `05f3007` (0004), `c05a752` (0005), `ecf41d0` (0006)
- [x] Acces donnees — `e65d4b6`, `bd3a104`
- [x] Logique metier — `e65d4b6`
- [x] API — `e65d4b6`, `fdd1037`, `062e52a`
- [x] UI — `e65d4b6`
- [ ] Suite complete verte + `pnpm run check` — a prouver a l'etape 4 (script `check` introduit a l'etape 3)

Audits : premier passage security-auditor et contract-guardian committe en `ccf260c` ; re-audit attendu a l'etape 5.

## Blocages
- `pnpm test` : 26 tests HTTP en echec, tous « Echec de l'inscription de test (429) : Too many requests ». Cause : le serveur de l'usine tourne en `NODE_ENV=production`, et better-auth 1.7.5 active alors son limiteur (`enabled: options.rateLimit?.enabled ?? isProduction`) avec une regle speciale de 3 `/sign-up` par 10 s et par IP. Decision humaine prise et implementee (ADR-0010). **Attend** : l'humain ajoute `TEST_SERVER_ENV_AUTH_RATE_LIMIT=off` et `TEST_SERVER_ENV_APP_ENV=test` a `.env.test.local`. Dernier lancement sans ces variables : 26 echecs (429), 20 succes.
- `.env.test.example` : modification refusee par les permissions de l'agent. Les deux variables ci-dessus y restent a documenter par l'humain.
- `pnpm typecheck` : 3 erreurs TS2345 dans `tests/_factory/env.ts:34` et `tests/_factory/global-setup.ts:25,32`, presentes des l'installation de l'usine (b2c0f32), independantes de la tranche. Cause : `requireEnv` renvoie `Record<string, string>`, lu en `string | undefined` sous `noUncheckedIndexedAccess`. Correctif d'une ligne (signature generique `requireEnv<const N extends string>(names: readonly N[]): Record<N, string>`) refuse par le hook : `tests/_factory/**` est hors de `scope-001.txt`. Options : l'humain ajoute `tests/_factory/env.ts` au perimetre, ou corrige l'usine en amont. Exclure `_factory` du tsconfig serait une suppression de verification de type : ecarte.
- `pnpm lint` : 1 erreur dans `tests/_factory/global-setup.ts:151` (`require-await`, fonction de teardown `async` sans `await`), meme cause de perimetre. Correctif : retirer `async` et renvoyer `Promise.resolve()`, ou l'humain etend le perimetre. Tout le reste du depot passe le lint.
## Decisions
- Migration 0001 corrigee en place (et non par une nouvelle migration) : elle n'est pas dans `main`, la consigne 1.3 l'autorise explicitement.
- Helpers de test : la connexion BYPASSRLS est desormais `testDbUrl()` (URL admin de l'usine sur la base de test) ; `TEST_DATABASE_URL_BYPASSRLS` n'est plus lue. `TEST_DATABASE_URL_APP` et `TEST_DATABASE_URL_TABLE_OWNER` restent requises (mots de passe des roles) et doivent designer `TEST_DATABASE_NAME`, sinon le helper echoue : jamais d'assertion contre la base de dev.
- Les trois decisions ci-dessus sur les helpers sont validees par l'humain (2026-09-28).
- Totaux globaux remplaces : 422 -> organisations dont l'utilisateur du test est membre (= 0) ; 401 -> organisations portant un nom unique au test (= 0).
- Lint (ADR-0009) : ESLint 9.39.5 (ligne `maintenance`), pas 10.11.0 (`latest`) : `eslint-config-next@15.5.26` plante sous 10 (« Failed to patch ESLint because the calling module was not recognized »), incompatibilite reproduite. Ligne de reevaluation ajoutee au backlog. Script `postinstall` d'`unrs-resolver` refuse explicitement (`allowBuilds: false`), binding natif deja fourni par la dependance optionnelle.
- Lint des tests : 8 `no-unsafe-return` corriges en typant les lignes des `client.query<...>` (aucune regle desactivee).
- Migration 0007 (contenu valide par l'humain) : `_signet_migrations` avec RLS activee et forcee, sans politique, `REVOKE ALL` a PUBLIC. Le constat db-catalog a ete reproduit sans 0007, puis leve avec elle. Ligne ajoutee a ADR-0007.
- Migration 0008 (constat, non demandee explicitement) : 0006 n'a jamais eu d'effet. Un `ALTER DEFAULT PRIVILEGES IN SCHEMA` ne peut pas retirer un privilege accorde par defaut globalement, et `pg_default_acl` etait vide apres migration. Revocation reprise au niveau global. Le test anti-regression de 0006 echouait, il passe desormais.
- Limiteur (ADR-0010, decision humaine) : `buildRateLimitOptions`, fonction pure dans `apps/web/src/lib/auth-rate-limit.ts`. `off` n'est accepte qu'avec `APP_ENV=test`, sinon levee au demarrage. Regle sign-up 3 par 10 s explicite. Test pur dans `tests/organizations/auth-rate-limit.test.ts`, car le hook refuse `tests/auth/`, hors perimetre. CI : `AUTH_RATE_LIMIT=off` et `APP_ENV=test` dans l'env du job `ci`.
- `apps/web/tsconfig.json` committe tel que reecrit par `next build` (`allowJs`) ; `next-env.d.ts`, genere, ignore par le lint.
- `packages/db/src/migrate.ts` inchange : il lit deja `DATABASE_URL_MIGRATE`, et `dotenv/config` n'ecrase pas la valeur fournie par le globalSetup.
