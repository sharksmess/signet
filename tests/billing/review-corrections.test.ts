/**
 * Tranche 002 — corrections issues des relectures (D-071) :
 * - audit-002 CRITIQUE-1 : un UUID d'organisation en majuscules ne doit ni
 *   partir tel quel chez Stripe, ni bloquer les evenements suivants (SG004) ;
 * - review-002 BLOQUANT 1 : un etat Stripe relu avant un `deleted` deja traite,
 *   rejoue plus tard, ne remet jamais l'organisation en Pro (garde monotone) ;
 * - review-002 BLOQUANT 2 : la demande d'annulation pose `canceled_by` ;
 * - review-002 3 : passage en Free decide par le statut relu (pas par le type
 *   `deleted`) ; `incomplete` depuis Pro laisse le palier inchange ;
 * - review-002 4 : POST pro refuse (409) tant qu'un abonnement est rattache ;
 * - review-002 6 : `INNGEST_EVENT_KEY` exigee hors mode developpement.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { asBypassRls, closeAllPools } from "../helpers/db";
import { createOrganizationFixture } from "../helpers/fixtures";
import {
  CHECKOUT_KEYS,
  changeTier,
  createProOrganization,
  deliverEvent,
  expectError,
  expectProcessed,
  expectStatus,
  formOf,
  programRetrieve,
  runProcessor,
  singleCaptured,
  startFakes,
  stopFakes,
  stripeEventObject,
  stripeSubscriptionObject,
  subscriptionFor,
  uniqueId,
  type Fakes,
  type MemoizedStep,
  type ProcessorOutput,
  applyServerEnvToProcess,
} from "../helpers/billing";
import {
  asBillingCommitted,
  callApply,
  closeBillingPool,
  findApplyFunction,
  readBillingEvents,
  readLinkQuota,
  readSubscriptionRow,
  setSubscriptionDirect,
  type ApplyInput,
} from "../helpers/billing-db";
import type { CapturedInngestEvent } from "./fakes/fake-inngest";

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

type StripeEvent = Record<string, unknown> & { id: string };

function makeEvent(type: string, subscription: Record<string, unknown>): StripeEvent {
  const id = uniqueId("evt_fix");
  return { ...stripeEventObject({ id, type, subscription }), id };
}

async function deliver(event: StripeEvent, label: string): Promise<CapturedInngestEvent> {
  return singleCaptured(await deliverEvent(fakes, event), fakes, label);
}

async function deliverAndProcess(event: StripeEvent, label: string): Promise<ProcessorOutput> {
  const output = await runProcessor(await deliver(event, label));
  expectProcessed(output, label);
  return output;
}

describe("audit-002 CRITIQUE-1 — UUID d'organisation en majuscules", () => {
  it("POST pro avec l'UUID en majuscules : Stripe recoit l'identifiant en minuscules (metadonnee et client_reference_id)", async () => {
    const org = await createOrganizationFixture("CRITIQUE-1 checkout");
    fakes.stripe.on("POST", "/v1/checkout/sessions", {
      status: 200,
      body: { id: "cs_test_upper", object: "checkout.session", url: "https://checkout.stripe.test/c/pay/cs_test_upper" },
    });

    const result = await changeTier(org.owner, org.organizationId.toUpperCase(), { tier: "pro" });

    expectStatus(result, 200, "POST pro, UUID en majuscules");
    const form = formOf(fakes.stripe.requestsTo("POST", "/v1/checkout/sessions")[0], "session Checkout");
    expect(form[CHECKOUT_KEYS.organizationMetadata]).toBe(org.organizationId.toLowerCase());
    expect(form[CHECKOUT_KEYS.clientReference]).toBe(org.organizationId.toLowerCase());
  });

  it("abonnement deja rattache dont la metadonnee porte l'UUID en majuscules : les evenements suivants s'appliquent (annulation puis resiliation)", async () => {
    const pro = await createProOrganization({ name: "CRITIQUE-1 evenements" });
    const upper = { organization_id: pro.org.organizationId.toUpperCase(), canceled_by: pro.org.owner.userId };
    let state = stripeSubscriptionObject({
      id: pro.subscriptionId,
      customer: pro.customerId,
      status: "active",
      cancelAtPeriodEnd: true,
      metadata: upper,
    });
    programRetrieve(fakes.stripe, pro.subscriptionId, () => state);

    await deliverAndProcess(makeEvent("customer.subscription.updated", state), "updated, metadonnee en majuscules");
    expect(await readSubscriptionRow(pro.org.organizationId)).toMatchObject({ tier: "pro", cancel_at_period_end: true });

    state = stripeSubscriptionObject({ id: pro.subscriptionId, customer: pro.customerId, status: "canceled", metadata: upper });
    await deliverAndProcess(makeEvent("customer.subscription.deleted", state), "deleted, metadonnee en majuscules");

    expect(await readSubscriptionRow(pro.org.organizationId)).toMatchObject({ tier: "free", stripe_subscription_id: null });
    expect((await readBillingEvents(pro.org.organizationId)).map((e) => e.type)).toEqual(["subscription_canceled"]);
  });
});

describe("audit-002 — SG004 journalise en erreur (D-071)", () => {
  it("metadonnee contraire a la ligne deja rattachee : refus non rejouable, journalise par console.error (et non console.warn)", async () => {
    const pro = await createProOrganization({ name: "SG004 niveau erreur" });
    const other = await createOrganizationFixture("SG004 autre organisation");
    const state = stripeSubscriptionObject({
      id: pro.subscriptionId,
      customer: pro.customerId,
      status: "active",
      metadata: { organization_id: other.organizationId },
    });
    programRetrieve(fakes.stripe, pro.subscriptionId, () => state);
    const captured = await deliver(makeEvent("customer.subscription.updated", state), "SG004");

    // Lignes copiees au fil de l'eau : `mockRestore()` efface `mock.calls`.
    const errorLines: string[] = [];
    const warnLines: string[] = [];
    const errors = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errorLines.push(args.map(String).join(" "));
    });
    const warnings = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnLines.push(args.map(String).join(" "));
    });
    let output: ProcessorOutput;
    try {
      output = await runProcessor(captured);
    } finally {
      errors.mockRestore();
      warnings.mockRestore();
    }

    expect(output.error, "refus definitif").toBeDefined();
    expect(errorLines.some((line) => line.includes("SG004")), `console.error : ${JSON.stringify(errorLines)}`).toBe(true);
    expect(warnLines.some((line) => line.includes("SG004")), "SG004 n'est pas un simple avertissement").toBe(false);
  });
});

describe("review-002 BLOQUANT 1 — garde monotone sur l'etat relu (D-071)", () => {
  it("un pas « appliquer-etat » rejoue avec un etat relu AVANT un deleted deja traite ne remet pas l'organisation en Pro", async () => {
    const pro = await createProOrganization({ name: "BLOQUANT 1 etat perime" });
    let state = subscriptionFor(pro.org, { id: pro.subscriptionId, customer: pro.customerId, status: "active" });
    programRetrieve(fakes.stripe, pro.subscriptionId, () => state);
    const stale = await deliver(makeEvent("customer.subscription.updated", state), "updated (relu actif)");
    const apply = await findApplyFunction();

    // 1. `updated` relit « active », puis son ecriture echoue (privilege retire).
    await asBypassRls((client) => client.query(`REVOKE EXECUTE ON FUNCTION ${apply.signature} FROM signet_billing`));
    let failed: ProcessorOutput;
    try {
      failed = await runProcessor(stale);
    } finally {
      await asBypassRls((client) => client.query(`GRANT EXECUTE ON FUNCTION ${apply.signature} TO signet_billing`));
    }
    expect(failed.error, "l'ecriture du premier passage echoue").toBeDefined();

    // 2. Stripe resilie l'abonnement ; `deleted` est traite en entier.
    state = subscriptionFor(pro.org, { id: pro.subscriptionId, customer: pro.customerId, status: "canceled" });
    await deliverAndProcess(makeEvent("customer.subscription.deleted", state), "deleted");
    expect(await readSubscriptionRow(pro.org.organizationId)).toMatchObject({ tier: "free" });

    // 3. Inngest rejoue le pas en echec de `updated` avec l'etat relu memorise (« active »).
    const memoized: MemoizedStep[] = [];
    for (const [id, promise] of Object.entries(failed.state)) {
      const settled = await promise.then(
        (value) => ({ ok: true as const, value }),
        () => ({ ok: false as const }),
      );
      if (settled.ok) memoized.push({ id, idIsHashed: true, handler: () => settled.value });
    }
    expect(memoized.length, "le pas de relecture est memorise").toBeGreaterThanOrEqual(1);
    const replayed = await runProcessor(stale, { steps: memoized });

    expectProcessed(replayed, "rejeu de l'etat perime");
    expect(await readSubscriptionRow(pro.org.organizationId)).toMatchObject({ tier: "free", stripe_subscription_id: null });
    expect(await readLinkQuota(pro.org.organizationId)).toBe(50);
    expect((await readBillingEvents(pro.org.organizationId)).map((e) => e.type), "aucun faux subscription_started").toEqual([
      "subscription_canceled",
    ]);
  });
});

describe("review-002 BLOQUANT 2 — auteur de l'annulation (D-071)", () => {
  it("POST free pose metadata.canceled_by = l'owner (en plus de requested_by, AC3 a)", async () => {
    const pro = await createProOrganization({ name: "BLOQUANT 2 canceled_by" });
    fakes.stripe.on("POST", `/v1/subscriptions/${pro.subscriptionId}`, {
      status: 200,
      body: stripeSubscriptionObject({ id: pro.subscriptionId, customer: pro.customerId, status: "active", cancelAtPeriodEnd: true }),
    });

    const result = await changeTier(pro.org.owner, pro.org.organizationId, { tier: "free" });

    expectStatus(result, 200, "POST free");
    const form = formOf(fakes.stripe.requestsTo("POST", `/v1/subscriptions/${pro.subscriptionId}`)[0], "modification");
    expect(form["metadata[canceled_by]"]).toBe(pro.org.owner.userId);
  });
});

describe("review-002 3 — correspondance des statuts (D-071, Q-8)", () => {
  it("evenement deleted dont l'etat relu est encore actif : aucun passage en Free (le statut relu fait foi)", async () => {
    const pro = await createProOrganization({ name: "review 3 deleted actif" });
    const state = subscriptionFor(pro.org, { id: pro.subscriptionId, customer: pro.customerId, status: "active" });
    programRetrieve(fakes.stripe, pro.subscriptionId, () => state);

    await deliverAndProcess(makeEvent("customer.subscription.deleted", state), "deleted relu actif");

    expect(await readSubscriptionRow(pro.org.organizationId)).toMatchObject({ tier: "pro", status: "active" });
    expect(await readBillingEvents(pro.org.organizationId)).toEqual([]);
  });

  it("incomplete depuis un Pro : palier inchange (pro), status incomplete, aucun billing_event", async () => {
    const pro = await createProOrganization({ name: "review 3 incomplete pro" });
    const state = subscriptionFor(pro.org, { id: pro.subscriptionId, customer: pro.customerId, status: "incomplete" });
    programRetrieve(fakes.stripe, pro.subscriptionId, () => state);

    await deliverAndProcess(makeEvent("customer.subscription.updated", state), "incomplete depuis Pro");

    expect(await readSubscriptionRow(pro.org.organizationId)).toMatchObject({ tier: "pro", status: "incomplete" });
    expect(await readLinkQuota(pro.org.organizationId)).toBeNull();
    expect(await readBillingEvents(pro.org.organizationId)).toEqual([]);
  });
});

describe("review-002 4 — abonnement incomplete rattache a un Free (D-071)", () => {
  it("POST pro sur un Free dont un abonnement incomplete est rattache -> 409 ALREADY_ON_TIER, aucun appel Stripe", async () => {
    const org = await createOrganizationFixture("review 4 incomplete");
    await setSubscriptionDirect(org.organizationId, {
      tier: "free",
      status: "incomplete",
      stripeCustomerId: uniqueId("cus_r4"),
      stripeSubscriptionId: uniqueId("sub_r4"),
    });
    const before = await readSubscriptionRow(org.organizationId);

    const result = await changeTier(org.owner, org.organizationId, { tier: "pro" });

    expectError(result, 409, "ALREADY_ON_TIER", "POST pro, abonnement incomplete rattache");
    expect(fakes.stripe.requests).toEqual([]);
    expect(await readSubscriptionRow(org.organizationId)).toEqual(before);
  });
});

describe("review-002 6 — INNGEST_EVENT_KEY hors mode developpement", () => {
  const production: Record<string, string | undefined> = {
    APP_ENV: "production",
    DATABASE_URL_APP: "postgresql://signet_app@localhost:5432/signet_env_check",
    DATABASE_URL_AUTH: "postgresql://signet_auth@localhost:5432/signet_env_check",
    DATABASE_URL_BILLING: "postgresql://signet_billing@localhost:5432/signet_env_check",
    BETTER_AUTH_SECRET: "env-check-better-auth-secret-0000000000000001",
    BETTER_AUTH_URL: "http://localhost:3100",
    APP_URL: "http://localhost:3100",
    STRIPE_SECRET_KEY: "sk_test_valeur_inventee_pour_le_schema",
    STRIPE_WEBHOOK_SECRET: "whsec_valeur_inventee_pour_le_schema",
    STRIPE_PRICE_ID_PRO: "price_valeur_inventee",
    INNGEST_SIGNING_KEY: "signkey-test-0123456789abcdef0123456789abcdef",
    INNGEST_EVENT_KEY: "event-key-valeur-inventee",
  };

  it("production sans INNGEST_EVENT_KEY -> refus, message nommant la variable sans valeur (temoin : avec la cle, accepte)", async () => {
    const { parseServerEnv } = await import("../../apps/web/src/lib/env");
    expect(() => parseServerEnv(production), "temoin : environnement complet accepte").not.toThrow();

    const withoutKey = { ...production };
    delete withoutKey.INNGEST_EVENT_KEY;
    let message = "";
    try {
      parseServerEnv(withoutKey);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("INNGEST_EVENT_KEY");
    expect(message).not.toContain("signkey-test");
    expect(message).not.toContain("sk_test_");
  });
});

describe("D-072 — garde monotone, tests directs en base (sous signet_billing)", () => {
  function input(overrides: Partial<ApplyInput> & Pick<ApplyInput, "stripe_subscription_id" | "metadata_organization_id">): ApplyInput {
    return {
      stripe_event_id: uniqueId("evt_guard"),
      stripe_read_at: new Date().toISOString(),
      occurred_at: new Date(Date.now() - 60_000).toISOString(),
      event_type: "customer.subscription.updated",
      stripe_customer_id: uniqueId("cus_guard"),
      stripe_status: "active",
      is_pro_price: true,
      cancel_at_period_end: false,
      current_period_end: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString(),
      metadata_requested_by: null,
      ...overrides,
    };
  }

  async function apply(value: ApplyInput): Promise<void> {
    const fn = await findApplyFunction();
    await asBillingCommitted({}, (client) => callApply(client, fn, value));
  }

  async function applyResult(value: ApplyInput): Promise<string> {
    const fn = await findApplyFunction();
    return asBillingCommitted({}, async (client) => {
      const { rows } = await client.query<{ result: string }>(`SELECT ${fn.qualifiedName}($1::jsonb) AS result`, [
        JSON.stringify(value),
      ]);
      return rows[0]?.result ?? "";
    });
  }

  it("marque egale a la derniere appliquee : l'etat s'applique (comparaison stricte), il n'est pas `stale`", async () => {
    const pro = await createProOrganization({ name: "D-072 egalite" });
    const readAt = new Date(Date.now() - 1_000).toISOString();
    const base = { stripe_subscription_id: pro.subscriptionId, stripe_customer_id: pro.customerId, metadata_organization_id: pro.org.organizationId };
    await apply(input({ ...base, stripe_read_at: readAt }));

    const result = await applyResult(input({ ...base, stripe_read_at: readAt, cancel_at_period_end: true }));

    expect(result).toBe("updated");
    expect(await readSubscriptionRow(pro.org.organizationId)).toMatchObject({ tier: "pro", cancel_at_period_end: true });
  });

  it("etat perime d'un AUTRE abonnement que celui rattache : `stale` est rendu avant le controle de coherence (pas de SG006)", async () => {
    const pro = await createProOrganization({ name: "D-072 stale avant SG006" });
    await apply(input({
      stripe_subscription_id: pro.subscriptionId,
      stripe_customer_id: pro.customerId,
      metadata_organization_id: pro.org.organizationId,
    }));
    const before = await readSubscriptionRow(pro.org.organizationId);

    const result = await applyResult(input({
      stripe_subscription_id: uniqueId("sub_other"),
      stripe_customer_id: pro.customerId,
      metadata_organization_id: pro.org.organizationId,
      stripe_read_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }));

    expect(result).toBe("stale");
    expect(await readSubscriptionRow(pro.org.organizationId)).toEqual(before);
    expect(await readBillingEvents(pro.org.organizationId)).toEqual([]);
  });

  it("plus de borne haute (D-077) : une marque lointaine dans le futur est acceptee par la fonction", async () => {
    const pro = await createProOrganization({ name: "D-077 sans borne" });

    const result = await applyResult(input({
      stripe_subscription_id: pro.subscriptionId,
      stripe_customer_id: pro.customerId,
      metadata_organization_id: pro.org.organizationId,
      stripe_read_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      cancel_at_period_end: true,
    }));

    expect(result).toBe("updated");
  });
});

describe("D-077 — marque prise sur l'horloge de la base, pas sur celle du serveur", () => {
  it("serveur en avance d'une heure : son etat relu « actif », rejoue apres une resiliation plus recente, ne remet pas l'organisation en Pro", async () => {
    const pro = await createProOrganization({ name: "D-077 horloge en avance" });
    let state = subscriptionFor(pro.org, { id: pro.subscriptionId, customer: pro.customerId, status: "active" });
    programRetrieve(fakes.stripe, pro.subscriptionId, () => state);
    const early = await deliver(makeEvent("customer.subscription.updated", state), "updated (serveur en avance)");
    const apply = await findApplyFunction();

    // 1. Le serveur qui traite `updated` a une heure d'avance ; son ecriture echoue.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 60 * 60 * 1000 });
    await asBypassRls((client) => client.query(`REVOKE EXECUTE ON FUNCTION ${apply.signature} FROM signet_billing`));
    let failed: ProcessorOutput;
    try {
      failed = await runProcessor(early);
    } finally {
      vi.useRealTimers();
      await asBypassRls((client) => client.query(`GRANT EXECUTE ON FUNCTION ${apply.signature} TO signet_billing`));
    }
    expect(failed.error, "l'ecriture du premier passage echoue").toBeDefined();

    // 2. Stripe resilie l'abonnement ; `deleted` est traite par un serveur a l'heure.
    state = subscriptionFor(pro.org, { id: pro.subscriptionId, customer: pro.customerId, status: "canceled" });
    await deliverAndProcess(makeEvent("customer.subscription.deleted", state), "deleted");
    expect(await readSubscriptionRow(pro.org.organizationId)).toMatchObject({ tier: "free" });

    // 3. Rejeu du pas memorise de `updated` : sa marque vient de la base (anterieure), il est `stale`.
    const memoized: MemoizedStep[] = [];
    const memoizedValues: unknown[] = [];
    for (const [id, promise] of Object.entries(failed.state)) {
      const settled = await promise.then(
        (value) => ({ ok: true as const, value }),
        () => ({ ok: false as const }),
      );
      if (settled.ok) {
        memoized.push({ id, idIsHashed: true, handler: () => settled.value });
        memoizedValues.push(settled.value);
      }
    }
    const readAt = JSON.stringify(memoizedValues).match(/"stripe_read_at":"([^"]+)"/)?.[1];
    expect(readAt, "marque memorisee par le pas de relecture").toBeDefined();
    expect(new Date(readAt ?? "").getTime(), "la marque vient de l'horloge de la base, pas du serveur en avance").toBeLessThan(
      Date.now() + 60_000,
    );

    const replayed = await runProcessor(early, { steps: memoized });

    expectProcessed(replayed, "rejeu de l'etat du serveur en avance");
    expect(await readSubscriptionRow(pro.org.organizationId)).toMatchObject({ tier: "free", stripe_subscription_id: null });
    expect((await readBillingEvents(pro.org.organizationId)).map((e) => e.type)).toEqual(["subscription_canceled"]);
  });
});

describe("D-077 — evenement abandonne par Inngest journalise en erreur", () => {
  it("la fonction declare onFailure, et reportAbandonedEvent journalise en erreur l'evenement Stripe, l'abonnement et l'execution, sans le corps", async () => {
    applyServerEnvToProcess();
    const { processStripeEvent, reportAbandonedEvent } = await import("../../apps/web/src/lib/inngest/process-stripe-event");
    expect(processStripeEvent.opts.onFailure, "crochet onFailure declare").toBeTypeOf("function");

    const lines: string[] = [];
    const errors = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    try {
      reportAbandonedEvent(
        { data: { stripeEventId: "evt_abandon_1", type: "customer.subscription.updated", subscriptionId: "sub_abandon_1", created: 1_790_000_000 } },
        "01HRUNABANDON",
        { name: "Error" },
      );
    } finally {
      errors.mockRestore();
    }

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("evt_abandon_1");
    expect(lines[0]).toContain("sub_abandon_1");
    expect(lines[0]).toContain("01HRUNABANDON");
    expect(lines[0]).toContain("ABANDONNE");
    expect(lines[0], "jamais le corps de l'evenement").not.toContain("1790000000");
  });
});

describe("D-072 — limite de concurrence Inngest par abonnement", () => {
  it("la fonction n'execute qu'un pas a la fois par abonnement Stripe (cle = champ subscriptionId de l'evenement)", async () => {
    applyServerEnvToProcess();
    const { processStripeEvent } = await import("../../apps/web/src/lib/inngest/process-stripe-event");
    const { stripeSubscriptionEventData } = await import("../../apps/web/src/lib/inngest/client");

    expect(processStripeEvent.opts.concurrency).toEqual({ key: "event.data.subscriptionId", limit: 1 });
    expect(Object.keys(stripeSubscriptionEventData.shape), "la cle vise un champ reel de l'evenement").toContain("subscriptionId");
  });
});
