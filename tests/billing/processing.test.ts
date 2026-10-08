/**
 * Tranche 002 — traitement des evenements Stripe par la fonction Inngest :
 * AC1 (apres traitement), AC2 (c), AC3 (b, c, d, e), AC5 (c), AC8 (b, c, d, e),
 * AC9 (a a f).
 *
 * Chaine exercee de bout en bout, sans service externe (D-059) : l'evenement est
 * signe par le test, poste a la route webhook reelle (serveur de test), capture
 * par le faux Inngest, puis la fonction est executee DANS CE PROCESSUS par
 * @inngest/test contre la base de test reelle et le faux Stripe (relecture de
 * l'abonnement). Le faux Stripe est la source de verite de l'etat relu (Q-2).
 *
 * ADR-0005 : l'etat n'est verifie qu'APRES le traitement de l'evenement.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { asBypassRls, closeAllPools } from "../helpers/db";
import { createOrganizationFixture, createTwoOrganizationsFixture } from "../helpers/fixtures";
import { signUp } from "../helpers/auth";
import {
  billingEnv,
  bodyField,
  captureLogs,
  createProOrganization,
  deliverEvent,
  expectNoRetry,
  expectProcessed,
  expectStatus,
  getSubscription,
  programRetrieve,
  retrieveCount,
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
} from "../helpers/billing";
import {
  closeBillingPool,
  findApplyFunction,
  readBillingEvents,
  readLinkCount,
  readLinkQuota,
  readSubscriptionRow,
  setSubscriptionDirect,
} from "../helpers/billing-db";
import type { CapturedInngestEvent } from "./fakes/fake-inngest";
import type { OrganizationFixture } from "../helpers/fixtures";

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

const epoch = (date: Date): number => Math.floor(date.getTime() / 1000);

type StripeEvent = Record<string, unknown> & { id: string };

function makeEvent(type: string, subscription: Record<string, unknown>, created?: number): StripeEvent {
  const id = uniqueId("evt_proc");
  return { ...stripeEventObject({ id, type, subscription, created }), id };
}

/** Poste l'evenement au webhook reel et renvoie l'evenement Inngest capture. */
async function deliver(event: StripeEvent, label: string): Promise<CapturedInngestEvent> {
  const captured = await deliverEvent(fakes, event);
  return singleCaptured(captured, fakes, label);
}

/** Poste puis execute la fonction ; echoue avec le message reel si elle a leve. */
async function deliverAndProcess(event: StripeEvent, label: string): Promise<ProcessorOutput> {
  const captured = await deliver(event, label);
  const output = await runProcessor(captured);
  expectProcessed(output, label);
  return output;
}

async function setLinkCount(organizationId: string, count: number): Promise<void> {
  await asBypassRls(async (client) => {
    const result = await client.query("UPDATE organization_link_usage SET link_count = $2 WHERE organization_id = $1", [
      organizationId,
      count,
    ]);
    expect(result.rowCount, "fixture : link_count force").toBe(1);
  });
}

/** Un utilisateur reel, puis supprime : son identifiant n'existe plus. */
async function deletedUserId(): Promise<string> {
  const user = await signUp();
  await asBypassRls(async (client) => {
    const result = await client.query("DELETE FROM app_user WHERE id = $1", [user.userId]);
    expect(result.rowCount, "fixture : suppression de l'utilisateur").toBe(1);
  });
  return user.userId;
}

describe("AC1 — consultation apres traitement d'un abonnement Pro", () => {
  it("AC1 : apres traitement d'un abonnement Pro actif, GET renvoie pro / active et la fin de periode fournie par le faux Stripe", async () => {
    const org = await createOrganizationFixture("AC1 apres traitement");
    const subscriptionId = uniqueId("sub_ac1");
    const periodEnd = new Date(Date.now() + 25 * 24 * 3600 * 1000);
    periodEnd.setMilliseconds(0);
    const stripeState = subscriptionFor(org, {
      id: subscriptionId,
      customer: uniqueId("cus_ac1"),
      status: "active",
      currentPeriodEnd: epoch(periodEnd),
    });
    programRetrieve(fakes.stripe, subscriptionId, () => stripeState);

    await deliverAndProcess(makeEvent("customer.subscription.created", stripeState), "AC1 created");

    const result = await getSubscription(org.owner, org.organizationId);
    expectStatus(result, 200, "GET subscription apres traitement");
    expect(result.body).toMatchObject({ organizationId: org.organizationId, tier: "pro", status: "active" });
    expect(new Date(String(bodyField(result, "currentPeriodEnd"))).getTime()).toBe(periodEnd.getTime());
  });
});

