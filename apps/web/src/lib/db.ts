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
import { Pool, type PoolClient } from "pg";

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
    appPool = new Pool({ connectionString: requiredEnv("DATABASE_URL_APP") });
  }
  return appPool;
}

export function getAuthPool(): Pool {
  if (!authPool) {
    authPool = new Pool({ connectionString: requiredEnv("DATABASE_URL_AUTH") });
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
 * utilisateur. `app.user_id` reste pose (utile pour d'eventuelles politiques
 * futures), `app.organization_id` reste vide : fermeture par defaut (ERD §1).
 */
export async function withUserOnly<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withTenant({ userId }, fn);
}
