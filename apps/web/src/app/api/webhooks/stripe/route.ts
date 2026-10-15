/**
 * Webhook Stripe (ADR-0005, ADR-0016 ; AC7, AC8 a, AC14, D-060).
 *
 * 1. Le corps brut est lu une fois et verifie (signature HMAC, tolerance 300 s)
 *    AVANT tout `JSON.parse` : un corps mal signe recoit `400
 *    INVALID_SIGNATURE`, sans echo du secret, de la signature ni du corps.
 * 2. Seuls `customer.subscription.created|updated|deleted` sont mis en file ;
 *    tout autre type signe est acquitte et ignore (D-060).
 * 3. Mise en file Inngest, identifiant de deduplication = `event.id` Stripe
 *    (AC8 a). Si la file echoue ou ne repond pas dans `QUEUE_DEADLINE_MS`, la
 *    route repond `503` (jamais `200`) pour que Stripe renvoie l'evenement
 *    (A1, D-065 regle 3).
 *
 * La route ne lit ni n'ecrit la base : seule la fonction Inngest le fait.
 */
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { invalidSignature, serviceUnavailable, type ApiError } from "@/lib/errors";
import { getServerEnv } from "@/lib/env";
import {
  inngest,
  STRIPE_SUBSCRIPTION_EVENT,
  STRIPE_SUBSCRIPTION_EVENT_TYPES,
  type StripeSubscriptionEventData,
} from "@/lib/inngest/client";
import { getStripe } from "@/lib/stripe";

/** Tolerance d'horodatage de la signature (valeur documentee de Stripe). */
const SIGNATURE_TOLERANCE_SECONDS = 300;
/** Au-dela, la route abandonne et repond 503 (« en quelques secondes », D-065). */
const QUEUE_DEADLINE_MS = 5_000;

function errorResponse(error: ApiError): NextResponse {
  return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
}

function isQueuedType(type: string): type is StripeSubscriptionEventData["type"] {
  return (STRIPE_SUBSCRIPTION_EVENT_TYPES as readonly string[]).includes(type);
}

async function sendWithDeadline(data: StripeSubscriptionEventData): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), QUEUE_DEADLINE_MS);
  });
  const sent = inngest
    .send({ id: data.stripeEventId, name: STRIPE_SUBSCRIPTION_EVENT, data })
    .then(() => true, () => false);
  try {
    return await Promise.race([sent, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      rawBody,
      signature,
      getServerEnv().STRIPE_WEBHOOK_SECRET,
      SIGNATURE_TOLERANCE_SECONDS,
    );
  } catch {
    return errorResponse(invalidSignature());
  }

  if (!isQueuedType(event.type)) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const subscription = event.data.object as { id?: unknown };
  if (typeof subscription.id !== "string" || subscription.id.length === 0) {
    // Evenement signe par Stripe mais sans abonnement : rien a relire.
    console.warn(`[facturation] evenement Stripe ${event.id} sans identifiant d'abonnement, ignore`);
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const queued = await sendWithDeadline({
    stripeEventId: event.id,
    type: event.type,
    subscriptionId: subscription.id,
    created: event.created,
  });
  if (!queued) {
    console.error(`[facturation] mise en file impossible pour l'evenement Stripe ${event.id} ; Stripe le renverra`);
    return errorResponse(serviceUnavailable());
  }
  return NextResponse.json({ received: true }, { status: 200 });
}