describe("AC2 (c) — Free -> Pro confirme par Stripe (US-08.1, US-08.3)", () => {
  it("AC2 (c) : customer.subscription.created -> webhook 200, puis la fonction passe l'organisation a Pro et ecrit un subscription_started", async () => {
    const org = await createOrganizationFixture("AC2 c traitement");
    expect(await readLinkQuota(org.organizationId), "depart : plafond Free").toBe(50);
    const subscriptionId = uniqueId("sub_ac2");
    const customerId = uniqueId("cus_ac2");
    const periodEnd = new Date(Date.now() + 28 * 24 * 3600 * 1000);
    periodEnd.setMilliseconds(0);
    const created = Math.floor(Date.now() / 1000) - 300;
    const stripeState = subscriptionFor(org, {
      id: subscriptionId,
      customer: customerId,
      status: "active",
      currentPeriodEnd: epoch(periodEnd),
    });
    programRetrieve(fakes.stripe, subscriptionId, () => stripeState);
    const event = makeEvent("customer.subscription.created", stripeState, created);

    await deliverAndProcess(event, "AC2 c");

    const row = await readSubscriptionRow(org.organizationId);
    expect(row).toMatchObject({
      tier: "pro",
      status: "active",
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      cancel_at_period_end: false,
    });
    expect(row.current_period_end?.getTime()).toBe(periodEnd.getTime());
    expect(await readLinkQuota(org.organizationId), "Pro : plafond illimite").toBeNull();

    const events = await readBillingEvents(org.organizationId);
    expect(events, "un seul evenement facturable").toHaveLength(1);
    expect(events[0]).toMatchObject({
      organization_id: org.organizationId,
      type: "subscription_started",
      from_tier: null,
      to_tier: "pro",
      actor_user_id: org.owner.userId,
      stripe_event_id: event.id,
    });
    expect(events[0]?.occurred_at.getTime(), "occurred_at = created de l'evenement Stripe").toBe(created * 1000);
  });
});

