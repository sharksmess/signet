/**
 * Helpers de la tranche 002 (abonnement et palier) : environnement, doublures,
 * signature des webhooks, constructeurs d'objets Stripe, client HTTP des routes
 * et execution de la fonction Inngest dans le processus de test.
 *
 * Messages d'echec : tout helper qui attend un statut HTTP affiche le VRAI code
 * recu et le corps BRUT complet (texte d'abord, JSON ensuite), jamais un
 * « undefined » qui ferait chercher un bug serveur qui n'existe pas.
 *
 * Variables lues (noms seulement, valeurs jamais affichees) : voir `billingEnv`.
 */
import { createHmac, randomUUID } from "node:crypto";
import type { InngestTestEngine } from "@inngest/test";
import { vi } from "vitest";
import { loadTestEnv, requireEnv } from "../_factory/env";
import { authHeaders, baseUrl, type AuthenticatedSession } from "./auth";
import { FakeStripe, type RecordedStripeRequest } from "../billing/fakes/fake-stripe";
import { FakeInngest, type CapturedInngestEvent } from "../billing/fakes/fake-inngest";
import { setSubscriptionDirect } from "./billing-db";
import { createOrganizationFixture, type OrganizationFixture } from "./fixtures";

loadTestEnv();

// ---------------------------------------------------------------------------
// Environnement
// ---------------------------------------------------------------------------

export interface BillingEnv {
  webhookSecret: string;
  stripeSecretKey: string;
  priceIdPro: string;
  appUrl: string;
  fakeStripePort: number;
  fakeInngestPort: number;
}

function portOf(url: string, label: string): number {
  const port = Number(new URL(url).port);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`[tests] ${label} ne designe aucun port explicite.`);
  }
  return port;
}

/**
 * Lit l'environnement de la tranche et verifie que le serveur de test est bien
 * raccorde aux doublures : un faux sur le port X alors que le serveur parle au
 * port Y ferait echouer tous les tests avec des symptomes sans rapport.
 */
export function billingEnv(): BillingEnv {
  const env = requireEnv([
    "TEST_STRIPE_WEBHOOK_SECRET",
    "TEST_FAKE_STRIPE_PORT",
    "TEST_FAKE_INNGEST_PORT",
    "TEST_SERVER_ENV_STRIPE_SECRET_KEY",
    "TEST_SERVER_ENV_STRIPE_PRICE_ID_PRO",
    "TEST_SERVER_ENV_STRIPE_API_BASE_URL",
    "TEST_SERVER_ENV_INNGEST_DEV",
    "TEST_SERVER_ENV_APP_URL",
    "TEST_SERVER_ENV_STRIPE_WEBHOOK_SECRET",
  ]);
  const fakeStripePort = Number(env.TEST_FAKE_STRIPE_PORT);
  const fakeInngestPort = Number(env.TEST_FAKE_INNGEST_PORT);
  if (portOf(env.TEST_SERVER_ENV_STRIPE_API_BASE_URL, "TEST_SERVER_ENV_STRIPE_API_BASE_URL") !== fakeStripePort) {
    throw new Error("[tests] TEST_SERVER_ENV_STRIPE_API_BASE_URL ne vise pas le port TEST_FAKE_STRIPE_PORT.");
  }
  if (portOf(env.TEST_SERVER_ENV_INNGEST_DEV, "TEST_SERVER_ENV_INNGEST_DEV") !== fakeInngestPort) {
    throw new Error("[tests] TEST_SERVER_ENV_INNGEST_DEV ne vise pas le port TEST_FAKE_INNGEST_PORT.");
  }
  if (env.TEST_STRIPE_WEBHOOK_SECRET !== env.TEST_SERVER_ENV_STRIPE_WEBHOOK_SECRET) {
    throw new Error(
      "[tests] TEST_STRIPE_WEBHOOK_SECRET et TEST_SERVER_ENV_STRIPE_WEBHOOK_SECRET doivent avoir la meme valeur " +
        "(secret de test invente partage par la suite et le serveur).",
    );
  }
  return {
    webhookSecret: env.TEST_STRIPE_WEBHOOK_SECRET,
    stripeSecretKey: env.TEST_SERVER_ENV_STRIPE_SECRET_KEY,
    priceIdPro: env.TEST_SERVER_ENV_STRIPE_PRICE_ID_PRO,
    appUrl: env.TEST_SERVER_ENV_APP_URL,
    fakeStripePort,
    fakeInngestPort,
  };
}

