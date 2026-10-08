/**
 * Acces base de la tranche 002 : connexion `signet_billing`, decouverte par le
 * catalogue de la fonction d'application d'etat Stripe, et lectures de
 * verification (boite blanche, role BYPASSRLS) filtrees par organisation.
 *
 * Aucune lecture n'agrege une table entiere : toute requete porte sur les
 * identifiants crees par le test (regle du projet).
 *
 * CONTRAT SUPPOSE (a confirmer, voir rapport) : la fonction d'application
 * d'etat est decouverte par le catalogue (la seule fonction SECURITY DEFINER
 * dont l'EXECUTE est accorde EXPLICITEMENT a signet_billing), donc son nom n'est
 * pas suppose. En revanche son appel suppose UN seul argument `jsonb` :
 * `signet.<fonction>(p_input jsonb)`, voir `ApplyInput`.
 */
import pg from "pg";
import type { Pool, PoolClient } from "pg";
import { loadTestEnv, requireEnv } from "../_factory/env";
import { asBypassRls } from "./db";

const { Pool: PgPool } = pg;

loadTestEnv();

let billingPool: Pool | null = null;

/** Connexion sous le role `signet_billing` (URL de la suite, base de test verifiee). */
export function getBillingPool(): Pool {
  if (!billingPool) {
    const env = requireEnv(["TEST_DATABASE_URL_BILLING", "TEST_DATABASE_NAME"]);
    const database = new URL(env.TEST_DATABASE_URL_BILLING).pathname.replace(/^\//, "");
    if (database !== env.TEST_DATABASE_NAME) {
      throw new Error(
        `[tests] TEST_DATABASE_URL_BILLING designe la base "${database}", pas la base de test "${env.TEST_DATABASE_NAME}".`,
      );
    }
    billingPool = new PgPool({ connectionString: env.TEST_DATABASE_URL_BILLING });
  }
  return billingPool;
}

export async function closeBillingPool(): Promise<void> {
  await billingPool?.end();
  billingPool = null;
}

/**
 * Execute `fn` sous `signet_billing` dans une transaction TOUJOURS annulee, avec
 * un contexte ambiant eventuellement force (AC6 c) : le test pose le contexte
 * qu'un appelant malveillant ou bogue aurait pu poser avant l'appel.
 */
export async function asBilling<T>(
  ambient: { organizationId?: string; userId?: string },
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getBillingPool().connect();
  try {
    await client.query("BEGIN");
    if (ambient.organizationId !== undefined) {
      await client.query("SELECT set_config('app.organization_id', $1, true)", [ambient.organizationId]);
    }
    if (ambient.userId !== undefined) {
      await client.query("SELECT set_config('app.user_id', $1, true)", [ambient.userId]);
    }
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

export interface ApplyFunction {
  /** `signet.nom(jsonb)` tel que rendu par regprocedure. */
  signature: string;
  /** Nom qualifie sans arguments, utilisable dans un appel. */
  qualifiedName: string;
  owner: string;
  securityDefiner: boolean;
  config: string[] | null;
}

/**
 * Fonctions dont l'EXECUTE est accorde EXPLICITEMENT (ACL) a `signet_billing`.
 * Un EXECUTE herite de PUBLIC n'apparait pas ici : c'est voulu, l'invariant
 * teste est « un seul GRANT explicite », les defauts PUBLIC relevant du test
 * de catalogue de l'usine.
 */
export async function explicitBillingExecuteGrants(): Promise<ApplyFunction[]> {
  return asBypassRls(async (client) => {
    const { rows } = await client.query<{
      signature: string;
      qualified_name: string;
      owner: string;
      prosecdef: boolean;
      proconfig: string[] | null;
    }>(
      `SELECT p.oid::regprocedure::text AS signature,
              p.oid::regproc::text      AS qualified_name,
              r.rolname                 AS owner,
              p.prosecdef,
              p.proconfig
         FROM pg_proc p
         JOIN pg_roles r ON r.oid = p.proowner
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND EXISTS (
            SELECT 1
              FROM aclexplode(p.proacl) a
              JOIN pg_roles g ON g.oid = a.grantee
             WHERE g.rolname = 'signet_billing' AND a.privilege_type = 'EXECUTE'
          )`,
    );
    return rows.map((r) => ({
      signature: r.signature,
      qualifiedName: r.qualified_name,
      owner: r.owner,
      securityDefiner: r.prosecdef,
      config: r.proconfig,
    }));
  });
}

/** La fonction d'application d'etat Stripe : echoue clairement si elle n'existe pas encore. */
export async function findApplyFunction(): Promise<ApplyFunction> {
  const grants = await explicitBillingExecuteGrants();
  const [first] = grants;
  if (grants.length !== 1 || !first) {
    throw new Error(
      `[AC6] attendu : exactement une fonction dont l'EXECUTE est accorde a signet_billing (la fonction d'application ` +
        `d'etat Stripe). Trouve : ${grants.length} (${grants.map((g) => g.signature).join(", ") || "aucune"}). ` +
        `La migration de la tranche 002 n'est pas (encore) appliquee ou le role signet_billing n'a pas son GRANT.`,
    );
  }
  return first;
}

/**
 * Entree de la fonction d'application. Cles supposees (a confirmer par
 * l'implementeur, voir rapport) ; valeurs en texte JSON comme les rend Stripe.
 */
export interface ApplyInput {
  stripe_event_id: string;
  /** Instant de l'evenement selon Stripe (ISO 8601). */
  occurred_at: string;
  /** `customer.subscription.created|updated|deleted`. */
  event_type: string;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  /** Statut Stripe brut (`active`, `past_due`, ...). */
  stripe_status: string;
  /** Le prix de l'abonnement est-il le prix Pro. */
  is_pro_price: boolean;
  cancel_at_period_end: boolean;
  /** ISO 8601 ou null. */
  current_period_end: string | null;
  /** `metadata.organization_id` de l'abonnement RELU aupres de Stripe (texte brut, peut etre invalide). */
  metadata_organization_id: string | null;
  /** `metadata.requested_by` (texte brut, peut etre invalide). */
  metadata_requested_by: string | null;
}

export async function callApply(client: PoolClient, fn: ApplyFunction, input: ApplyInput): Promise<void> {
  await client.query(`SELECT ${fn.qualifiedName}($1::jsonb)`, [JSON.stringify(input)]);
}

/** Etat d'une ligne subscription (lecture hors RLS, verification de test). */
export interface SubscriptionRow {
  organization_id: string;
  tier: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
}

export async function readSubscriptionRow(organizationId: string): Promise<SubscriptionRow> {
  return asBypassRls(async (client) => {
    const { rows } = await client.query<SubscriptionRow>(
      `SELECT organization_id, tier, status, stripe_customer_id, stripe_subscription_id,
              current_period_end, cancel_at_period_end
         FROM subscription WHERE organization_id = $1`,
      [organizationId],
    );
    const [row] = rows;
    if (!row) throw new Error(`Aucune ligne subscription pour l'organisation ${organizationId} (fixture manquante).`);
    return row;
  });
}

export interface BillingEventRow {
  id: string;
  organization_id: string;
  type: string;
  from_tier: string | null;
  to_tier: string | null;
  actor_user_id: string | null;
  stripe_event_id: string | null;
  occurred_at: Date;
}

/** Evenements facturables d'UNE organisation (jamais un comptage global). */
export async function readBillingEvents(organizationId: string): Promise<BillingEventRow[]> {
  return asBypassRls(async (client) => {
    const { rows } = await client.query<BillingEventRow>(
      `SELECT id, organization_id, type, from_tier, to_tier, actor_user_id, stripe_event_id, occurred_at
         FROM billing_event WHERE organization_id = $1 ORDER BY occurred_at, id`,
      [organizationId],
    );
    return rows;
  });
}

/** `link_quota` de l'organisation (NULL = illimite). */
export async function readLinkQuota(organizationId: string): Promise<number | null> {
  return asBypassRls(async (client) => {
    const { rows } = await client.query<{ link_quota: number | null }>(
      "SELECT link_quota FROM organization_link_usage WHERE organization_id = $1",
      [organizationId],
    );
    const [row] = rows;
    if (!row) throw new Error(`Aucun organization_link_usage pour ${organizationId}.`);
    return row.link_quota;
  });
}

export async function readLinkCount(organizationId: string): Promise<number> {
  return asBypassRls(async (client) => {
    const { rows } = await client.query<{ link_count: number }>(
      "SELECT link_count FROM organization_link_usage WHERE organization_id = $1",
      [organizationId],
    );
    const [row] = rows;
    if (!row) throw new Error(`Aucun organization_link_usage pour ${organizationId}.`);
    return row.link_count;
  });
}

/**
 * Arrangement : amene une organisation Free a un etat d'abonnement donne par
 * ecriture directe sous la connexion d'administration (le trigger de propagation
 * du quota s'applique). Sert aux tests de routes et de cas limites qui ont
 * besoin d'un etat de depart sans rejouer tout le parcours Stripe.
 */
export async function setSubscriptionDirect(
  organizationId: string,
  state: {
    tier: "free" | "pro";
    status?: "active" | "past_due" | "canceled" | "incomplete";
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    currentPeriodEnd?: Date | null;
    cancelAtPeriodEnd?: boolean;
  },
): Promise<void> {
  await asBypassRls(async (client) => {
    const result = await client.query(
      `UPDATE subscription
          SET tier = $2, status = $3, stripe_customer_id = $4, stripe_subscription_id = $5,
              current_period_end = $6, cancel_at_period_end = $7
        WHERE organization_id = $1`,
      [
        organizationId,
        state.tier,
        state.status ?? "active",
        state.stripeCustomerId ?? null,
        state.stripeSubscriptionId ?? null,
        state.currentPeriodEnd ?? null,
        state.cancelAtPeriodEnd ?? false,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error(`setSubscriptionDirect : ${result.rowCount} ligne(s) modifiee(s) pour ${organizationId}, 1 attendue.`);
    }
  });
}

/**
 * Arrangement : insere un billing_event (administration, hors RLS). Sert de
 * temoin positif aux tests de lecture : l'owner legitime doit voir la ligne
 * que le tiers ou le member ne voit pas.
 */
export async function insertBillingEventDirect(params: {
  organizationId: string;
  stripeEventId: string;
  actorUserId?: string | null;
}): Promise<string> {
  return asBypassRls(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO billing_event (organization_id, type, from_tier, to_tier, actor_user_id, stripe_event_id, occurred_at)
       VALUES ($1, 'subscription_started', NULL, 'pro', $2, $3, now())
       RETURNING id`,
      [params.organizationId, params.actorUserId ?? null, params.stripeEventId],
    );
    const [row] = rows;
    if (!row) throw new Error("insertBillingEventDirect : INSERT sans ligne retournee.");
    return row.id;
  });
}

/**
 * Comme `asBilling`, mais VALIDE la transaction si `fn` reussit (ROLLBACK s'il
 * leve) : pour verifier, apres l'appel, ce que la fonction a reellement ecrit.
 */
export async function asBillingCommitted<T>(
  ambient: { organizationId?: string; userId?: string },
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getBillingPool().connect();
  try {
    await client.query("BEGIN");
    if (ambient.organizationId !== undefined) {
      await client.query("SELECT set_config('app.organization_id', $1, true)", [ambient.organizationId]);
    }
    if (ambient.userId !== undefined) {
      await client.query("SELECT set_config('app.user_id', $1, true)", [ambient.userId]);
    }
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
 * Execute `fn` sous un role `signet_*` donne par `SET LOCAL ROLE` depuis la
 * connexion d'administration, dans une transaction toujours annulee. Sert aux
 * roles pour lesquels la suite n'a pas d'URL de connexion (signet_auth,
 * signet_owner) : les privileges verifies sont ceux du role, pas ceux de
 * l'administrateur.
 */
export async function asRoleFromAdmin<T>(
  role: "signet_app" | "signet_auth" | "signet_owner" | "signet_billing",
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return asBypassRls(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL ROLE ${role}`);
      const who = await client.query<{ u: string }>("SELECT current_user AS u");
      if (who.rows[0]?.u !== role) throw new Error(`asRoleFromAdmin : current_user = ${who.rows[0]?.u}, ${role} attendu.`);
      return await fn(client);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
    }
  });
}

/** Appel de la fonction avec des NULL typés d'apres le catalogue : ne depend pas de la signature exacte. */
export async function callApplyWithNulls(client: PoolClient, fn: ApplyFunction): Promise<void> {
  const { rows } = await client.query<{ args: string }>(
    `SELECT coalesce(string_agg(format('NULL::%s', t::regtype), ', ' ORDER BY ord), '') AS args
       FROM pg_proc p, unnest(p.proargtypes::oid[]) WITH ORDINALITY AS u(t, ord)
      WHERE p.oid = $1::regprocedure`,
    [fn.signature],
  );
  await client.query(`SELECT ${fn.qualifiedName}(${rows[0]?.args ?? ""})`);
}
