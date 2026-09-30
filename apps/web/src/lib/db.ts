/**
 * Connexions Postgres applicatives (ERD §1, ADR-0001).
 *
 * `DATABASE_URL_APP` : role `signet_app`, non privilegie, sans BYPASSRLS.
 * C'est la SEULE connexion utilisee par les routes API pour toute requete
 * touchant une organisation, un membre, un compteur de quota ou un
 * abonnement.
 *
 * `DATABASE_URL_AUTH` : role `signet_auth`, utilise exclusivement par
 * better-auth (apps/web/src/lib/auth.ts) pour les quatre tables
 * d'authentification.
 */
// `pg` est CommonJS : import par defaut puis destructuration plutot qu'un
// import nomme direct, fiable independamment du bundler/runtime (Next.js
// serveur ici ; meme raison qu'un import nomme direct echoue sous Node ESM
// reel dans packages/db/src/migrate.ts).
import pg from "pg";
import type { Pool, PoolClient } from "pg";
// Renomme a la destructuration : un `const Pool = ...` de meme nom que
// l'import de type ci-dessus est refuse par le compilateur (TS2440).
const { Pool: PgPool } = pg;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} n'est pas definie. Voir apps/web/src/lib/db.ts pour les variables attendues.`,
    );
  }
  return value;
}

let appPool: Pool | null = null;
let authPool: Pool | null = null;

export function getAppPool(): Pool {
  if (!appPool) {
    appPool = new PgPool({ connectionString: requiredEnv("DATABASE_URL_APP") });
  }
  return appPool;
}

export function getAuthPool(): Pool {
  if (!authPool) {
    authPool = new PgPool({ connectionString: requiredEnv("DATABASE_URL_AUTH") });
  }
  return authPool;
}

export interface TenantContext {
  /** Organisation ciblee par la requete. Absente pour un appel "public"
   * (ex. creation d'organisation) qui n'a pas encore de tenant. */
  organizationId?: string;
  /** Utilisateur authentifie courant. Toujours present pour une route qui a
   * deja verifie la session (regle absolue CLAUDE.md : toute requete filtre
   * explicitement sur le tenant). */
  userId: string;
}

/**
 * Ouvre une transaction sous `signet_app`, pose le contexte tenant exactement
 * comme l'exige l'ERD (`SET LOCAL app.organization_id`, `SET LOCAL
 * app.user_id`), execute `fn`, puis COMMIT si `fn` reussit ou ROLLBACK sinon.
 *
 * `organizationId` peut venir de la requete (parametre d'URL) : depuis la
 * migration 0009 (ADR-0011), les politiques de `signet_app` ne rendent une
 * ligne que si `userId` est membre de cette organisation. C'est une seconde
 * barriere : le controle d'appartenance applicatif reste requis (reponse 404
 * identique pour une organisation inexistante ou d'un autre tenant).
 */
export async function withTenant<T>(
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
    await client.query("SELECT set_config('app.user_id', $1, true)", [ctx.userId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Variante sans organisation active : utilisee uniquement par la creation
 * d'organisation (POST /api/organizations), qui appelle
 * `signet.create_organization()` avant qu'aucun tenant n'existe pour cet
 * utilisateur. `app.user_id` est indispensable : depuis la migration 0009,
 * `create_organization` leve `SG002` s'il est absent ou s'il differe de
 * l'owner demande (ADR-0011 § e) — l'appelant passe donc le meme `userId` ici
 * et a la fonction. `app.organization_id` reste vide : fermeture par defaut
 * (ERD §1).
 */
export async function withUserOnly<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withTenant({ userId }, fn);
}
