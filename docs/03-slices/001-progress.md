# 001 — journal d'avancement

Tenu par l'implementeur apres **chaque commit**. C'est ce fichier, pas la conversation, qui permet de reprendre apres une interruption.

## Etat
- Statut : en cours (adoption de l'usine 1.3, cf. `docs/04-runbooks/consigne-adoption-1.3.md`)
- Branche : slice/001-creation-organisation
- Dernier commit : 8af6ed2 fix(db): rendre idempotente la creation des roles en migration 0001 (etape 1) ; etape 2 committee a la suite
- Prochaine etape : etape 3 — ESLint reel, ADR-0009, scripts `lint`/`check`, `engines`

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
- `pnpm typecheck` : 3 erreurs TS2345 dans `tests/_factory/env.ts:34` et `tests/_factory/global-setup.ts:25,32`, presentes des l'installation de l'usine (b2c0f32), independantes de la tranche. Cause : `requireEnv` renvoie `Record<string, string>`, lu en `string | undefined` sous `noUncheckedIndexedAccess`. Correctif d'une ligne (signature generique `requireEnv<const N extends string>(names: readonly N[]): Record<N, string>`) refuse par le hook : `tests/_factory/**` est hors de `scope-001.txt`. Options : l'humain ajoute `tests/_factory/env.ts` au perimetre, ou corrige l'usine en amont. Exclure `_factory` du tsconfig serait une suppression de verification de type : ecarte.
## Decisions
- Migration 0001 corrigee en place (et non par une nouvelle migration) : elle n'est pas dans `main`, la consigne 1.3 l'autorise explicitement.
- Helpers de test : la connexion BYPASSRLS est desormais `testDbUrl()` (URL admin de l'usine sur la base de test) ; `TEST_DATABASE_URL_BYPASSRLS` n'est plus lue. `TEST_DATABASE_URL_APP` et `TEST_DATABASE_URL_TABLE_OWNER` restent requises (mots de passe des roles) et doivent designer `TEST_DATABASE_NAME`, sinon le helper echoue : jamais d'assertion contre la base de dev.
- Les trois decisions ci-dessus sur les helpers sont validees par l'humain (2026-09-28).
- Totaux globaux remplaces : 422 -> organisations dont l'utilisateur du test est membre (= 0) ; 401 -> organisations portant un nom unique au test (= 0).
- `packages/db/src/migrate.ts` inchange : il lit deja `DATABASE_URL_MIGRATE`, et `dotenv/config` n'ecrase pas la valeur fournie par le globalSetup.
