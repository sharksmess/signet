/**
 * Tranche 002 — consultation de l'abonnement (GET) : AC1, AC4 (GET), AC5 (a, GET),
 * AC11 (GET). La partie « apres traitement d'un abonnement Pro » d'AC1 est dans
 * processing.test.ts (elle exige la fonction Inngest).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { closeAllPools, asTenant } from "../helpers/db";
import { addMemberDirect, createOrganizationFixture, createTwoOrganizationsFixture } from "../helpers/fixtures";
import { signUp } from "../helpers/auth";
import {
  bodyField,
  expectError,
  expectStatus,
  getSubscription,
  startFakes,
  stopFakes,
  type Fakes,
} from "../helpers/billing";
import {
  closeBillingPool,
  insertBillingEventDirect,
  readBillingEvents,
  readSubscriptionRow,
  setSubscriptionDirect,
} from "../helpers/billing-db";

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

describe("AC1 — consultation (US-08.1)", () => {
  it("AC1 : l'owner d'une organisation neuve obtient 200 free / active / cancelAtPeriodEnd false / currentPeriodEnd null", async () => {
    const org = await createOrganizationFixture("AC1 Organisation neuve");

    const result = await getSubscription(org.owner, org.organizationId);

    expectStatus(result, 200, "GET subscription (organisation neuve)");
    expect(result.body).toMatchObject({
      organizationId: org.organizationId,
      tier: "free",
      status: "active",
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
    });
    expect(fakes.stripe.requests, "une consultation n'appelle jamais Stripe").toEqual([]);
  });

  it("AC1 : un Pro dont l'annulation est programmee est restitue avec cancelAtPeriodEnd true et sa fin de periode", async () => {
    const org = await createOrganizationFixture("AC1 Pro programme");
    const periodEnd = new Date(Date.now() + 10 * 24 * 3600 * 1000);
    periodEnd.setMilliseconds(0);
    await setSubscriptionDirect(org.organizationId, {
      tier: "pro",
      stripeCustomerId: `cus_ac1_${randomUUID().slice(0, 8)}`,
      stripeSubscriptionId: `sub_ac1_${randomUUID().slice(0, 8)}`,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: true,
    });

    const result = await getSubscription(org.owner, org.organizationId);

    expectStatus(result, 200, "GET subscription (Pro programme)");
    expect(result.body).toMatchObject({ tier: "pro", status: "active", cancelAtPeriodEnd: true });
    expect(new Date(String(bodyField(result, "currentPeriodEnd"))).getTime()).toBe(periodEnd.getTime());
  });
});

describe("AC4 — permission insuffisante (US-08.2), lecture", () => {
  it("AC4 : un member (non owner) recoit 403 INSUFFICIENT_ROLE sur GET, sans appel Stripe ni changement en base", async () => {
    const org = await createOrganizationFixture("AC4 GET member");
    const member = await signUp();
    await addMemberDirect({ organizationId: org.organizationId, userId: member.userId, role: "member" });
    const before = await readSubscriptionRow(org.organizationId);

    const result = await getSubscription(member, org.organizationId);

    expectError(result, 403, "INSUFFICIENT_ROLE", "GET subscription par un member");
    expect(fakes.stripe.requests).toEqual([]);
    expect(await readSubscriptionRow(org.organizationId)).toEqual(before);
    expect(await readBillingEvents(org.organizationId)).toEqual([]);
  });

  it("AC4 : sous signet_app avec le contexte du member, subscription et billing_event de son organisation renvoient 0 ligne (l'owner, lui, les voit)", async () => {
    const org = await createOrganizationFixture("AC4 RLS member");
    const member = await signUp();
    await addMemberDirect({ organizationId: org.organizationId, userId: member.userId, role: "member" });
    // Temoin positif : une ligne de journal existe, l'owner la voit.
    await insertBillingEventDirect({
      organizationId: org.organizationId,
      stripeEventId: `evt_ac4_${randomUUID().slice(0, 12)}`,
      actorUserId: org.owner.userId,
    });

    const asOwner = await asTenant(
      { organizationId: org.organizationId, userId: org.owner.userId },
      async (client) => ({
        subscription: (await client.query("SELECT 1 FROM subscription WHERE organization_id = $1", [org.organizationId])).rowCount,
        events: (await client.query("SELECT 1 FROM billing_event WHERE organization_id = $1", [org.organizationId])).rowCount,
      }),
    );
    expect(asOwner, "temoin positif : l'owner voit sa ligne subscription et son evenement").toEqual({
      subscription: 1,
      events: 1,
    });

    const asMember = await asTenant(
      { organizationId: org.organizationId, userId: member.userId },
      async (client) => ({
        subscription: (await client.query("SELECT 1 FROM subscription WHERE organization_id = $1", [org.organizationId])).rows,
        events: (await client.query("SELECT 1 FROM billing_event WHERE organization_id = $1", [org.organizationId])).rows,
      }),
    );
    expect(asMember).toEqual({ subscription: [], events: [] });
  });
});

describe("AC5 (a) — isolation tenant, lecture", () => {
  it("AC5 (a) : l'owner de A qui lit l'abonnement de B recoit 404 ORGANIZATION_NOT_FOUND, identique a un UUID inexistant", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const before = await readSubscriptionRow(orgB.organizationId);

    const foreign = await getSubscription(orgA.owner, orgB.organizationId);
    const unknown = await getSubscription(orgA.owner, randomUUID());

    expectError(foreign, 404, "ORGANIZATION_NOT_FOUND", "GET subscription de B par l'owner de A");
    expectError(unknown, 404, "ORGANIZATION_NOT_FOUND", "GET subscription d'un UUID inexistant");
    expect(foreign.body, "la reponse ne doit pas distinguer « autre tenant » de « inexistant »").toEqual(unknown.body);
    expect(fakes.stripe.requests).toEqual([]);
    expect(await readSubscriptionRow(orgB.organizationId)).toEqual(before);
  });
});

describe("AC11 — validation et authentification, lecture", () => {
  it("AC11 : organizationId non UUID -> 422 VALIDATION_FAILED sur GET", async () => {
    const org = await createOrganizationFixture("AC11 GET uuid");

    const result = await getSubscription(org.owner, "pas-un-uuid");

    expectError(result, 422, "VALIDATION_FAILED", "GET subscription avec un identifiant non UUID");
  });

  it("AC11 : sans session -> 401 UNAUTHENTICATED sur GET", async () => {
    const org = await createOrganizationFixture("AC11 GET sans session");

    const result = await getSubscription(null, org.organizationId);

    expectError(result, 401, "UNAUTHENTICATED", "GET subscription sans session");
  });
});
