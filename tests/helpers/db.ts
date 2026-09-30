/**
 * Infrastructure de test partagee — connexion a une base Postgres reelle et jetable.
 *
 * Regle du projet (CLAUDE.md / test-writer) : pas de mock de la base. Ces helpers
 * ouvrent de vraies connexions Postgres et executent du vrai SQL contre un schema
 * de test (conteneur ou instance dediee), jamais un mock d'ORM.
 *
 * L'environnement est charge par `loadTestEnv()` (tests/_factory/env.ts), comme
 * le globalSetup de l'usine qui recree et migre la base de test avant la
 * suite. Toutes les connexions ci-dessous visent CETTE base
 * (`TEST_DATABASE_NAME`), jamais la base de dev : une URL qui designe une
 * autre base fait echouer le helper au lieu de s'y connecter.
 *
 * - Connexion BYPASSRLS : l'URL d'administration de l'usine pointee sur la base
 *   de test (`testDbUrl()`, superutilisateur, distinct de `signet_app`,
 *   `signet_auth` et `signet_definer`). `BYPASSRLS` ignore
 *   RLS inconditionnellement, y compris `FORCE` (Postgres : seul `BYPASSRLS`
 *   passe outre `FORCE ROW LEVEL SECURITY`, la propriete de table seule ne le
 *   permet plus des que `FORCE` est actif). Utilise UNIQUEMENT pour :
 *     (a) la remise a zero de l'etat entre fichiers de test (TRUNCATE),
 *     (b) l'arrangement de fixtures qui simulent un etat que l'application ne
 *         sait pas encore produire elle-meme dans cette tranche (ex. un second
 *         membre non-owner, avant que la tranche invitations n'existe),
 *     (c) la lecture de verification "boite blanche" apres une action HTTP
 *         (ex. lire le nom courant d'une organisation pour confirmer qu'un
 *         renommage refuse n'a rien change).
 *   Ne JAMAIS l'utiliser pour verifier un comportement d'isolation : cela
 *   contournerait precisement la RLS que ces tests doivent prouver.
 *
 * - TEST_DATABASE_URL_TABLE_OWNER : connexion sous le role proprietaire des
 *   tables (celui qui a joue les migrations), SANS l'attribut `BYPASSRLS`.
 *   Sert uniquement le test anti-regression "FORCE ROW LEVEL SECURITY
 *   s'applique meme au proprietaire" (ERD §1 : "le role proprietaire ... ,
 *   potentiellement celui d'un script d'exploitation, contourne silencieusement
 *   toutes les politiques" sans `FORCE`). Si ce role a par erreur `BYPASSRLS`,
 *   ce test perd tout son sens : c'est exactement le type de derive qu'il
 *   existe pour attraper.
 *
 * - TEST_DATABASE_URL_APP : connexion avec le role applicatif `signet_app`
 *   (non privilegie, sans `BYPASSRLS`, ERD §1). C'est le role sous lequel
 *   l'application tourne reellement : toute assertion de comportement (y
 *   compris l'isolation tenant, AC5) doit passer par cette connexion.
 *
 * - TEST_APP_BASE_URL : URL de base du serveur Next.js que le globalSetup
 *   construit, demarre sur la base de test et arrete en fin de suite.
 */
// `pg` est CommonJS : import par defaut puis destructuration plutot qu'un
// import nomme direct (meme raison qu'un import nomme direct echoue sous
// Node ESM reel dans packages/db/src/migrate.ts).
import pg from "pg";
import type { Pool, PoolClient } from "pg";
import { loadTestEnv, requireEnv, testDbUrl } from "../_factory/env";
// Renomme a la destructuration : un `const Pool = ...` de meme nom que
// l'import de type ci-dessus est refuse par le compilateur (TS2440).
const { Pool: PgPool } = pg;

loadTestEnv();

/**
 * URL d'un role applicatif, verifiee : elle doit designer la base de test
 * recreee par le globalSetup. Pointer ailleurs ferait tourner les assertions
 * contre une base que la suite ne controle pas.
 */
