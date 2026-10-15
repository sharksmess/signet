/**
 * Traitement d'un evenement d'abonnement Stripe (ADR-0005, ADR-0016).
 *
 * Deux pas distincts (D-061) :
 * 1. `relire-abonnement` : relit l'abonnement aupres de l'API Stripe avec la cle
 *    secrete (Q-2 : l'evenement n'est qu'un declencheur ; l'etat relu fait foi,
 *    ce qui rend sans danger les evenements dans le desordre) ;
 * 2. `appliquer-etat` : applique cet etat en base sous `signet_billing`, par la
 *    seule fonction `signet.apply_stripe_subscription`.
 * Un echec du pas 2 est rejoue sans rappeler Stripe : le resultat du pas 1 est
 * memorise par Inngest.
 *
 * Refus definitifs (D-068, condition de l'humain) : SG003 a SG006 sont
 * journalises puis signales par `NonRetriableError`, sans nouvelle tentative
 * (AC9 a, b, f ; AC5 c). Un abonnement introuvable chez Stripe aussi. Toute
 * autre erreur (Stripe ou base indisponible) est rejouee par Inngest.
 *
 * Journal : identifiants Stripe et code de refus seulement ; jamais le corps de
 * l'evenement, l'objet Stripe ni une cle (AC9 a).
 *
 * Seul module autorise a importer `billing-db` (AC16, D-058).
 */
import { NonRetriableError } from "inngest";
import type Stripe from "stripe";
import { getServerEnv } from "../env";
import { getStripe, isStripeError } from "../stripe";
import { applyStripeSubscription, REJECTION_CODES, type ApplyStripeSubscriptionInput } from "./billing-db";
import { inngest, STRIPE_SUBSCRIPTION_EVENT, stripeSubscriptionEventData } from "./client";

type ReadOutcome = { kind: "found"; input: ApplyStripeSubscriptionInput } | { kind: "missing" };

function customerIdOf(customer: Stripe.Subscription["customer"]): string {
  return typeof customer === "string" ? customer : customer.id;
}

function isoFromEpoch(seconds: number | null | undefined): string | null {
  return typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null;
}

/** Projection de l'abonnement relu vers l'entree de la fonction definer (cles exactes, ADR-0016). */
function toApplyInput(
  event: { stripeEventId: string; type: string; created: number },
  subscription: Stripe.Subscription,
  priceIdPro: string,
): ApplyStripeSubscriptionInput {
  const items = subscription.items.data;
  const [item] = items;
  return {
    stripe_event_id: event.stripeEventId,
    occurred_at: new Date(event.created * 1000).toISOString(),
    event_type: event.type,
    stripe_subscription_id: subscription.id,
    stripe_customer_id: customerIdOf(subscription.customer),
    stripe_status: subscription.status,
    // Un seul article, au prix Pro : tout autre montage est une incoherence (SG006, D-068).
    is_pro_price: items.length === 1 && item?.price.id === priceIdPro,
    cancel_at_period_end: subscription.cancel_at_period_end,
    current_period_end: isoFromEpoch(item?.current_period_end),
    metadata_organization_id: subscription.metadata?.organization_id ?? null,
    metadata_requested_by: subscription.metadata?.requested_by ?? null,
  };
}

function logRejection(stripeEventId: string, subscriptionId: string, reason: string): void {
  console.warn(
    `[facturation] evenement Stripe ${stripeEventId} (abonnement ${subscriptionId}) traite sans effet, sans nouvelle tentative : ${reason}`,
  );
}

export const processStripeEvent = inngest.createFunction(
  { id: "process-stripe-event", triggers: { event: STRIPE_SUBSCRIPTION_EVENT } },
  async ({ event, step }) => {
    const parsed = stripeSubscriptionEventData.safeParse(event.data);
    if (!parsed.success) {
      console.warn("[facturation] evenement de file mal forme, ignore sans nouvelle tentative");
      throw new NonRetriableError("evenement de file mal forme");
    }
    const data = parsed.data;

    const read = await step.run("relire-abonnement", async (): Promise<ReadOutcome> => {
      try {
        const subscription = await getStripe().subscriptions.retrieve(data.subscriptionId);
        return { kind: "found", input: toApplyInput(data, subscription, getServerEnv().STRIPE_PRICE_ID_PRO) };
      } catch (error) {
        if (isStripeError(error) && error.code === "resource_missing") return { kind: "missing" };
        throw error;
      }
    });

    if (read.kind === "missing") {
      logRejection(data.stripeEventId, data.subscriptionId, "abonnement introuvable chez Stripe");
      throw new NonRetriableError("abonnement introuvable chez Stripe");
    }

    const outcome = await step.run("appliquer-etat", () => applyStripeSubscription(read.input));

    if (outcome.kind === "rejected") {
      logRejection(data.stripeEventId, data.subscriptionId, `${outcome.code} ${REJECTION_CODES[outcome.code]}`);
      throw new NonRetriableError(`refus definitif ${outcome.code}`);
    }
    return { stripeEventId: data.stripeEventId, result: outcome.result };
  },
);