describe("AC3 — Pro -> Free, annulation en fin de periode (US-08.1, US-08.3)", () => {
  it("AC3 (b) : customer.subscription.updated (annulation programmee) -> tier pro, cancelAtPeriodEnd true, aucun billing_event", async () => {
    const pro = await createProOrganization({ name: "AC3 b" });
    const stripeState = subscriptionFor(pro.org, {
      id: pro.subscriptionId,
      customer: pro.customerId,
      status: "active",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: epoch(pro.periodEnd),
    });
    programRetrieve(fakes.stripe, pro.subscriptionId, () => stripeState);

    await deliverAndProcess(makeEvent("customer.subscription.updated", stripeState), "AC3 b");

    expect(await readSubscriptionRow(pro.org.organizationId)).toMatchObject({
      tier: "pro",
      cancel_at_period_end: true,
      stripe_subscription_id: pro.subscriptionId,
    });
    expect(await readBillingEvents(pro.org.organizationId), "Q-5 : l'annulation programmee n'est pas un evenement facturable").toEqual([]);
    const consulted = await getSubscription(pro.org.owner, pro.org.organizationId);
    expect(consulted.body).toMatchObject({ tier: "pro", cancelAtPeriodEnd: true });
  });

  it("AC3 (c) : customer.subscription.deleted -> Free / active, abonnement et fin de periode a NULL, client conserve, plafond 50, subscription_canceled porte par l'owner demandeur", async () => {
    const pro = await createProOrganization({ name: "AC3 c" });
    const stripeState = subscriptionFor(pro.org, {
      id: pro.subscriptionId,
      customer: pro.customerId,
      status: "canceled",
      cancelAtPeriodEnd: false,
    });
    programRetrieve(fakes.stripe, pro.subscriptionId, () => stripeState);
    const event = makeEvent("customer.subscription.deleted", stripeState);

    await deliverAndProcess(event, "AC3 c");

    expect(await readSubscriptionRow(pro.org.organizationId)).toMatchObject({
      tier: "free",
      status: "active",
      stripe_subscription_id: null,
      current_period_end: null,
      cancel_at_period_end: false,
      stripe_customer_id: pro.customerId,
    });
    expect(await readLinkQuota(pro.org.organizationId)).toBe(50);
    const events = await readBillingEvents(pro.org.organizationId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "subscription_canceled",
      from_tier: "pro",
      to_tier: null,
      actor_user_id: pro.org.owner.userId,
      stripe_event_id: event.id,
    });
  });

  it("AC3 (d) : retrogradation au-dessus du quota (link_count force a 75) -> Free sans erreur, link_count inchange", async () => {
    const pro = await createProOrganization({ name: "AC3 d" });
    await setLinkCount(pro.org.organizationId, 75);
    const stripeState = subscriptionFor(pro.org, {
      id: pro.subscriptionId,
      customer: pro.customerId,
      status: "canceled",
    });
    programRetrieve(fakes.stripe, pro.subscriptionId, () => stripeState);

    await deliverAndProcess(makeEvent("customer.subscription.deleted", stripeState), "AC3 d");

    expect(await readSubscriptionRow(pro.org.organizationId)).toMatchObject({ tier: "free" });
    expect(await readLinkQuota(pro.org.organizationId)).toBe(50);
    expect(await readLinkCount(pro.org.organizationId), "ERD §8.1 : aucun lien supprime ni gele").toBe(75);
  });

  describe("AC3 (e) — auteur de l'annulation disparu ou inconnu (A4)", () => {
    const authors: Array<{ label: string; requestedBy: () => Promise<string | undefined> }> = [
      { label: "utilisateur supprime", requestedBy: () => deletedUserId() },
      { label: "UUID sans utilisateur", requestedBy: () => Promise.resolve(randomUUID()) },
      { label: "valeur qui n'est pas un UUID", requestedBy: () => Promise.resolve("pas-un-uuid") },
      { label: "resiliation par Stripe seul (aucun requested_by)", requestedBy: () => Promise.resolve(undefined) },
    ];

    it.each(authors)("AC3 (e) : $label -> subscription_canceled ecrit avec actor_user_id NULL, sans erreur", async ({ requestedBy }) => {
      const pro = await createProOrganization({ name: "AC3 e" });
      const author = await requestedBy();
      const metadata: Record<string, string> = { organization_id: pro.org.organizationId };
      if (author !== undefined) metadata.requested_by = author;
      const stripeState = stripeSubscriptionObject({
        id: pro.subscriptionId,
        customer: pro.customerId,
        status: "canceled",
        metadata,
      });
      programRetrieve(fakes.stripe, pro.subscriptionId, () => stripeState);

      await deliverAndProcess(makeEvent("customer.subscription.deleted", stripeState), "AC3 e");

      const events = await readBillingEvents(pro.org.organizationId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: "subscription_canceled", from_tier: "pro", actor_user_id: null });
      expect(await readSubscriptionRow(pro.org.organizationId)).toMatchObject({ tier: "free" });
    });
  });
});

describe("AC5 (c) — isolation tenant par le webhook", () => {
  it("AC5 (c) : un evenement pour l'abonnement de A ne modifie jamais la ligne de B, meme si sa metadata.organization_id designe B", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
      const proA = { subscriptionId: uniqueId("sub_ac5"), customerId: uniqueId("cus_ac5") };
    await setSubscriptionDirect(orgA.organizationId, {
      tier: "pro",
      stripeCustomerId: proA.customerId,
      stripeSubscriptionId: proA.subscriptionId,
      currentPeriodEnd: new Date(Date.now() + 5 * 24 * 3600 * 1000),
    });
    const beforeB = await readSubscriptionRow(orgB.organizationId);
    // Stripe (ou une metadonnee falsifiee) designe B pour l'abonnement de A.
    const stripeState = stripeSubscriptionObject({
      id: proA.subscriptionId,
      customer: proA.customerId,
      status: "active",
      cancelAtPeriodEnd: true,
      metadata: { organization_id: orgB.organizationId, requested_by: orgB.owner.userId },
    });
    programRetrieve(fakes.stripe, proA.subscriptionId, () => stripeState);
    const captured = await deliver(makeEvent("customer.subscription.updated", stripeState), "AC5 c");

    const output = await runProcessor(captured);
    expectNoRetry(output, "AC5 c");

    expect(await readSubscriptionRow(orgB.organizationId), "la ligne de B est inchangee").toEqual(beforeB);
    expect(await readBillingEvents(orgB.organizationId), "aucun evenement facturable pour B").toEqual([]);
    expect(await readLinkQuota(orgB.organizationId)).toBe(50);
    const rowA = await readSubscriptionRow(orgA.organizationId);
    expect(rowA.stripe_subscription_id, "l'abonnement reste rattache a A").toBe(proA.subscriptionId);
  });
});

