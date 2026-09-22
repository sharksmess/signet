import { z } from "zod";
import { ApiContract, Uuid } from "./_contract";

const Tier = z.enum(["free", "pro"]);
const SubscriptionStatus = z.enum(["active", "past_due", "canceled", "incomplete"]);

/**
 * US-08.1 — consultation du palier courant, owner uniquement (US-08.2).
 * Forme alignee sur `subscription` (ERD §8.1) : pas de champ "pendingTier"
 * local — par ADR-0005 l'etat n'existe que via `tier`/`status`, reflets du
 * webhook Stripe le plus recent. `status` distingue un Pro `past_due` (reste
 * Pro tant que Stripe ne l'a pas resilie) d'un Pro `active`.
 */
const getSubscriptionInput = z.object({
  organizationId: Uuid,
});

const getSubscriptionOutput = z.object({
  organizationId: Uuid,
  tier: Tier,
  status: SubscriptionStatus,
  cancelAtPeriodEnd: z.boolean(),
  /** null sur le palier Free (ERD : subscription_free_has_no_period). */
  currentPeriodEnd: z.string().datetime().nullable(),
});

export const getSubscription: ApiContract<
  typeof getSubscriptionInput,
  typeof getSubscriptionOutput
> = {
  route: "/api/organizations/:organizationId/subscription",
  method: "GET",
  minRole: "owner",
  input: getSubscriptionInput,
  output: getSubscriptionOutput,
  errors: [
    { status: 401, code: "UNAUTHENTICATED", trigger: "aucune session valide" },
    { status: 404, code: "ORGANIZATION_NOT_FOUND", trigger: "organizationId inexistant, ou appelant non membre" },
    { status: 403, code: "INSUFFICIENT_ROLE", trigger: "appelant membre mais role = member (US-08.2)" },
  ],
  idempotency: "idempotente par nature : lecture seule.",
};

/**
 * US-08.1 — changement de palier. Par ADR-0005, l'etat local n'est PAS
 * modifie de maniere synchrone : cette route declenche l'appel Stripe et
 * retourne un accuse d'engagement, l'etat visible (tier/status) ne change
 * qu'apres traitement du webhook correspondant, qui seul ecrit l'evenement
 * du journal (US-08.3). Deux effets distincts selon le sens du changement,
 * car ce sont deux operations Stripe differentes :
 * - Free -> Pro : aucun abonnement Stripe n'existe encore (ERD : Free n'a
 *   pas de stripe_subscription_id) -> reponse "redirect_to_checkout", l'owner
 *   complete le paiement sur une session Stripe Checkout.
 * - Pro -> Free : l'abonnement Stripe existe -> reponse "pending", l'appel a
 *   directement modifie/annule l'abonnement existant via l'API Stripe.
 */
const changeTierInput = z.object({
  organizationId: Uuid,
  tier: Tier,
});

const changeTierOutput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("redirect_to_checkout"), checkoutUrl: z.string().url() }),
  z.object({ action: z.literal("pending"), organizationId: Uuid }),
]);

export const changeTier: ApiContract<typeof changeTierInput, typeof changeTierOutput> = {
  route: "/api/organizations/:organizationId/subscription",
  method: "POST",
  minRole: "owner",
  input: changeTierInput,
  output: changeTierOutput,
  errors: [
    { status: 401, code: "UNAUTHENTICATED", trigger: "aucune session valide" },
    { status: 404, code: "ORGANIZATION_NOT_FOUND", trigger: "organizationId inexistant, ou appelant non membre" },
    { status: 403, code: "INSUFFICIENT_ROLE", trigger: "appelant membre mais role = member (US-08.2)" },
    { status: 502, code: "STRIPE_UNAVAILABLE", trigger: "l'appel a l'API Stripe echoue (timeout, 5xx) — aucun etat local modifie" },
  ],
  idempotency:
    "non-idempotente : chaque appel declenche un nouvel appel Stripe (nouvelle session Checkout, ou nouvelle modification de l'abonnement existant). Aucune garde applicative locale contre les doublons — le schema (ERD §8.1) ne materialise aucun etat 'changement en attente' : ADR-0002 montre le cout d'une telle colonne si elle devait rester correcte sous concurrence, et rien dans le PRD ne justifie ce cout ici (un seul owner agit, charge negligeable). Si un doublon d'appel Stripe devient un probleme reel, la solution est l'en-tete Idempotency-Key standard de Stripe, pas un compteur local.",
};

/**
 * Webhook Stripe (ADR-0005, ADR-0006). Idempotent par construction : la cle
 * de deduplication est l'identifiant d'evenement Stripe (`event.id`), pas le
 * contenu. C'est ce webhook, et lui seul, qui ecrit le journal d'evenements
 * factures (US-08.3).
 */
const stripeWebhookInput = z.object({
  /** Payload brut requis pour la verification de signature — jamais parse avant verification. */
  rawBody: z.string(),
  signature: z.string(),
});

const stripeWebhookOutput = z.object({
  received: z.literal(true),
});

export const stripeWebhook: ApiContract<typeof stripeWebhookInput, typeof stripeWebhookOutput> = {
  route: "/api/webhooks/stripe",
  method: "POST",
  minRole: "public",
  input: stripeWebhookInput,
  output: stripeWebhookOutput,
  errors: [
    { status: 400, code: "INVALID_SIGNATURE", trigger: "signature absente ou ne correspondant pas au secret webhook configure — payload rejete avant tout traitement" },
  ],
  idempotency:
    "idempotente sur event.id (identifiant d'evenement Stripe) : un evenement deja traite est acquitte (200) sans reappliquer son effet ni redupliquer l'ecriture du journal.",
};
