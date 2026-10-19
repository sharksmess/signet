/**
 * Tranche 002 — demande de changement de palier (POST) : AC2 (a, b), AC3 (a),
 * AC4 (POST), AC5 (a, POST), AC10, AC11 (POST), AC17, D-062.
 *
 * ADR-0005 : aucun test ne verifie le NOUVEAU palier juste apres l'appel de
 * l'owner. Apres un POST, seules sont verifiees les assertions « l'etat n'a pas
 * change » (AC2 b, AC3 a) : l'etat ne change qu'au traitement de l'evenement
 * (processing.test.ts).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { closeAllPools } from "../helpers/db";
import { addMemberDirect, createOrganizationFixture, createTwoOrganizationsFixture } from "../helpers/fixtures";
import { signUp } from "../helpers/auth";
import {
  CHECKOUT_KEYS,
  billingEnv,
  bodyField,
  changeTier,
  createProOrganization,
  expectError,
  expectStatus,
  formOf,
  getSubscription,
  startFakes,
  stopFakes,
  stripeSubscriptionObject,
  type Fakes,
} from "../helpers/billing";
import {
  closeBillingPool,
  readBillingEvents,
  readSubscriptionRow,
  setSubscriptionDirect,
} from "../helpers/billing-db";
import type { FakeStripe } from "./fakes/fake-stripe";

let fakes: Fakes;

beforeAll(async () => {
  fakes = await startFakes();
});

beforeEach(() => {
  fakes.stripe.reset();
  fakes.inngest.reset();
});

afterAll(async () => {
  await stopFakes(fakes);
  await closeBillingPool();
  await closeAllPools();
});

const CHECKOUT_URL = "https://checkout.stripe.test/c/pay/cs_test_fake_session";

function programCheckout(stripe: FakeStripe): void {
  stripe.on("POST", "/v1/checkout/sessions", {
    status: 200,
    body: { id: "cs_test_fake_session", object: "checkout.session", mode: "subscription", url: CHECKOUT_URL },
  });
  // Tolerance : l'implementation peut creer le client Stripe avant la session.
  stripe.on("POST", "/v1/customers", { status: 200, body: { id: "cus_test_fake_created", object: "customer" } });
}

function programCancelAtPeriodEnd(stripe: FakeStripe, subscriptionId: string, customerId: string): void {
  stripe.on("POST", `/v1/subscriptions/${subscriptionId}`, {
    status: 200,
    body: stripeSubscriptionObject({ id: subscriptionId, customer: customerId, status: "active", cancelAtPeriodEnd: true }),
  });
  stripe.on("GET", `/v1/subscriptions/${subscriptionId}`, {
    status: 200,
    body: stripeSubscriptionObject({ id: subscriptionId, customer: customerId, status: "active" }),
  });
}

describe("AC2 — Free -> Pro par Checkout (US-08.1)", () => {
  it("AC2 (a) : POST pro par l'owner d'une organisation Free -> 200 redirect_to_checkout, une seule session Checkout aux bons parametres", async () => {
    const env = billingEnv();
    const org = await createOrganizationFixture("AC2 Free vers Pro");
    programCheckout(fakes.stripe);

    const result = await changeTier(org.owner, org.organizationId, { tier: "pro" });

    expectStatus(result, 200, "POST subscription pro");
    expect(result.body).toEqual({ action: "redirect_to_checkout", checkoutUrl: CHECKOUT_URL });

    const sessions = fakes.stripe.requestsTo("POST", "/v1/checkout/sessions");
    expect(sessions, "exactement une creation de session Checkout").toHaveLength(1);
    const form = formOf(sessions[0], "creation de session Checkout");
    expect(form[CHECKOUT_KEYS.mode]).toBe("subscription");
    expect(form[CHECKOUT_KEYS.price]).toBe(env.priceIdPro);
    expect(form[CHECKOUT_KEYS.clientReference]).toBe(org.organizationId);
    expect(form[CHECKOUT_KEYS.organizationMetadata]).toBe(org.organizationId);
    expect(form[CHECKOUT_KEYS.requestedByMetadata]).toBe(org.owner.userId);
    expect(form[CHECKOUT_KEYS.successUrl]?.startsWith(env.appUrl), "URL de retour derivee de APP_URL").toBe(true);
    expect(form[CHECKOUT_KEYS.cancelUrl]?.startsWith(env.appUrl), "URL d'annulation derivee de APP_URL").toBe(true);
  });

  it("AC2 (b) : immediatement apres le POST, GET renvoie toujours free et billing_event est vide pour l'organisation (ADR-0005)", async () => {
    const org = await createOrganizationFixture("AC2 etat inchange");
    programCheckout(fakes.stripe);

    expectStatus(await changeTier(org.owner, org.organizationId, { tier: "pro" }), 200, "POST subscription pro");

    const after = await getSubscription(org.owner, org.organizationId);
    expectStatus(after, 200, "GET subscription apres POST");
    expect(bodyField(after, "tier")).toBe("free");
    expect(await readBillingEvents(org.organizationId)).toEqual([]);
    const row = await readSubscriptionRow(org.organizationId);
    expect(row).toMatchObject({ tier: "free", stripe_subscription_id: null });
  });

  it("D-062 : le client Stripe deja enregistre est reutilise au Checkout suivant (parametre customer)", async () => {
    const org = await createOrganizationFixture("D-062 client conserve");
    const customerId = `cus_d062_${randomUUID().slice(0, 8)}`;
    await setSubscriptionDirect(org.organizationId, { tier: "free", stripeCustomerId: customerId });
    programCheckout(fakes.stripe);

    expectStatus(await changeTier(org.owner, org.organizationId, { tier: "pro" }), 200, "POST subscription pro");

    const sessions = fakes.stripe.requestsTo("POST", "/v1/checkout/sessions");
    expect(sessions).toHaveLength(1);
    expect(formOf(sessions[0], "creation de session Checkout")[CHECKOUT_KEYS.customer]).toBe(customerId);
    expect(fakes.stripe.requestsTo("POST", "/v1/customers"), "aucun nouveau client Stripe n'est cree").toEqual([]);
  });
});

describe("AC3 (a) — Pro -> Free : annulation en fin de periode (US-08.1)", () => {
  it("AC3 (a) : POST free par l'owner d'un Pro -> 200 pending ; Stripe recoit cancel_at_period_end=true et requested_by, aucune suppression ; GET renvoie toujours pro", async () => {
    const pro = await createProOrganization({ name: "AC3 annulation" });
    programCancelAtPeriodEnd(fakes.stripe, pro.subscriptionId, pro.customerId);

    const result = await changeTier(pro.org.owner, pro.org.organizationId, { tier: "free" });

    expectStatus(result, 200, "POST subscription free");
    expect(result.body).toEqual({ action: "pending", organizationId: pro.org.organizationId });

    const updates = fakes.stripe.requestsTo("POST", `/v1/subscriptions/${pro.subscriptionId}`);
    expect(updates, "une modification de l'abonnement").toHaveLength(1);
    const form = formOf(updates[0], "modification de l'abonnement");
    expect(form["cancel_at_period_end"]).toBe("true");
    expect(form["metadata[requested_by]"]).toBe(pro.org.owner.userId);
    expect(
      fakes.stripe.requestsTo("DELETE", `/v1/subscriptions/${pro.subscriptionId}`),
      "pas de suppression immediate de l'abonnement",
    ).toEqual([]);

    const after = await getSubscription(pro.org.owner, pro.org.organizationId);
    expectStatus(after, 200, "GET subscription apres POST");
    expect(bodyField(after, "tier"), "ADR-0005 : le palier ne change qu'apres le webhook").toBe("pro");
    expect(await readBillingEvents(pro.org.organizationId)).toEqual([]);
  });
});

describe("AC4 — permission insuffisante (US-08.2), modification", () => {
  it.each([["pro"], ["free"]] as const)(
    "AC4 : un member (non owner) recoit 403 INSUFFICIENT_ROLE sur POST %s, aucun appel Stripe, rien ne change",
    async (tier) => {
      const pro = await createProOrganization({ name: `AC4 POST ${tier}` });
      const member = await signUp();
      await addMemberDirect({ organizationId: pro.org.organizationId, userId: member.userId, role: "member" });
      programCheckout(fakes.stripe);
      programCancelAtPeriodEnd(fakes.stripe, pro.subscriptionId, pro.customerId);
      const before = await readSubscriptionRow(pro.org.organizationId);

      const result = await changeTier(member, pro.org.organizationId, { tier });

      expectError(result, 403, "INSUFFICIENT_ROLE", `POST ${tier} par un member`);
      expect(fakes.stripe.requests, "aucun appel au faux Stripe").toEqual([]);
      expect(await readSubscriptionRow(pro.org.organizationId)).toEqual(before);
      expect(await readBillingEvents(pro.org.organizationId)).toEqual([]);
    },
  );
});

describe("AC5 (a) — isolation tenant, modification", () => {
  it("AC5 (a) : l'owner de A qui fait POST sur l'organisation B recoit 404 ORGANIZATION_NOT_FOUND, identique a un UUID inexistant, sans appel Stripe", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    programCheckout(fakes.stripe);
    const before = await readSubscriptionRow(orgB.organizationId);

    const foreign = await changeTier(orgA.owner, orgB.organizationId, { tier: "pro" });
    const unknown = await changeTier(orgA.owner, randomUUID(), { tier: "pro" });

    expectError(foreign, 404, "ORGANIZATION_NOT_FOUND", "POST pro sur l'organisation de B");
    expectError(unknown, 404, "ORGANIZATION_NOT_FOUND", "POST pro sur un UUID inexistant");
    expect(foreign.body, "reponse indistinguable de l'organisation inexistante").toEqual(unknown.body);
    expect(fakes.stripe.requests).toEqual([]);
    expect(await readSubscriptionRow(orgB.organizationId)).toEqual(before);
    expect(await readBillingEvents(orgB.organizationId)).toEqual([]);
  });
});

describe("AC10 — Stripe indisponible", () => {
  const MARKER = "detail-interne-stripe-ne-doit-jamais-fuiter";

  function expectNoLeak(text: string): void {
    const env = billingEnv();
    expect(text, "aucun detail Stripe dans la reponse").not.toContain(MARKER);
    expect(text, "aucune cle Stripe dans la reponse").not.toContain(env.stripeSecretKey);
    expect(text).not.toMatch(/sk_(test|live)_/);
  }

  it("AC10 : Free -> Pro, Stripe repond 500 -> 502 STRIPE_UNAVAILABLE, etat et journal inchanges", async () => {
    const org = await createOrganizationFixture("AC10 500 checkout");
    fakes.stripe.on("POST", /^\/v1\//, { status: 500, body: { error: { type: "api_error", message: MARKER } } });
    const before = await readSubscriptionRow(org.organizationId);

    const result = await changeTier(org.owner, org.organizationId, { tier: "pro" });

    expectError(result, 502, "STRIPE_UNAVAILABLE", "POST pro, Stripe en 500");
    expectNoLeak(result.text);
    expect(await readSubscriptionRow(org.organizationId)).toEqual(before);
    expect(await readBillingEvents(org.organizationId)).toEqual([]);
  });

  it("AC10 : Pro -> Free, Stripe repond 500 -> 502 STRIPE_UNAVAILABLE, etat et journal inchanges", async () => {
    const pro = await createProOrganization({ name: "AC10 500 annulation" });
    const stripeReply = { status: 500, body: { error: { type: "api_error", message: MARKER } } };
    fakes.stripe.on("POST", /^\/v1\//, stripeReply);
    fakes.stripe.on("GET", /^\/v1\//, stripeReply);
    const before = await readSubscriptionRow(pro.org.organizationId);

    const result = await changeTier(pro.org.owner, pro.org.organizationId, { tier: "free" });

    expectError(result, 502, "STRIPE_UNAVAILABLE", "POST free, Stripe en 500");
    expectNoLeak(result.text);
    expect(await readSubscriptionRow(pro.org.organizationId)).toEqual(before);
    expect(await readBillingEvents(pro.org.organizationId)).toEqual([]);
  });

  /**
   * « Ne repond pas dans le delai » : le faux ne repond jamais. L'implementation
   * doit borner l'appel par un delai (le delai par defaut du SDK, 80 s, depasse
   * celui du test), retries compris.
   */
  it("AC10 : Stripe ne repond pas dans le delai -> 502 STRIPE_UNAVAILABLE, etat et journal inchanges", async () => {
    const org = await createOrganizationFixture("AC10 delai");
    fakes.stripe.on("POST", /^\/v1\//, { status: 200, body: {}, delayMs: 10 * 60 * 1000 });
    const before = await readSubscriptionRow(org.organizationId);

    const result = await changeTier(org.owner, org.organizationId, { tier: "pro" }, { signal: AbortSignal.timeout(50_000) });

    expectError(result, 502, "STRIPE_UNAVAILABLE", "POST pro, Stripe muet");
    expectNoLeak(result.text);
    expect(await readSubscriptionRow(org.organizationId)).toEqual(before);
    expect(await readBillingEvents(org.organizationId)).toEqual([]);
  }, 60_000);
});

