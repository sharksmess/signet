/**
 * Logique metier « abonnement » (US-08, tranche 002) : consultation et demande
 * de changement de palier par l'owner.
 *
 * ADR-0005 : aucune fonction de ce module n'ecrit l'etat local. Une demande
 * declenche un appel Stripe et rend un accuse ; le palier ne change qu'au
 * traitement de l'evenement Stripe correspondant (fonction Inngest).
 *
 * Arguments supposes deja valides par le contrat (`lib/billing/contracts.ts`) :
 * ne sont verifies ici que l'appartenance et le role (ADR-0004), en base sous
 * `signet_app` avec le contexte de l'appelant (RLS en seconde barriere).
 */
import { withTenant } from "../db";
import { getServerEnv } from "../env";
import {
  alreadyOnTier,
  fail,
  insufficientRole,
  ok,
  organizationNotFound,
  stripeUnavailable,
  type Result,
} from "../errors";
import { getStripe, isStripeError } from "../stripe";

type Tier = "free" | "pro";
type SubscriptionStatus = "active" | "past_due" | "canceled" | "incomplete";

interface SubscriptionRow {
  tier: Tier;
  status: SubscriptionStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
}

/**
 * Ligne `subscription` de l'organisation, si l'appelant en est l'owner.
 * Organisation inexistante et organisation d'un autre tenant donnent le meme
 * 404 (US-09.2) ; un member recoit 403 (US-08.2).
 */
async function readAsOwner(userId: string, organizationId: string): Promise<Result<SubscriptionRow>> {
  return withTenant({ userId, organizationId }, async (client) => {
    const membership = await client.query<{ role: string }>(
      "SELECT role FROM member WHERE organization_id = $1 AND user_id = $2",
      [organizationId, userId],
    );
    const role = membership.rows[0]?.role;
    if (!role) return fail(organizationNotFound());
    if (role !== "owner") return fail(insufficientRole());

    const subscription = await client.query<SubscriptionRow>(
      `SELECT tier, status, stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at_period_end
         FROM subscription WHERE organization_id = $1`,
      [organizationId],
    );
    const row = subscription.rows[0];
    // Toute organisation a sa ligne (create_organization) : l'absence est un invariant rompu.
    if (!row) throw new Error("subscription absente pour une organisation dont l'appelant est owner");
    return ok(row);
  });
}

export interface SubscriptionView {
  organizationId: string;
  tier: Tier;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
}

export async function getSubscription(params: {
  userId: string;
  organizationId: string;
}): Promise<Result<SubscriptionView>> {
  const read = await readAsOwner(params.userId, params.organizationId);
  if (!read.ok) return read;
  const row = read.value;
  return ok({
    organizationId: params.organizationId,
    tier: row.tier,
    status: row.status,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    currentPeriodEnd: row.current_period_end ? row.current_period_end.toISOString() : null,
  });
}

export type ChangeTierOutcome =
  | { action: "redirect_to_checkout"; checkoutUrl: string }
  | { action: "pending"; organizationId: string };

/**
 * Free -> Pro : session Checkout portant l'organisation et l'owner demandeur
 * dans les metadonnees de l'abonnement a creer (lues par la fonction Inngest,
 * ADR-0016), et le client Stripe deja connu le cas echeant (D-062).
 * Pro -> Free : annulation en fin de periode, auteur pose dans
 * `metadata.requested_by` (A4).
 * Un palier deja actif ou une annulation deja programmee : 409 sans appel
 * Stripe (Q-3, A5). Un echec Stripe : 502 sans detail (AC10).
 */
export async function changeTier(params: {
  userId: string;
  organizationId: string;
  tier: Tier;
}): Promise<Result<ChangeTierOutcome>> {
  const read = await readAsOwner(params.userId, params.organizationId);
  if (!read.ok) return read;
  const current = read.value;

  if (params.tier === "pro") {
    if (current.tier === "pro") return fail(alreadyOnTier());
    return startCheckout(params, current.stripe_customer_id);
  }

  if (current.tier === "free" || current.cancel_at_period_end || current.stripe_subscription_id === null) {
    // stripe_subscription_id NULL sur un Pro est impossible (subscription_pro_is_backed_chk).
    return fail(alreadyOnTier());
  }
  return cancelAtPeriodEnd(params, current.stripe_subscription_id);
}

async function startCheckout(
  params: { userId: string; organizationId: string },
  customerId: string | null,
): Promise<Result<ChangeTierOutcome>> {
  const env = getServerEnv();
  const returnBase = `${env.APP_URL.replace(/\/$/, "")}/organizations/${params.organizationId}/billing`;
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: env.STRIPE_PRICE_ID_PRO, quantity: 1 }],
      client_reference_id: params.organizationId,
      subscription_data: {
        metadata: { organization_id: params.organizationId, requested_by: params.userId },
      },
      ...(customerId !== null ? { customer: customerId } : {}),
      success_url: `${returnBase}?checkout=success`,
      cancel_url: `${returnBase}?checkout=cancel`,
    });
    if (!session.url) return fail(stripeUnavailable());
    return ok({ action: "redirect_to_checkout", checkoutUrl: session.url });
  } catch (error) {
    if (isStripeError(error)) return fail(stripeUnavailable());
    throw error;
  }
}

async function cancelAtPeriodEnd(
  params: { userId: string; organizationId: string },
  subscriptionId: string,
): Promise<Result<ChangeTierOutcome>> {
  try {
    await getStripe().subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
      metadata: { requested_by: params.userId },
    });
    return ok({ action: "pending", organizationId: params.organizationId });
  } catch (error) {
    if (isStripeError(error)) return fail(stripeUnavailable());
    throw error;
  }
}