function testRoleUrl(name: string): string {
  const env = requireEnv([name, "TEST_DATABASE_NAME"]);
  const value = env[name] ?? "";
  const { TEST_DATABASE_NAME } = env;
  const database = new URL(value).pathname.replace(/^\//, "");
  if (database !== TEST_DATABASE_NAME) {
    throw new Error(
      `[tests] ${name} designe la base "${database}", pas la base de test "${TEST_DATABASE_NAME}". ` +
        `Corrige .env.test.local (l'humain le fait).`,
    );
  }
  return value;
}

let bypassRlsPool: Pool | null = null;
let tableOwnerPool: Pool | null = null;
let appPool: Pool | null = null;

export function getBypassRlsPool(): Pool {
  if (!bypassRlsPool) {
    bypassRlsPool = new PgPool({ connectionString: testDbUrl() });
  }
  return bypassRlsPool;
}

export function getTableOwnerPool(): Pool {
  if (!tableOwnerPool) {
    tableOwnerPool = new PgPool({
      connectionString: testRoleUrl("TEST_DATABASE_URL_TABLE_OWNER"),
    });
  }
  return tableOwnerPool;
}

export function getAppPool(): Pool {
  if (!appPool) {
    appPool = new PgPool({ connectionString: testRoleUrl("TEST_DATABASE_URL_APP") });
  }
  return appPool;
}

export async function closeAllPools(): Promise<void> {
  await Promise.all([bypassRlsPool?.end(), tableOwnerPool?.end(), appPool?.end()]);
  bypassRlsPool = null;
  tableOwnerPool = null;
  appPool = null;
}

export interface TenantContext {
  organizationId?: string | null;
  userId?: string | null;
}

/**
 * Execute `fn` dans une transaction ouverte sous le role applicatif `signet_app`,
 * avec le contexte tenant pose exactement comme le fait la couche applicative
 * (ERD §1) : `SET LOCAL app.organization_id`, `SET LOCAL app.user_id`.
 *
 * Si `organizationId`/`userId` sont omis, le contexte reste vide : c'est le
 * scenario "SET LOCAL oublie" (ERD §1, "un oubli fait echouer, il ne fait pas
 * fuiter") que le test d'isolation doit pouvoir exercer deliberement.
 *
 * La transaction est toujours annulee (ROLLBACK) apres `fn`, que `fn` reussisse
 * ou leve : ces helpers ne servent qu'a lire/tenter d'ecrire pour l'assertion,
 * jamais a faire persister un effet de bord d'un test a l'autre (independance
 * des tests, regle du projet).
 */
export async function asTenant<T>(
  ctx: TenantContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getAppPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (ctx.organizationId) {
      await client.query("SELECT set_config('app.organization_id', $1, true)", [
        ctx.organizationId,
      ]);
    }
    if (ctx.userId) {
      await client.query("SELECT set_config('app.user_id', $1, true)", [ctx.userId]);
    }
    const result = await fn(client);
    return result;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

/**
 * Comme `asTenant`, mais pose `app.organization_id`/`app.user_id` avec
 * exactement la valeur fournie, **meme une chaine vide** — la ou `asTenant`
 * (comportement inchange, AC1) traite toute valeur falsy comme "ne rien
 * poser du tout". Necessaire au cas limite AC3 (c) : "`app.user_id` [...]
 * est vide" est un scenario distinct de "absent", et le test doit pouvoir
 * poser explicitement `SET LOCAL app.user_id = ''` plutot que de s'appuyer
 * sur `asTenant` qui ne ferait tout simplement pas l'appel `set_config`.
 * Une cle absente du `ctx` (`undefined`) n'est, elle, jamais posee — distinct
 * d'une chaine vide explicitement fournie. Reserve aux tests de contexte
 * malforme ; les tests d'isolation "normaux" continuent d'utiliser `asTenant`.
 */
export async function asTenantRaw<T>(
  ctx: { organizationId?: string; userId?: string },
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getAppPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (ctx.organizationId !== undefined) {
      await client.query("SELECT set_config('app.organization_id', $1, true)", [
        ctx.organizationId,
      ]);
    }
    if (ctx.userId !== undefined) {
      await client.query("SELECT set_config('app.user_id', $1, true)", [ctx.userId]);
    }
    const result = await fn(client);
    return result;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

/**
 * Execute `fn` avec un role `BYPASSRLS`, hors de tout contexte RLS applicatif.
 * Reserve a l'arrangement de fixtures et aux lectures de verification decrites
 * en tete de fichier — jamais a une assertion d'isolation ou d'autorisation.
 */
export async function asBypassRls<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getBypassRlsPool();
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Execute `fn` avec le role proprietaire des tables, sans `BYPASSRLS`. Reserve
 * au test anti-regression de `FORCE ROW LEVEL SECURITY` — voir commentaire
 * `TEST_DATABASE_URL_TABLE_OWNER` en tete de fichier.
 */
export async function asTableOwner<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getTableOwnerPool();
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Remet la base a un etat vide entre fichiers de test. Utilise le role
 * `BYPASSRLS` (seul capable de contourner `FORCE ROW LEVEL SECURITY` pour un
 * TRUNCATE global) — le `TRUNCATE ... CASCADE` evite de declencher le
 * garde-fou `member_keep_last_owner` (qui ne surveille que le `DELETE`).
 */
export async function resetDatabase(): Promise<void> {
  await asBypassRls(async (client) => {
    await client.query(
      "TRUNCATE TABLE subscription, organization_link_usage, member, organization, " +
        "session, account, verification, app_user RESTART IDENTITY CASCADE",
    );
  });
}