describe("AC11 — validation et authentification, modification", () => {
  it("AC11 : organizationId non UUID -> 422 VALIDATION_FAILED sur POST", async () => {
    const org = await createOrganizationFixture("AC11 POST uuid");

    const result = await changeTier(org.owner, "pas-un-uuid", { tier: "pro" });

    expectError(result, 422, "VALIDATION_FAILED", "POST avec un identifiant non UUID");
    expect(fakes.stripe.requests).toEqual([]);
  });

  it.each([
    ["tier absent", {}],
    ["tier hors enum", { tier: "enterprise" }],
    ["tier d'un mauvais type", { tier: 1 }],
  ])("AC11 : %s -> 422 VALIDATION_FAILED, aucun appel Stripe", async (_label, payload) => {
    const org = await createOrganizationFixture("AC11 POST corps");

    const result = await changeTier(org.owner, org.organizationId, payload);

    expectError(result, 422, "VALIDATION_FAILED", `POST avec le corps ${JSON.stringify(payload)}`);
    expect(fakes.stripe.requests).toEqual([]);
  });

  it("AC11 : corps non JSON -> 422 VALIDATION_FAILED, aucun appel Stripe", async () => {
    const org = await createOrganizationFixture("AC11 POST non JSON");

    const result = await changeTier(org.owner, org.organizationId, "ceci { n'est pas du JSON");

    expectError(result, 422, "VALIDATION_FAILED", "POST avec un corps non JSON");
    expect(fakes.stripe.requests).toEqual([]);
  });

  it("AC11 : sans session -> 401 UNAUTHENTICATED sur POST, aucun appel Stripe", async () => {
    const org = await createOrganizationFixture("AC11 POST sans session");

    const result = await changeTier(null, org.organizationId, { tier: "pro" });

    expectError(result, 401, "UNAUTHENTICATED", "POST sans session");
    expect(fakes.stripe.requests).toEqual([]);
  });
});