/**
 * Reproduit dans le processus de test l'environnement que le globalSetup donne
 * au serveur (TEST_SERVER_ENV_X -> X) : la fonction Inngest s'execute ICI et lit
 * process.env. La connexion `signet_billing` vient de TEST_DATABASE_URL_BILLING.
 */
export function applyServerEnvToProcess(): void {
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("TEST_SERVER_ENV_") || value === undefined) continue;
    const name = key.slice("TEST_SERVER_ENV_".length);
    if (process.env[name] === undefined) process.env[name] = value;
  }
  process.env.DATABASE_URL_BILLING = requireEnv(["TEST_DATABASE_URL_BILLING"]).TEST_DATABASE_URL_BILLING;
}

// ---------------------------------------------------------------------------
// Doublures
// ---------------------------------------------------------------------------

export interface Fakes {
  stripe: FakeStripe;
  inngest: FakeInngest;
}

export async function startFakes(): Promise<Fakes> {
  const env = billingEnv();
  const stripe = await FakeStripe.start(env.fakeStripePort);
  try {
    const inngest = await FakeInngest.start(env.fakeInngestPort);
    return { stripe, inngest };
  } catch (error) {
    await stripe.stop();
    throw error;
  }
}

export async function stopFakes(fakes: Fakes | undefined): Promise<void> {
  await Promise.all([fakes?.stripe.stop(), fakes?.inngest.stop()]);
}

// ---------------------------------------------------------------------------
// Identifiants de test (uniques : aucun test ne depend d'un autre)
// ---------------------------------------------------------------------------

export function uniqueId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

// ---------------------------------------------------------------------------
// Signature Stripe (node:crypto, jamais le SDK : D-059)
// ---------------------------------------------------------------------------

