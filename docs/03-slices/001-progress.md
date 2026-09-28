# 001 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : tests verts (46/46), `pnpm run check` vert ; re-audit en cours (adoption usine 1.3, `docs/04-runbooks/consigne-adoption-1.3.md`)
- Branche : slice/001-creation-organisation
- Dernier commit : fda2959 feat(auth): limiteur de debit coupe seulement en APP_ENV=test ; env CI et `.env.test.example` committes a la suite
- Prochaine etape : etape 5 — re-audit security-auditor et contract-guardian sur le diff depuis ccf260c, puis `scripts/close-slice.sh`

## Couches
Reconstitue depuis `git log main..HEAD` et l'historique anterieur :
- [x] Migration — `54e98b5` (tests), `c8adb9f`/`e65d4b6` (0001-0003), `05f3007` (0004), `c05a752` (0005), `ecf41d0` (0006)
- [x] Acces donnees — `e65d4b6`, `bd3a104`
- [x] Logique metier — `e65d4b6`
- [x] API — `e65d4b6`, `fdd1037`, `062e52a`
- [x] UI — `e65d4b6`
- [x] Suite complete verte + `pnpm run check` — 2026-09-28 : 46/46, check vert (apres 15998ad, correctif humain de `tests/_factory`)

Audits : premier passage security-auditor et contract-guardian committe en `ccf260c` ; re-audit attendu a l'etape 5.

## Blocages
<!-- cause, essais, options. Vide = aucun. -->

## Decisions
- Blocages leves le 2026-09-28 : 429 du limiteur (variables posees par l'humain dans l'env de test local, ADR-0010) ; 3 erreurs de type et 1 erreur de lint dans `tests/_factory`, presentes des l'installation de l'usine (b2c0f32), corrigees par l'humain (15998ad).
- CI : env du job `ci` complete selon la consigne humaine (URL sans mot de passe, PGPASSWORD). Ajout non demande : `DATABASE_URL_APP`, `DATABASE_URL_AUTH`, `BETTER_AUTH_SECRET` factices sur l'etape Build. Sans elles, `next build` echoue (« Failed to collect page data for /api/auth/[...all] », reproduit en local) : `auth.ts` lit ces variables au chargement du module.
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