describe("AC17 — 409 ALREADY_ON_TIER (Q-3, A5)", () => {
  it("AC17 : POST free sur une organisation Free -> 409 ALREADY_ON_TIER, aucun appel Stripe, rien ne change", async () => {
    const org = await createOrganizationFixture("AC17 free sur free");
    const before = await readSubscriptionRow(org.organizationId);

    const result = await changeTier(org.owner, org.organizationId, { tier: "free" });

    expectError(result, 409, "ALREADY_ON_TIER", "POST free sur Free");
    expect(fakes.stripe.requests).toEqual([]);
    expect(await readSubscriptionRow(org.organizationId)).toEqual(before);
    expect(await readBillingEvents(org.organizationId)).toEqual([]);
  });

  it.each([
    ["annulation non programmee", false],
    ["annulation programmee", true],
  ])("AC17 : POST pro sur une organisation Pro (%s) -> 409 ALREADY_ON_TIER, aucun appel Stripe, rien ne change", async (_label, cancelAtPeriodEnd) => {
    const pro = await createProOrganization({ name: "AC17 pro sur pro", cancelAtPeriodEnd });
    const before = await readSubscriptionRow(pro.org.organizationId);

    const result = await changeTier(pro.org.owner, pro.org.organizationId, { tier: "pro" });

    expectError(result, 409, "ALREADY_ON_TIER", "POST pro sur Pro");
    expect(fakes.stripe.requests).toEqual([]);
    expect(await readSubscriptionRow(pro.org.organizationId)).toEqual(before);
    expect(await readBillingEvents(pro.org.organizationId)).toEqual([]);
  });

  it("AC17 : POST free sur un Pro dont cancelAtPeriodEnd est deja true -> 409 ALREADY_ON_TIER, aucun appel Stripe, rien ne change", async () => {
    const pro = await createProOrganization({ name: "AC17 free sur pro programme", cancelAtPeriodEnd: true });
    const before = await readSubscriptionRow(pro.org.organizationId);

    const result = await changeTier(pro.org.owner, pro.org.organizationId, { tier: "free" });

    expectError(result, 409, "ALREADY_ON_TIER", "POST free sur Pro deja programme");
    expect(fakes.stripe.requests).toEqual([]);
    expect(await readSubscriptionRow(pro.org.organizationId)).toEqual(before);
    expect(await readBillingEvents(pro.org.organizationId)).toEqual([]);
  });
});
