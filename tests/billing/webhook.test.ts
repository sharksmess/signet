/**
 * Tranche 002 — route webhook Stripe : AC7 (signature), AC8 (a) (idempotence a
 * la reception), AC14 (file indisponible), D-060 (types d'evenements).
 *
 * Les evenements sont signes par les tests eux-memes avec node:crypto (D-059) ;
 * le faux Inngest recoit ce que la route transmet. La route ne lit pas la base :
 * les verifications « aucune ecriture » se font sous administration, filtrees
 * par l'identifiant d'evenement Stripe de chaque test.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { closeAllPools, asBypassRls } from "../helpers/db";
import {
  billingEnv,
  codeOf,
  expectError,
  expectStatus,
  postSignedEvent,
  postWebhook,
  startFakes,
  stopFakes,
  stripeEventObject,
  stripeSignature,
  stripeSignatureHeader,
  stripeSubscriptionObject,
  uniqueId,
  type Fakes,
} from "../helpers/billing";
import { closeBillingPool } from "../helpers/billing-db";

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

function subscriptionEvent(type = "customer.subscription.created"): {
  event: Record<string, unknown> & { id: string };
  customerId: string;
  subscriptionId: string;
} {
  const customerId = uniqueId("cus_wh");
  const subscriptionId = uniqueId("sub_wh");
  const id = uniqueId("evt_wh");
  const event = stripeEventObject({
    id,
    type,
    subscription: stripeSubscriptionObject({ id: subscriptionId, customer: customerId, status: "active" }),
  });
  return { event: { ...event, id }, customerId, subscriptionId };
}

async function billingEventsWithStripeId(stripeEventId: string): Promise<number> {
  return asBypassRls(async (client) => {
    const { rows } = await client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM billing_event WHERE stripe_event_id = $1",
      [stripeEventId],
    );
    return Number(rows[0]?.n ?? "0");
  });
}

describe("AC7 — signature du webhook", () => {
  const now = (): number => Math.floor(Date.now() / 1000);

  const cases: Array<{
    label: string;
    headers: (rawBody: string) => Record<string, string>;
  }> = [
    { label: "signature absente", headers: () => ({}) },
    { label: "signature mal formee", headers: () => ({ "Stripe-Signature": "ceci n'est pas une signature" }) },
    {
      label: "signature sans schema v1",
      headers: () => ({ "Stripe-Signature": `t=${now()}` }),
    },
    {
      label: "signature v1 de la bonne forme mais alteree",
      headers: (rawBody) => {
        const t = now();
        const good = stripeSignature(rawBody, billingEnv().webhookSecret, t);
        const altered = (good.startsWith("0") ? "1" : "0") + good.slice(1);
        return { "Stripe-Signature": `t=${t},v1=${altered}` };
      },
    },
    {
      label: "signature calculee avec un autre secret",
      headers: (rawBody) => ({
        "Stripe-Signature": stripeSignatureHeader(rawBody, { secret: "whsec_un_autre_secret_invente_pour_le_test" }),
      }),
    },
    {
      label: "horodatage hors tolerance (400 s dans le passe, signature correcte)",
      headers: (rawBody) => ({ "Stripe-Signature": stripeSignatureHeader(rawBody, { timestamp: now() - 400 }) }),
    },
  ];

  it.each(cases)(
    "AC7 : $label -> 400 INVALID_SIGNATURE avant tout traitement, sans fuite du secret, de la signature attendue ni du corps",
    async ({ headers }) => {
      const { event, customerId } = subscriptionEvent();
      const rawBody = JSON.stringify(event);
      const requestHeaders = headers(rawBody);

      const result = await postWebhook(rawBody, requestHeaders);

      expectError(result, 400, "INVALID_SIGNATURE", "webhook mal signe");
      const env = billingEnv();
      const expected = stripeSignature(rawBody, env.webhookSecret, Number(/t=(\d+)/.exec(requestHeaders["Stripe-Signature"] ?? "")?.[1] ?? now()));
      expect(result.text, "le secret du webhook ne doit pas fuiter").not.toContain(env.webhookSecret);
      expect(result.text, "la signature attendue ne doit pas fuiter").not.toContain(expected);
      expect(result.text, "le corps de l'evenement ne doit pas etre renvoye").not.toContain(customerId);
      expect(fakes.inngest.eventsMentioning(event.id), "aucun evenement transmis a Inngest").toEqual([]);
      expect(fakes.inngest.rawBodies, "aucune transmission du tout").toEqual([]);
      expect(await billingEventsWithStripeId(event.id), "aucune ecriture").toBe(0);
    },
  );

  it("AC7 : le corps n'est jamais parse avant verification — un corps non JSON mal signe donne INVALID_SIGNATURE, pas une erreur de syntaxe", async () => {
    const result = await postWebhook("ceci { n'est pas du JSON", { "Stripe-Signature": "t=1,v1=00" });

    expectError(result, 400, "INVALID_SIGNATURE", "webhook non JSON mal signe");
    expect(fakes.inngest.rawBodies).toEqual([]);
  });

  it("AC7 : un evenement correctement signe est accepte (temoin positif des cas ci-dessus)", async () => {
    const { event } = subscriptionEvent();

    const result = await postSignedEvent(event);

    expectStatus(result, 200, "webhook correctement signe");
    expect(result.body).toEqual({ received: true });
    expect(codeOf(result)).toBeUndefined();
  });
});

describe("AC8 (a) — idempotence a la reception", () => {
  it("AC8 (a) : le meme evenement poste deux fois -> deux 200 ; un seul evenement transmis a Inngest, ou deux portant le meme id (id Stripe)", async () => {
    const { event } = subscriptionEvent();

    const first = await postSignedEvent(event);
    const second = await postSignedEvent(event);

    expectStatus(first, 200, "premier envoi");
    expectStatus(second, 200, "second envoi");
    expect(first.body).toEqual({ received: true });
    expect(second.body).toEqual({ received: true });

    const forwarded = fakes.inngest.eventsMentioning(event.id);
    expect(forwarded.length, "au moins une transmission").toBeGreaterThanOrEqual(1);
    expect(forwarded.length, "au plus une par envoi").toBeLessThanOrEqual(2);
    expect(
      forwarded.map((e) => e.id),
      "l'identifiant de deduplication Inngest est l'id de l'evenement Stripe",
    ).toEqual(forwarded.map(() => event.id));
  });
});

describe("D-060 — types d'evenements", () => {
  it.each(["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"])(
    "D-060 : %s est mis en file",
    async (type) => {
      const { event } = subscriptionEvent(type);

      expectStatus(await postSignedEvent(event), 200, `webhook ${type}`);

      expect(fakes.inngest.eventsMentioning(event.id).length).toBeGreaterThanOrEqual(1);
    },
  );

  it("D-060 : un autre type signe (invoice.paid) est acquitte 200 et ignore, sans mise en file", async () => {
    const id = uniqueId("evt_other");
    const event = { id, object: "event", type: "invoice.paid", created: Math.floor(Date.now() / 1000), data: { object: {} } };

    const result = await postSignedEvent(event);

    expectStatus(result, 200, "webhook invoice.paid");
    expect(result.body).toEqual({ received: true });
    expect(fakes.inngest.rawBodies, "aucune mise en file").toEqual([]);
  });
});

describe("AC14 — webhook et file d'attente indisponible (A1)", () => {
  const MARKER = "detail-interne-file-ne-doit-jamais-fuiter";

  function expectNoInternalDetail(text: string): void {
    expect(text, "aucun detail interne dans la reponse").not.toContain(MARKER);
    expect(text).not.toMatch(/inngest/i);
    expect(text).not.toMatch(/\bat \S+ \(/); // pas de trace de pile
  }

  it("AC14 : la file repond 500 -> la route repond 5xx (jamais 200), sans ecriture ni detail interne ; la redistribution de Stripe passe ensuite", async () => {
    const { event } = subscriptionEvent();
    fakes.inngest.failWith(500, { error: MARKER });

    const failed = await postSignedEvent(event);

    expect(failed.status, `statut recu ${failed.status}, corps brut : ${failed.text}`).toBeGreaterThanOrEqual(500);
    expect(failed.status).toBeLessThan(600);
    expectNoInternalDetail(failed.text);
    expect(await billingEventsWithStripeId(event.id), "aucune ecriture").toBe(0);

    // Stripe renvoie l'evenement : la file est revenue, le meme evenement est accepte.
    fakes.inngest.succeed();
    const retried = await postSignedEvent(event);
    expectStatus(retried, 200, "renvoi de l'evenement par Stripe");
    expect(fakes.inngest.eventsMentioning(event.id).length).toBeGreaterThanOrEqual(1);
  });

  it("AC14 : la file ne repond pas -> la route repond 5xx dans un delai raisonnable (jamais 200), sans detail interne", async () => {
    const { event } = subscriptionEvent();
    fakes.inngest.hang();

    const failed = await postSignedEvent(event, { signal: AbortSignal.timeout(50_000) });

    expect(failed.status, `statut recu ${failed.status}, corps brut : ${failed.text}`).toBeGreaterThanOrEqual(500);
    expect(failed.status).toBeLessThan(600);
    expectNoInternalDetail(failed.text);
    expect(await billingEventsWithStripeId(event.id), "aucune ecriture").toBe(0);
  }, 60_000);
});