/** HMAC-SHA256 de `${t}.${corps}` en hexadecimal (schema documente de Stripe). */
export function stripeSignature(rawBody: string, secret: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

export function stripeSignatureHeader(
  rawBody: string,
  options?: { secret?: string; timestamp?: number },
): string {
  const timestamp = options?.timestamp ?? Math.floor(Date.now() / 1000);
  const secret = options?.secret ?? billingEnv().webhookSecret;
  return `t=${timestamp},v1=${stripeSignature(rawBody, secret, timestamp)}`;
}

// ---------------------------------------------------------------------------
// Objets Stripe
// ---------------------------------------------------------------------------

export interface StripeSubscriptionInput {
  id: string;
  customer: string;
  status: string;
  /** Epoch en secondes. */
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  priceId?: string;
  metadata?: Record<string, string>;
  created?: number;
}

/**
 * Abonnement tel que l'API Stripe le rend. La fin de periode figure au niveau
 * de l'abonnement ET de ses lignes (selon la version d'API, l'une ou l'autre
 * est lue) : le faux n'impose pas a l'implementation un choix de version.
 */
export function stripeSubscriptionObject(input: StripeSubscriptionInput): Record<string, unknown> {
  const periodEnd = input.currentPeriodEnd ?? Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  const priceId = input.priceId ?? billingEnv().priceIdPro;
  return {
    id: input.id,
    object: "subscription",
    customer: input.customer,
    status: input.status,
    cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
    current_period_end: periodEnd,
    created: input.created ?? Math.floor(Date.now() / 1000) - 600,
    metadata: input.metadata ?? {},
    items: {
      object: "list",
      has_more: false,
      url: `/v1/subscription_items?subscription=${input.id}`,
      data: [
        {
          id: `si_${input.id}`,
          object: "subscription_item",
          quantity: 1,
          current_period_end: periodEnd,
          current_period_start: periodEnd - 30 * 24 * 3600,
          price: { id: priceId, object: "price", active: true },
        },
      ],
    },
  };
}

export function stripeEventObject(params: {
  id: string;
  type: string;
  subscription: Record<string, unknown>;
  /** Epoch en secondes. */
  created?: number;
}): Record<string, unknown> {
  return {
    id: params.id,
    object: "event",
    type: params.type,
    created: params.created ?? Math.floor(Date.now() / 1000) - 120,
    livemode: false,
    pending_webhooks: 1,
    data: { object: params.subscription },
  };
}

/** Programme la relecture `GET /v1/subscriptions/:id` du faux Stripe (l'etat rendu peut changer d'un appel a l'autre). */
export function programRetrieve(
  stripe: FakeStripe,
  subscriptionId: string,
  produce: () => Record<string, unknown>,
): void {
  stripe.on("GET", `/v1/subscriptions/${subscriptionId}`, () => ({ status: 200, body: produce() }));
}

export function retrieveCount(stripe: FakeStripe): number {
  return stripe.requestsTo("GET", /^\/v1\/subscriptions\/[^/]+$/).length;
}

// ---------------------------------------------------------------------------
// Reponses HTTP : corps brut conserve
// ---------------------------------------------------------------------------

export interface HttpResult {
  status: number;
  /** Corps brut complet. */
  text: string;
  /** Corps decode si c'est du JSON, sinon le texte brut ; `undefined` si le corps est vide. */
  body: unknown;
}

export async function readResponse(response: Response): Promise<HttpResult> {
  const text = await response.text();
  if (text.length === 0) return { status: response.status, text, body: undefined };
  try {
    return { status: response.status, text, body: JSON.parse(text) };
  } catch {
    return { status: response.status, text, body: text };
  }
}

/** Echoue avec le vrai statut et le corps brut complet si le statut differe. */
export function expectStatus(result: HttpResult, expected: number, label: string): void {
  if (result.status !== expected) {
    throw new Error(`${label} : HTTP ${result.status} recu, ${expected} attendu. Corps brut : ${result.text}`);
  }
}

export function codeOf(result: HttpResult): string | undefined {
  const body = result.body;
  if (typeof body === "object" && body !== null && "code" in body && typeof body.code === "string") return body.code;
  return undefined;
}

/** Echoue avec le corps brut si le code d'erreur applicatif differe. */
export function expectError(result: HttpResult, status: number, code: string, label: string): void {
  expectStatus(result, status, label);
  if (codeOf(result) !== code) {
    throw new Error(`${label} : code ${JSON.stringify(codeOf(result))} recu, ${JSON.stringify(code)} attendu. Corps brut : ${result.text}`);
  }
}

function field(body: unknown, key: string): unknown {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>)[key] : undefined;
}

export function bodyField(result: HttpResult, key: string): unknown {
  return field(result.body, key);
}

// ---------------------------------------------------------------------------
// Routes d'abonnement
// ---------------------------------------------------------------------------

function subscriptionUrl(organizationId: string): string {
  return `${baseUrl()}/api/organizations/${organizationId}/subscription`;
}

export async function getSubscription(
  session: AuthenticatedSession | null,
  organizationId: string,
): Promise<HttpResult> {
  const response = await fetch(subscriptionUrl(organizationId), {
    method: "GET",
    headers: session ? authHeaders(session) : { "Content-Type": "application/json" },
  });
  return readResponse(response);
}

