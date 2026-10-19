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
 * autre erreur (Stripe ou base indisponible) est rejouee par Inngest ; si elle
 * persiste apres les relances, l'evenement est abandonne et journalise en erreur
 * par `reportAbandonedEvent` (`onFailure`, D-077).
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
import { applyStripeSubscription, databaseNow, REJECTION_CODES, type ApplyStripeSubscriptionInput } from "./billing-db";
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
  readAt: string,
): ApplyStripeSubscriptionInput {
  const items = subscription.items.data;
  const [item] = items;
  // Statuts qui menent a Free (D-071, Q-8) : la seule transition possible est
  // alors `subscription_canceled`, dont l'auteur est `canceled_by`, pose par la
  // demande d'annulation de l'owner. Une resiliation par Stripe seul n'en a pas :
  // auteur NULL (AC3 e). Sinon (debut d'abonnement), l'auteur est `requested_by`,
  // pose au Checkout (AC2 c).
  const leavesPro = subscription.status === "canceled" || subscription.status === "incomplete_expired";
  const author = leavesPro ? subscription.metadata?.canceled_by : subscription.metadata?.requested_by;
  return {
    stripe_event_id: event.stripeEventId,
    stripe_read_at: readAt,
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
    metadata_requested_by: author ?? null,
  };
}

/**
 * Journal d'un refus definitif. SG004 (metadonnee d'organisation contraire a la
 * ligne deja rattachee) signale une incoherence a examiner, pas un cas attendu :
 * niveau erreur (audit-002, D-071). Les autres refus sont des avertissements.
 */
function logRejection(stripeEventId: string, subscriptionId: string, reason: string, level: "error" | "warn" = "warn"): void {
  const message = `[facturation] evenement Stripe ${stripeEventId} (abonnement ${subscriptionId}) traite sans effet, sans nouvelle tentative : ${reason}`;
  if (level === "error") console.error(message);
  else console.warn(message);
}

/**
 * Evenement abandonne par Inngest (D-077) : appele quand la fonction echoue pour
 * de bon, apres ses relances (3 par pas, defaut du SDK) ou sur un refus non
 * rejouable. Niveau erreur, identifiant de l'evenement Stripe et de l'execution,
 * nom de l'erreur ; jamais le corps de l'evenement ni le message complet d'une
 * erreur de base ou de Stripe (AC9 a). Exportee pour etre testee directement.
 */
export function reportAbandonedEvent(originalEvent: { data?: unknown }, runId: string, error: { name?: string }): void {
  const parsed = stripeSubscriptionEventData.safeParse(originalEvent.data);
  const stripeEventId = parsed.success ? parsed.data.stripeEventId : "inconnu (donnees mal formees)";
  const subscriptionId = parsed.success ? parsed.data.subscriptionId : "inconnu";
  console.error(
    `[facturation] evenement Stripe ${stripeEventId} (abonnement ${subscriptionId}) ABANDONNE apres les tentatives d'Inngest (execution ${runId}, erreur ${error.name ?? "inconnue"}) : etat non applique, a reprendre a la main`,
  );
}

export const processStripeEvent = inngest.createFunction(
  {
    id: "process-stripe-event",
    triggers: { event: STRIPE_SUBSCRIPTION_EVENT },
    onFailure: ({ event, error }) => {
      reportAbandonedEvent(event.data.event, event.data.run_id, error);
    },
    // Un seul pas a la fois par abonnement Stripe (D-072) : ferme la fenetre ou
    // deux executions concurrentes du meme abonnement s'entrecroisent. Inngest
    // limite les pas en cours, pas les executions en attente de relance : le
    // rejeu d'un etat memorise reste couvert par la garde monotone (0013).
    concurrency: { key: "event.data.subscriptionId", limit: 1 },
  },
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
        // Instant de la relecture, pris APRES la reponse de Stripe et sur l'horloge
        // de la BASE (D-077), commune a toutes les instances : la garde monotone
        // (D-071) refuse un etat relu avant le dernier applique.
        const readAt = await databaseNow();
        return { kind: "found", input: toApplyInput(data, subscription, getServerEnv().STRIPE_PRICE_ID_PRO, readAt) };
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
      logRejection(
        data.stripeEventId,
        data.subscriptionId,
        `${outcome.code} ${REJECTION_CODES[outcome.code]}`,
        outcome.code === "SG004" ? "error" : "warn",
      );
      throw new NonRetriableError(`refus definitif ${outcome.code}`);
    }
    if (outcome.result === "stale") {
      console.info(
        `[facturation] evenement Stripe ${data.stripeEventId} (abonnement ${data.subscriptionId}) : etat relu plus ancien que le dernier applique, ignore (D-071)`,
      );
    }
    return { stripeEventId: data.stripeEventId, result: outcome.result };
  },
);