describe("AC8 — idempotence du traitement", () => {
  async function freeOrganizationWithSubscription(name: string): Promise<{
    org: OrganizationFixture;
    subscriptionId: string;
    stripeState: Record<string, unknown>;
  }> {
    const org = await createOrganizationFixture(name);
    const subscriptionId = uniqueId("sub_ac8");
    const stripeState = subscriptionFor(org, { id: subscriptionId, customer: uniqueId("cus_ac8"), status: "active" });
    programRetrieve(fakes.stripe, subscriptionId, () => stripeState);
    return { org, subscriptionId, stripeState };
  }

  it("AC8 (b) : la fonction executee deux fois en sequence pour le meme evenement -> un seul billing_event, etat final identique a une execution unique", async () => {
    const { org, stripeState } = await freeOrganizationWithSubscription("AC8 b");
    const captured = await deliver(makeEvent("customer.subscription.created", stripeState), "AC8 b");

    expectProcessed(await runProcessor(captured), "AC8 b, 1re execution");
    const afterFirst = await readSubscriptionRow(org.organizationId);
    expectProcessed(await runProcessor(captured), "AC8 b, 2e execution");

    expect(await readBillingEvents(org.organizationId)).toHaveLength(1);
    expect(await readSubscriptionRow(org.organizationId)).toEqual(afterFirst);
  });

  it("AC8 (c) : la fonction executee deux fois en parallele pour le meme evenement -> un seul billing_event, aucune erreur remontee", async () => {
    const { org, stripeState } = await freeOrganizationWithSubscription("AC8 c");
    const captured = await deliver(makeEvent("customer.subscription.created", stripeState), "AC8 c");

    const [first, second] = await Promise.all([runProcessor(captured), runProcessor(captured)]);

    expectProcessed(first, "AC8 c, execution A");
    expectProcessed(second, "AC8 c, execution B");
    expect(await readBillingEvents(org.organizationId)).toHaveLength(1);
    expect(await readSubscriptionRow(org.organizationId)).toMatchObject({ tier: "pro", status: "active" });
  });

  it("AC8 (d) : deux evenements distincts (created puis updated) pour la meme transition -> un seul subscription_started", async () => {
    const { org, stripeState } = await freeOrganizationWithSubscription("AC8 d");

    await deliverAndProcess(makeEvent("customer.subscription.created", stripeState), "AC8 d created");
    await deliverAndProcess(makeEvent("customer.subscription.updated", stripeState), "AC8 d updated");

    const events = await readBillingEvents(org.organizationId);
    expect(events.filter((e) => e.type === "subscription_started")).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it("AC8 (e) : apres l'echec de l'ecriture, le rejeu ne rappelle pas Stripe pour le pas deja reussi et n'ecrit qu'une fois (D-061)", async () => {
    const { org, subscriptionId, stripeState } = await freeOrganizationWithSubscription("AC8 e");
    const captured = await deliver(makeEvent("customer.subscription.created", stripeState), "AC8 e");
    const apply = await findApplyFunction();

    // Echec REEL de l'ecriture : EXECUTE retire a signet_billing le temps de la premiere execution.
    await asBypassRls((client) => client.query(`REVOKE EXECUTE ON FUNCTION ${apply.signature} FROM signet_billing`));
    let failed: ProcessorOutput;
    try {
      failed = await runProcessor(captured);
    } finally {
      await asBypassRls((client) => client.query(`GRANT EXECUTE ON FUNCTION ${apply.signature} TO signet_billing`));
    }

    expect(failed.error, "la premiere execution echoue sur l'ecriture").toBeDefined();
    const retrievalsAfterFailure = retrieveCount(fakes.stripe);
    expect(retrievalsAfterFailure, `la relecture de ${subscriptionId} a eu lieu une fois avant l'echec`).toBe(1);
    expect(await readBillingEvents(org.organizationId)).toEqual([]);
    expect(await readSubscriptionRow(org.organizationId)).toMatchObject({ tier: "free" });

    // Rejeu comme le fait Inngest : les pas reussis sont memorises, seul le pas en echec est rejoue.
    const memoized: MemoizedStep[] = [];
    for (const [id, promise] of Object.entries(failed.state)) {
      const settled = await Promise.race([
        promise.then(
          (value) => ({ ok: true as const, value }),
          () => ({ ok: false as const }),
        ),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 2_000)),
      ]);
      if (settled?.ok) memoized.push({ id, idIsHashed: true, handler: () => settled.value });
    }
    expect(
      memoized.length,
      "D-061 : la relecture Stripe et l'ecriture en base doivent etre deux pas distincts (aucun pas reussi memorisable apres l'echec de l'ecriture)",
    ).toBeGreaterThanOrEqual(1);

    const replayed = await runProcessor(captured, { steps: memoized });

    expectProcessed(replayed, "AC8 e, rejeu");
    expect(retrieveCount(fakes.stripe), "Stripe n'est pas rappele pour le pas deja reussi").toBe(retrievalsAfterFailure);
    expect(await readBillingEvents(org.organizationId), "l'effet n'est pas double").toHaveLength(1);
    expect(await readSubscriptionRow(org.organizationId)).toMatchObject({ tier: "pro", status: "active" });
  });
});

