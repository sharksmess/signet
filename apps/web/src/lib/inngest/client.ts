/**
 * Client Inngest de Signet (ADR-0006, ADR-0016) et contrat de l'evenement mis
 * en file par le webhook Stripe.
 *
 * Mode developpement (signature des appels a `/api/inngest` desactivee,
 * evenements envoyes a `INNGEST_DEV`) : seulement si `INNGEST_DEV` est posee,
 * ce que `env.ts` refuse avec `APP_ENV=production` (A2, AC15).
 *
 * Chaque requete sortante vers Inngest est bornee (`SEND_ATTEMPT_TIMEOUT_MS`) :
 * sans delai, un point d'entree muet suspendrait le webhook indefiniment, alors
 * qu'il doit repondre 5xx en quelques secondes pour que Stripe renvoie
 * l'evenement (A1, AC14, D-065 regle 3).
 *
 * Client construit au premier usage, comme `getStripe()` (D-079) : `next build`
 * charge les routes qui importent ce module, et une lecture de l'environnement
 * au chargement validerait tout l'environnement du serveur pendant la
 * construction. Le refus de demarrer reste assure par `instrumentation.ts`.
 */
import { Inngest } from "inngest";
import { z } from "zod";
import { getServerEnv, isInngestDevMode } from "../env";

export const SEND_ATTEMPT_TIMEOUT_MS = 2_000;

function createInngest() {
  return new Inngest({
    id: "signet",
    isDev: isInngestDevMode(getServerEnv()),
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(SEND_ATTEMPT_TIMEOUT_MS) }),
  });
}

let client: ReturnType<typeof createInngest> | null = null;

export function getInngest(): ReturnType<typeof createInngest> {
  client ??= createInngest();
  return client;
}

/** Nom de l'evenement mis en file pour `customer.subscription.created|updated|deleted` (D-060). */
export const STRIPE_SUBSCRIPTION_EVENT = "stripe/customer.subscription.changed";

export const STRIPE_SUBSCRIPTION_EVENT_TYPES = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;

/**
 * Donnees de l'evenement : le strict necessaire pour relire l'abonnement
 * aupres de Stripe (Q-2). Jamais l'objet Stripe complet : l'etat fait foi a la
 * relecture, pas dans le corps du webhook.
 */
export const stripeSubscriptionEventData = z.object({
  stripeEventId: z.string().min(1).max(255),
  type: z.enum(STRIPE_SUBSCRIPTION_EVENT_TYPES),
  subscriptionId: z.string().min(1).max(255),
  /** `created` de l'evenement Stripe, en secondes. */
  created: z.number().int().positive(),
});

export type StripeSubscriptionEventData = z.infer<typeof stripeSubscriptionEventData>;