/** `payload` est serialise en JSON ; une chaine est envoyee telle quelle (corps non JSON). */
export async function changeTier(
  session: AuthenticatedSession | null,
  organizationId: string,
  payload: Record<string, unknown> | string,
  options?: { signal?: AbortSignal },
): Promise<HttpResult> {
  const response = await fetch(subscriptionUrl(organizationId), {
    method: "POST",
    headers: session ? authHeaders(session) : { "Content-Type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
    signal: options?.signal,
  });
  return readResponse(response);
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

export async function postWebhook(
  rawBody: string,
  headers?: Record<string, string>,
  options?: { signal?: AbortSignal },
): Promise<HttpResult> {
  const response = await fetch(`${baseUrl()}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: rawBody,
    signal: options?.signal,
  });
  return readResponse(response);
}

/** Poste l'evenement signe avec le secret de test (ou celui fourni). */
export async function postSignedEvent(
  event: Record<string, unknown>,
  options?: { secret?: string; timestamp?: number; signal?: AbortSignal },
): Promise<HttpResult> {
  const rawBody = JSON.stringify(event);
  return postWebhook(
    rawBody,
    { "Stripe-Signature": stripeSignatureHeader(rawBody, options) },
    { signal: options?.signal },
  );
}

/**
 * Poste un evenement signe, exige `200 { received: true }`, et renvoie les
 * evenements Inngest enregistres par le faux pour cet evenement Stripe.
 */
export async function deliverEvent(
  fakes: Fakes,
  event: Record<string, unknown> & { id: string },
): Promise<CapturedInngestEvent[]> {
  const result = await postSignedEvent(event);
  expectStatus(result, 200, `webhook ${String(event.type)} ${event.id}`);
  if (field(result.body, "received") !== true) {
    throw new Error(`webhook ${event.id} : corps inattendu, { received: true } attendu. Corps brut : ${result.text}`);
  }
  return fakes.inngest.eventsMentioning(event.id);
}

// ---------------------------------------------------------------------------
// Fonction Inngest executee dans le processus de test (@inngest/test)
// ---------------------------------------------------------------------------

/**
 * Fonction de `apps/web/src/lib/inngest/process-stripe-event.ts`, construite
 * par `getProcessStripeEvent()` au premier usage (D-079) : l'environnement du
 * serveur doit etre pose AVANT cet appel, qui le valide.
 */
export async function loadProcessorEngine(): Promise<InngestTestEngine> {
  applyServerEnvToProcess();
  const { InngestTestEngine: Engine } = await import("@inngest/test");
  const { getProcessStripeEvent } = await import("../../apps/web/src/lib/inngest/process-stripe-event");
  return new Engine({ function: getProcessStripeEvent() });
}

/** Sortie d'une execution de la fonction (sous-ensemble de ce que rend `InngestTestEngine.execute`). */
export interface ProcessorOutput {
  /** Valeur retournee par la fonction si elle a abouti. */
  result?: unknown;
  /** Erreur (serialisee) si la fonction a echoue. */
  error?: unknown;
  /** Sorties des pas reussis, indexees par identifiant de pas hache. */
  state: Record<string, Promise<unknown>>;
}

/** Pas memorise fourni a une nouvelle execution (comportement d'Inngest lors d'un rejeu). */
export interface MemoizedStep {
  id: string;
  idIsHashed?: boolean;
  handler: () => unknown;
}

/** Execute la fonction pour l'evenement capture (un moteur neuf par execution : aucun cache de mocks partage). */
export async function runProcessor(
  event: CapturedInngestEvent,
  options?: { steps?: MemoizedStep[] },
): Promise<ProcessorOutput> {
  const engine = await loadProcessorEngine();
  return engine.execute({ events: [event], steps: options?.steps });
}

export function errorName(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "name" in error && typeof error.name === "string"
    ? error.name
    : undefined;
}

export function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

/** Termine sans erreur, ou par une erreur non rejouable (NonRetriableError) : aucune nouvelle tentative. */
export function expectNoRetry(output: ProcessorOutput, label: string): void {
  if (output.error === undefined) return;
  if (errorName(output.error) !== "NonRetriableError") {
    throw new Error(
      `${label} : la fonction a echoue avec une erreur REJOUABLE (${errorName(output.error) ?? "?"} : ` +
        `${errorMessage(output.error)}) ; une erreur non rejouable ou une fin normale etait attendue.`,
    );
  }
}

/** Echoue avec le message reel si l'execution a leve. */
export function expectProcessed(output: ProcessorOutput, label: string): void {
  if (output.error !== undefined) {
    throw new Error(`${label} : la fonction a echoue (${errorName(output.error) ?? "?"} : ${errorMessage(output.error)}).`);
  }
}

/** Evenement capture unique pour un evenement Stripe : echoue sinon, avec ce que le faux a recu. */
export function singleCaptured(captured: CapturedInngestEvent[], fakes: Fakes, label: string): CapturedInngestEvent {
  const [first] = captured;
  if (captured.length < 1 || !first) {
    throw new Error(`${label} : aucun evenement transmis au faux Inngest. Corps bruts recus : ${JSON.stringify(fakes.inngest.rawBodies)}`);
  }
  return first;
}

// ---------------------------------------------------------------------------
// Capture des journaux du processus de test
// ---------------------------------------------------------------------------

export interface LogCapture {
  text(): string;
  restore(): void;
}

/** Capture ce que le code ecrit sur console.* et sur stdout/stderr pendant un bloc. */
export function captureLogs(): LogCapture {
  const chunks: string[] = [];
  const record = (...args: unknown[]): void => {
    chunks.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  const spies = [
    vi.spyOn(console, "log").mockImplementation(record),
    vi.spyOn(console, "info").mockImplementation(record),
    vi.spyOn(console, "warn").mockImplementation(record),
    vi.spyOn(console, "error").mockImplementation(record),
    vi.spyOn(console, "debug").mockImplementation(record),
  ];
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  });
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  });
  return {
    text: () => chunks.join("\n"),
    restore: () => {
      for (const spy of [...spies, stdout, stderr]) spy.mockRestore();
    },
  };
}

// ---------------------------------------------------------------------------
// Divers
// ---------------------------------------------------------------------------

/** Cle de formulaire du SDK Stripe pour la metadonnee d'une creation d'abonnement par Checkout. */
export const CHECKOUT_KEYS = {
  mode: "mode",
  price: "line_items[0][price]",
  quantity: "line_items[0][quantity]",
  clientReference: "client_reference_id",
  organizationMetadata: "subscription_data[metadata][organization_id]",
  requestedByMetadata: "subscription_data[metadata][requested_by]",
  customer: "customer",
  successUrl: "success_url",
  cancelUrl: "cancel_url",
} as const;

export function formOf(request: RecordedStripeRequest | undefined, label: string): Record<string, string> {
  if (!request) throw new Error(`${label} : la requete attendue n'a pas ete recue par le faux Stripe.`);
  return request.form;
}

// ---------------------------------------------------------------------------
// Organisations de depart
// ---------------------------------------------------------------------------

export interface ProFixture {
  org: OrganizationFixture;
  subscriptionId: string;
  customerId: string;
  periodEnd: Date;
}

/**
 * Organisation reelle (creee par l'API) amenee a Pro par ecriture directe
 * (arrangement, sous administration) : abonnement Stripe `subscriptionId`
 * rattache, client `customerId`.
 */
export async function createProOrganization(options?: {
  name?: string;
  cancelAtPeriodEnd?: boolean;
}): Promise<ProFixture> {
  const org = await createOrganizationFixture(options?.name ?? "Organisation Pro");
  const subscriptionId = uniqueId("sub_test");
  const customerId = uniqueId("cus_test");
  const periodEnd = new Date(Date.now() + 20 * 24 * 3600 * 1000);
  periodEnd.setMilliseconds(0);
  await setSubscriptionDirect(org.organizationId, {
    tier: "pro",
    status: "active",
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: options?.cancelAtPeriodEnd ?? false,
  });
  return { org, subscriptionId, customerId, periodEnd };
}

/** Abonnement Stripe relu pour une organisation : metadonnees posees comme le fait notre serveur au Checkout. */
export function subscriptionFor(
  org: OrganizationFixture,
  base: Omit<StripeSubscriptionInput, "metadata"> & { metadata?: Record<string, string> },
): Record<string, unknown> {
  return stripeSubscriptionObject({
    ...base,
    metadata: {
      organization_id: org.organizationId,
      requested_by: org.owner.userId,
      ...base.metadata,
    },
  });
}
