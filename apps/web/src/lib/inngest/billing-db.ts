/**
 * Connexion `signet_billing` (Q-1, ADR-0016) et appel de la fonction
 * d'application d'etat Stripe.
 *
 * AC16 (A3, D-058) : ce module n'est importable que par le module de la
 * fonction Inngest (`process-stripe-event.ts`). La regle `no-restricted-imports`
 * d'`eslint.config.mjs` refuse son import partout ailleurs : la fonction Inngest
 * tourne dans le meme processus que les routes, et une route qui obtiendrait
 * cette connexion pourrait changer le palier de n'importe quelle organisation.
 *
 * Le role n'a aucun droit de table : la seule instruction possible est
 * `signet.apply_stripe_subscription(jsonb)`, qui valide son entree, derive
 * l'organisation d'une valeur de confiance et pose son propre contexte.
 */
import pg from "pg";
import type { Pool } from "pg";
import { billingDatabaseUrl } from "../env";

const { Pool: PgPool } = pg;

let billingPool: Pool | null = null;

function getBillingPool(): Pool {
  billingPool ??= new PgPool({ connectionString: billingDatabaseUrl() });
  return billingPool;
}

/**
 * Horloge de la base (D-077) : instant pris juste apres la relecture Stripe et
 * transmis comme `stripe_read_at`. Une seule horloge pour toutes les instances :
 * l'ordre des marques ne depend plus de l'horloge de chaque serveur, et la garde
 * monotone n'a plus besoin de borne haute. `clock_timestamp()` (pas `now()`,
 * fige au debut de la transaction), hors transaction, aucune table lue.
 */
export async function databaseNow(): Promise<string> {
  const { rows } = await getBillingPool().query<{ now: string }>(
    `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`,
  );
  const now = rows[0]?.now;
  if (!now) throw new Error("databaseNow : aucune ligne retournee");
  return now;
}

/** Entree de `signet.apply_stripe_subscription` : exactement les cles que la fonction accepte (ADR-0016). */
export interface ApplyStripeSubscriptionInput {
  stripe_event_id: string;
  /** Instant de la relecture Stripe (ISO 8601) : garde monotone, D-071. */
  stripe_read_at: string;
  /** ISO 8601. */
  occurred_at: string;
  event_type: string;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  stripe_status: string;
  is_pro_price: boolean;
  cancel_at_period_end: boolean;
  /** ISO 8601 ou null. */
  current_period_end: string | null;
  metadata_organization_id: string | null;
  /** Auteur de la transition : `canceled_by` si le statut relu mene a Free, sinon `requested_by` (D-071). */
  metadata_requested_by: string | null;
}

/**
 * Codes leves par la fonction pour un evenement qui ne doit rien ecrire
 * (ERD §0, D-067, D-068). Tous sont definitifs : rejouer l'evenement donnerait
 * le meme refus.
 */
export const REJECTION_CODES = {
  SG003: "entree invalide",
  SG004: "abonnement deja rattache a une autre organisation que sa metadonnee",
  SG005: "organisation non resolue",
  SG006: "incoherence Stripe",
} as const;

export type RejectionCode = keyof typeof REJECTION_CODES;

/** `stale` : etat relu plus ancien que le dernier applique, ignore sans ecriture (D-071). */
const APPLY_RESULTS = ["subscription_started", "subscription_canceled", "updated", "stale"] as const;
type ApplyResult = (typeof APPLY_RESULTS)[number];

function isApplyResult(value: unknown): value is ApplyResult {
  return typeof value === "string" && (APPLY_RESULTS as readonly string[]).includes(value);
}

export type ApplyOutcome =
  | { kind: "applied"; result: ApplyResult }
  | { kind: "rejected"; code: RejectionCode };

function rejectionCodeOf(error: unknown): RejectionCode | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = error.code;
  return typeof code === "string" && code in REJECTION_CODES ? (code as RejectionCode) : undefined;
}

/**
 * Applique l'etat. Un refus definitif (SG003 a SG006) est rendu comme valeur ;
 * toute autre erreur (base indisponible, privilege retire) est levee pour que
 * le pas soit rejoue par Inngest.
 */
export async function applyStripeSubscription(input: ApplyStripeSubscriptionInput): Promise<ApplyOutcome> {
  const client = await getBillingPool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ result: string }>(
      "SELECT signet.apply_stripe_subscription($1::jsonb) AS result",
      [JSON.stringify(input)],
    );
    await client.query("COMMIT");
    const result = rows[0]?.result;
    if (!isApplyResult(result)) {
      throw new Error("signet.apply_stripe_subscription : resultat inattendu");
    }
    return { kind: "applied", result };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const code = rejectionCodeOf(error);
    if (code !== undefined) return { kind: "rejected", code };
    throw error;
  } finally {
    client.release();
  }
}
