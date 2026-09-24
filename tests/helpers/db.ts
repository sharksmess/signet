/**
 * Infrastructure de test partagee — connexion a une base Postgres reelle et jetable.
 *
 * Regle du projet (CLAUDE.md / test-writer) : pas de mock de la base. Ces helpers
 * ouvrent de vraies connexions Postgres et executent du vrai SQL contre un schema
 * de test (conteneur ou instance dediee), jamais un mock d'ORM.
 *
 * Variables d'environnement attendues (a documenter dans .env.example par la
 * tranche d'amorcage d'infrastructure — hors perimetre de ce fichier) :
 *
 * - TEST_DATABASE_URL_BYPASSRLS : connexion sous un role possedant l'attribut
 *   Postgres `BYPASSRLS` (ex. le role superuser du conteneur de test, distinct
 *   de `signet_app`, `signet_auth` et `signet_definer`). `BYPASSRLS` ignore
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
 * - TEST_APP_BASE_URL : URL de base de l'application Next.js deja demarree
 *   (ex. http://localhost:3100), pointee vers la meme base que ci-dessus.
 *   Le demarrage du serveur n'est pas la responsabilite de ces tests (voir
 *   tests/helpers/auth.ts) : il doit etre lance en amont (CI ou dev) une fois
 *   que apps/web existe.
 *
 * Tant que packages/db (migrations, roles) et apps/web (serveur) n'existent
 * pas, toute tentative d'utiliser ces helpers echoue — c'est le comportement
 * attendu avant implementation.
 */
// `pg` est CommonJS : import par defaut puis destructuration plutot qu'un
// import nomme direct (meme raison qu'un import nomme direct echoue sous
// Node ESM reel dans packages/db/src/migrate.ts).
import pg from "pg";
import type { Pool, PoolClient } from "pg";
// Renomme a la destructuration : un `const Pool = ...` de meme nom que
// l'import de type ci-dessus est refuse par le compilateur (TS2440).
const { Pool: PgPool } = pg;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} n'est pas definie. Ces tests exigent une base Postgres 16 reelle et jetable ` +
        `(conteneur ou schema temporaire), migree avec le schema de la tranche 001 ` +
        `(pnpm db:migrate). Voir tests/helpers/db.ts pour la liste des variables attendues.`,
    );
  }
  return value;
}

let bypassRlsPool: Pool | null = null;
let tableOwnerPool: Pool | null = null;
let appPool: Pool | null = null;

export function getBypassRlsPool(): Pool {
  if (!bypassRlsPool) {
    bypassRlsPool = new PgPool({ connectionString: requiredEnv("TEST_DATABASE_URL_BYPASSRLS") });
  }
  return bypassRlsPool;
}

export function getTableOwnerPool(): Pool {
  if (!tableOwnerPool) {
    tableOwnerPool = new PgPool({
      connectionString: requiredEnv("TEST_DATABASE_URL_TABLE_OWNER"),
    });
  }
  return tableOwnerPool;
}

export function getAppPool(): Pool {
  if (!appPool) {
    appPool = new PgPool({ connectionString: requiredEnv("TEST_DATABASE_URL_APP") });
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
