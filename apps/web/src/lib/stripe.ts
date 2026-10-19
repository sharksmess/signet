/**
 * Client Stripe du serveur (ADR-0015). Seul module qui construit le SDK.
 *
 * Delai et relances (D-067) : 10 s par appel et une seule relance. Le delai par
 * defaut du SDK (80 s) laisserait une requete owner suspendue bien au-dela de
 * ce qu'elle peut attendre ; au pire, un appel coute ~20 s avant `502
 * STRIPE_UNAVAILABLE` (AC10).
 *
 * `STRIPE_API_BASE_URL` (APP_ENV=test seulement, garde dans `env.ts`) raccorde
 * le SDK au faux Stripe des tests (D-059) ; absente, le SDK parle a Stripe.
 *
 * Imports relatifs : charge par la fonction Inngest dans le processus de test.
 */
import Stripe from "stripe";
import { getServerEnv } from "./env";

export const STRIPE_TIMEOUT_MS = 10_000;
export const STRIPE_MAX_NETWORK_RETRIES = 1;

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (client) return client;
  const env = getServerEnv();
  const config: Stripe.StripeConfig = {
    timeout: STRIPE_TIMEOUT_MS,
    maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
  };
  if (env.STRIPE_API_BASE_URL !== undefined) {
    const base = new URL(env.STRIPE_API_BASE_URL);
    config.host = base.hostname;
    config.port = base.port;
    config.protocol = base.protocol === "http:" ? "http" : "https";
  }
  client = new Stripe(env.STRIPE_SECRET_KEY, config);
  return client;
}

/** Erreur de l'API Stripe (reseau, delai, 4xx, 5xx), par opposition a un bug local. */
export function isStripeError(error: unknown): error is Stripe.errors.StripeError {
  return error instanceof Stripe.errors.StripeError;
}