describe("AC9 — cas limites du traitement", () => {
  const unknownSubscriptionCases: Array<{
    label: string;
    metadata: (org: OrganizationFixture) => Record<string, string>;
  }> = [
    { label: "metadata.organization_id absente", metadata: () => ({}) },
    { label: "metadata.organization_id mal formee", metadata: () => ({ organization_id: "pas-un-uuid" }) },
    { label: "metadata.organization_id designant une organisation inexistante", metadata: () => ({ organization_id: randomUUID() }) },
  ];

  it.each(unknownSubscriptionCases)(
    "AC9 (a) : abonnement inconnu, $label -> traite sans effet, sans billing_event, sans nouvelle tentative, journal sans secret ni corps complet",
    async ({ metadata }) => {
      const env = billingEnv();
      const bystander = await createOrganizationFixture("AC9 a temoin");
      const bystanderBefore = await readSubscriptionRow(bystander.organizationId);
      const subscriptionId = uniqueId("sub_ac9a");
      const stripeState = stripeSubscriptionObject({
        id: subscriptionId,
        customer: uniqueId("cus_ac9a"),
        status: "active",
        metadata: metadata(bystander),
      });
      programRetrieve(fakes.stripe, subscriptionId, () => stripeState);
      const event = makeEvent("customer.subscription.created", stripeState);
      const captured = await deliver(event, "AC9 a");

      const logs = captureLogs();
      let output: ProcessorOutput;
      try {
        output = await runProcessor(captured);
      } finally {
        logs.restore();
      }

      expectNoRetry(output, "AC9 a");
      expect(await readBillingEvents(bystander.organizationId)).toEqual([]);
      expect(await readSubscriptionRow(bystander.organizationId)).toEqual(bystanderBefore);
      const written = await asBypassRls(async (client) =>
        (await client.query("SELECT 1 FROM billing_event WHERE stripe_event_id = $1", [event.id])).rowCount,
      );
      expect(written, "aucun billing_event pour cet evenement").toBe(0);
      expect(logs.text().length, "l'evenement sans effet est journalise").toBeGreaterThan(0);
      expect(logs.text()).not.toContain(env.stripeSecretKey);
      expect(logs.text()).not.toContain(env.webhookSecret);
      expect(logs.text(), "le corps complet de l'evenement n'est pas journalise").not.toContain(JSON.stringify(event));
      expect(logs.text(), "l'objet Stripe complet n'est pas journalise").not.toContain(JSON.stringify(stripeState));
    },
  );

  it("AC9 (b) : client Stripe different de celui enregistre pour l'organisation -> aucune ecriture, journalise", async () => {
    const org = await createOrganizationFixture("AC9 b");
    const registeredCustomer = uniqueId("cus_registered");
    await setSubscriptionDirect(org.organizationId, { tier: "free", stripeCustomerId: registeredCustomer });
    const before = await readSubscriptionRow(org.organizationId);
    const subscriptionId = uniqueId("sub_ac9b");
    const stripeState = subscriptionFor(org, { id: subscriptionId, customer: uniqueId("cus_other"), status: "active" });
    programRetrieve(fakes.stripe, subscriptionId, () => stripeState);
    const captured = await deliver(makeEvent("customer.subscription.created", stripeState), "AC9 b");

    const logs = captureLogs();
    let output: ProcessorOutput;
    try {
      output = await runProcessor(captured);
    } finally {
      logs.restore();
    }

    expectNoRetry(output, "AC9 b");
    expect(await readSubscriptionRow(org.organizationId)).toEqual(before);
    expect(await readBillingEvents(org.organizationId)).toEqual([]);
    expect(logs.text().length, "Q-7 : le cas est journalise").toBeGreaterThan(0);
    expect(logs.text()).not.toContain(billingEnv().stripeSecretKey);
  });

  describe("AC9 (c) — evenements dans le desordre (Q-2)", () => {
    it("AC9 (c) : deleted traite avant updated -> Free ; l'updated perime traite ensuite ne refait pas passer l'organisation en Pro", async () => {
      const pro = await createProOrganization({ name: "AC9 c deleted puis updated" });
      // Etat reel chez Stripe : l'abonnement est resilie. L'evenement `updated` en retard decrit encore « active ».
      const canceledState = subscriptionFor(pro.org, { id: pro.subscriptionId, customer: pro.customerId, status: "canceled" });
      const staleActiveState = subscriptionFor(pro.org, { id: pro.subscriptionId, customer: pro.customerId, status: "active" });
      programRetrieve(fakes.stripe, pro.subscriptionId, () => canceledState);

      await deliverAndProcess(makeEvent("customer.subscription.deleted", canceledState), "AC9 c deleted");
      expect(await readSubscriptionRow(pro.org.organizationId)).toMatchObject({ tier: "free" });
      await deliverAndProcess(makeEvent("customer.subscription.updated", staleActiveState), "AC9 c updated perime");

      expect(await readSubscriptionRow(pro.org.organizationId)).toMatchObject({ tier: "free", status: "active" });
      expect(await readLinkQuota(pro.org.organizationId)).toBe(50);
      const events = await readBillingEvents(pro.org.organizationId);
      expect(events.map((e) => e.type)).toEqual(["subscription_canceled"]);
    });

    it("AC9 (c) : updated traite avant created -> l'etat final est celui relu chez Stripe (Pro), un seul subscription_started", async () => {
      const org = await createOrganizationFixture("AC9 c updated puis created");
      const subscriptionId = uniqueId("sub_ac9c");
      const stripeState = subscriptionFor(org, { id: subscriptionId, customer: uniqueId("cus_ac9c"), status: "active" });
      programRetrieve(fakes.stripe, subscriptionId, () => stripeState);

      await deliverAndProcess(makeEvent("customer.subscription.updated", stripeState), "AC9 c updated");
      await deliverAndProcess(makeEvent("customer.subscription.created", stripeState), "AC9 c created");

      expect(await readSubscriptionRow(org.organizationId)).toMatchObject({
        tier: "pro",
        status: "active",
        stripe_subscription_id: subscriptionId,
      });
      const events = await readBillingEvents(org.organizationId);
      expect(events.filter((e) => e.type === "subscription_started")).toHaveLength(1);
    });
  });

  it("AC9 (d) : un abonnement Pro passe past_due -> tier pro, status past_due, aucun billing_event, quota illimite", async () => {
    const pro = await createProOrganization({ name: "AC9 d" });
    const stripeState = subscriptionFor(pro.org, { id: pro.subscriptionId, customer: pro.customerId, status: "past_due" });
    programRetrieve(fakes.stripe, pro.subscriptionId, () => stripeState);

    await deliverAndProcess(makeEvent("customer.subscription.updated", stripeState), "AC9 d");

    expect(await readSubscriptionRow(pro.org.organizationId)).toMatchObject({ tier: "pro", status: "past_due" });
    expect(await readBillingEvents(pro.org.organizationId), "Q-5 : past_due n'est pas un evenement facturable").toEqual([]);
    expect(await readLinkQuota(pro.org.organizationId)).toBeNull();
  });

  describe("AC9 (e) — correspondance des statuts Stripe (Q-8)", () => {
    const table: Array<{
      stripeStatus: string;
      from: "free" | "pro";
      expected: { tier: string; status: string };
    }> = [
      { stripeStatus: "active", from: "free", expected: { tier: "pro", status: "active" } },
      { stripeStatus: "trialing", from: "free", expected: { tier: "pro", status: "active" } },
      { stripeStatus: "past_due", from: "pro", expected: { tier: "pro", status: "past_due" } },
      { stripeStatus: "unpaid", from: "pro", expected: { tier: "pro", status: "past_due" } },
      { stripeStatus: "paused", from: "pro", expected: { tier: "pro", status: "past_due" } },
      { stripeStatus: "incomplete", from: "free", expected: { tier: "free", status: "incomplete" } },
      { stripeStatus: "incomplete_expired", from: "pro", expected: { tier: "free", status: "active" } },
      { stripeStatus: "canceled", from: "pro", expected: { tier: "free", status: "active" } },
    ];

    it.each(table)(
      "AC9 (e) : $stripeStatus (depuis $from) -> $expected.tier / $expected.status",
      async ({ stripeStatus, from, expected }) => {
        let organizationId: string;
        let subscriptionId: string;
        let stripeState: Record<string, unknown>;
        if (from === "pro") {
          const pro = await createProOrganization({ name: `AC9 e ${stripeStatus}` });
          organizationId = pro.org.organizationId;
          subscriptionId = pro.subscriptionId;
          stripeState = subscriptionFor(pro.org, { id: subscriptionId, customer: pro.customerId, status: stripeStatus });
        } else {
          const org = await createOrganizationFixture(`AC9 e ${stripeStatus}`);
          organizationId = org.organizationId;
          subscriptionId = uniqueId("sub_ac9e");
          stripeState = subscriptionFor(org, { id: subscriptionId, customer: uniqueId("cus_ac9e"), status: stripeStatus });
        }
        programRetrieve(fakes.stripe, subscriptionId, () => stripeState);

        await deliverAndProcess(makeEvent("customer.subscription.updated", stripeState), `AC9 e ${stripeStatus}`);

        expect(await readSubscriptionRow(organizationId)).toMatchObject(expected);
        const expectedQuota = expected.tier === "pro" ? null : 50;
        expect(await readLinkQuota(organizationId)).toBe(expectedQuota);
      },
    );
  });

  it("AC9 (f) : second abonnement Stripe actif pour une organisation deja Pro -> aucune ecriture, journalise, l'abonnement en place reste rattache", async () => {
    const pro = await createProOrganization({ name: "AC9 f" });
    const before = await readSubscriptionRow(pro.org.organizationId);
    const secondId = uniqueId("sub_second");
    const stripeState = subscriptionFor(pro.org, { id: secondId, customer: pro.customerId, status: "active" });
    programRetrieve(fakes.stripe, secondId, () => stripeState);
    const captured = await deliver(makeEvent("customer.subscription.created", stripeState), "AC9 f");

    const logs = captureLogs();
    let output: ProcessorOutput;
    try {
      output = await runProcessor(captured);
    } finally {
      logs.restore();
    }

    expectNoRetry(output, "AC9 f");
    expect(await readSubscriptionRow(pro.org.organizationId)).toEqual(before);
    expect((await readSubscriptionRow(pro.org.organizationId)).stripe_subscription_id).toBe(pro.subscriptionId);
    expect(await readBillingEvents(pro.org.organizationId)).toEqual([]);
    expect(logs.text().length, "Q-7 : le cas est journalise").toBeGreaterThan(0);
    expect(logs.text()).not.toContain(billingEnv().stripeSecretKey);
  });
});
