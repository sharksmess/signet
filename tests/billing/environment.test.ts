/**
 * Tranche 002 — AC13 (dependances et environnement) et AC15 (point de service
 * Inngest).
 *
 * Le schema d'environnement est une fonction pure, sans lecture implicite de
 * process.env (modele : buildRateLimitOptions, tests/organizations/
 * auth-rate-limit.test.ts). Chemin et nom supposes (voir rapport) :
 * `apps/web/src/lib/env.ts`, export `parseServerEnv(raw)` qui leve une Error si
 * l'environnement est invalide, sans jamais citer la valeur d'une variable.
 *
 * Chaque cas negatif est precede d'un temoin positif : si l'environnement de
 * base lui-meme etait rejete, le test echouerait pour cette raison et non en
 * passant faussement sur un `toThrow`.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { requireEnv } from "../_factory/env";
import { FakeStripe } from "./fakes/fake-stripe";
import { billingEnv, applyServerEnvToProcess } from "../helpers/billing";

type RawEnv = Record<string, string | undefined>;

/** Environnement de production valide, valeurs inventees. */
function validProductionEnv(): RawEnv {
  return {
    APP_ENV: "production",
    AUTH_RATE_LIMIT: "on",
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
}

function withEnv(base: RawEnv, changes: RawEnv): RawEnv {
  const merged: RawEnv = { ...base, ...changes };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete merged[key];
  }
  return merged;
}

type ParseServerEnv = (raw: RawEnv) => unknown;

let parseServerEnv: ParseServerEnv;

beforeAll(async () => {
  const module = await import("../../apps/web/src/lib/env");
  parseServerEnv = module.parseServerEnv;
});

/** Valeurs de secret de l'environnement : jamais citees dans un message d'erreur. */
function secretValues(env: RawEnv): string[] {
  const names = [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "INNGEST_SIGNING_KEY",
    "INNGEST_EVENT_KEY",
    "BETTER_AUTH_SECRET",
    "DATABASE_URL_APP",
    "DATABASE_URL_AUTH",
    "DATABASE_URL_BILLING",
  ];
  return names.map((n) => env[n]).filter((v): v is string => !!v);
}

function parseError(env: RawEnv): Error | undefined {
  try {
    parseServerEnv(env);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function expectAccepted(env: RawEnv, label: string): void {
  const error = parseError(env);
  expect(error, `${label} : environnement attendu valide, refuse avec : ${error?.message}`).toBeUndefined();
}

function expectRefusedWithoutValues(env: RawEnv, label: string, secrets: string[]): void {
  const error = parseError(env);
  expect(error, `${label} : demarrage attendu refuse`).toBeDefined();
  for (const secret of secrets) {
    expect(error?.message ?? "", `${label} : le message ne doit pas afficher une valeur`).not.toContain(secret);
  }
}

describe("AC13 — environnement valide par un schema au demarrage", () => {
  it("temoin : l'environnement de production de base est accepte", () => {
    expectAccepted(validProductionEnv(), "base de production");
  });

  const required: Array<{ name: string; malformed: string }> = [
    { name: "STRIPE_SECRET_KEY", malformed: "SENTINELLE-cle-secrete-mal-formee" },
    { name: "STRIPE_WEBHOOK_SECRET", malformed: "SENTINELLE-secret-webhook-mal-forme" },
    { name: "STRIPE_PRICE_ID_PRO", malformed: "SENTINELLE-prix-mal-forme" },
    { name: "APP_URL", malformed: "SENTINELLE pas une url" },
    { name: "DATABASE_URL_BILLING", malformed: "SENTINELLE-pas-une-url-postgres" },
  ];

  it.each(required)("AC13 : $name absente -> le demarrage est refuse", ({ name }) => {
    const base = validProductionEnv();
    expectAccepted(base, "temoin");

    expectRefusedWithoutValues(withEnv(base, { [name]: undefined }), `${name} absente`, secretValues(base));
  });

  it.each(required)("AC13 : $name mal formee -> le demarrage est refuse, sans afficher la valeur", ({ name, malformed }) => {
    const base = validProductionEnv();
    expectAccepted(base, "temoin");

    expectRefusedWithoutValues(withEnv(base, { [name]: malformed }), `${name} mal formee`, [malformed, "SENTINELLE"]);
  });

  it("AC13 : STRIPE_API_BASE_URL est acceptee avec APP_ENV=test", () => {
    const base = withEnv(validProductionEnv(), { APP_ENV: "test", AUTH_RATE_LIMIT: "off", INNGEST_SIGNING_KEY: undefined });

    expectAccepted(withEnv(base, { INNGEST_DEV: "http://localhost:8288", STRIPE_API_BASE_URL: "http://localhost:12111" }), "test + STRIPE_API_BASE_URL");
  });

  it.each([
    ["development", "development"],
    ["production", "production"],
    ["APP_ENV absent (production par defaut)", undefined],
  ])("AC13 : STRIPE_API_BASE_URL avec APP_ENV = %s -> le demarrage est refuse", (_label, appEnv) => {
    const base = validProductionEnv();
    const attempt = withEnv(base, {
      APP_ENV: appEnv,
      STRIPE_API_BASE_URL: "http://localhost:12111",
    });
    expectAccepted(withEnv(attempt, { STRIPE_API_BASE_URL: undefined }), "temoin sans STRIPE_API_BASE_URL");

    expectRefusedWithoutValues(attempt, "STRIPE_API_BASE_URL hors test", ["localhost:12111"]);
  });
});

describe("AC15 — point de service Inngest (A2)", () => {
  it("AC15 : le mode developpement est accepte avec APP_ENV=test", () => {
    const env = withEnv(validProductionEnv(), {
      APP_ENV: "test",
      AUTH_RATE_LIMIT: "off",
      INNGEST_DEV: "http://localhost:12112",
      INNGEST_SIGNING_KEY: undefined,
      INNGEST_EVENT_KEY: undefined,
    });

    expectAccepted(env, "mode developpement avec APP_ENV=test");
  });

  it("AC15 : le mode developpement est accepte avec APP_ENV=development", () => {
    const env = withEnv(validProductionEnv(), {
      APP_ENV: "development",
      INNGEST_DEV: "http://localhost:8288",
      INNGEST_SIGNING_KEY: undefined,
      INNGEST_EVENT_KEY: undefined,
    });

    expectAccepted(env, "mode developpement avec APP_ENV=development");
  });

  it.each([
    ["APP_ENV=production", "production"],
    ["APP_ENV absent (production par defaut)", undefined],
  ])("AC15 : le mode developpement est refuse avec %s", (_label, appEnv) => {
    const base = validProductionEnv();
    expectAccepted(withEnv(base, { APP_ENV: appEnv }), "temoin production");

    expectRefusedWithoutValues(
      withEnv(base, { APP_ENV: appEnv, INNGEST_DEV: "http://localhost:12112" }),
      "mode developpement en production",
      ["localhost:12112"],
    );
  });

  it.each([
    ["APP_ENV=production", "production"],
    ["APP_ENV absent (production par defaut)", undefined],
  ])("AC15 : INNGEST_SIGNING_KEY absente hors mode developpement (%s) -> refus de demarrer, sans afficher de valeur", (_label, appEnv) => {
    const base = withEnv(validProductionEnv(), { APP_ENV: appEnv });
    expectAccepted(base, "temoin avec cle de signature");

    expectRefusedWithoutValues(
      withEnv(base, { INNGEST_SIGNING_KEY: undefined }),
      "production sans cle de signature",
      secretValues(base),
    );
  });
});

describe("AC15 — gestionnaire /api/inngest hors mode developpement", () => {
  let stripe: FakeStripe;

  beforeAll(async () => {
    stripe = await FakeStripe.start(billingEnv().fakeStripePort);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    stripe.reset();
  });

  afterAll(async () => {
    await stripe.stop();
  });

  /** Environnement de production pour le gestionnaire instancie dans CE processus, cle de signature inventee. */
  function stubProductionServe(): void {
    applyServerEnvToProcess();
    const env = requireEnv(["TEST_DATABASE_URL_BILLING"]);
    const production: RawEnv = {
      ...validProductionEnv(),
      DATABASE_URL_BILLING: env.TEST_DATABASE_URL_BILLING,
      INNGEST_SIGNING_KEY: "signkey-test-0123456789abcdef0123456789abcdef",
    };
    vi.stubEnv("NODE_ENV", "production");
    for (const [key, value] of Object.entries(production)) vi.stubEnv(key, value);
    vi.stubEnv("INNGEST_DEV", undefined);
    vi.stubEnv("STRIPE_API_BASE_URL", undefined);
    vi.resetModules();
  }

  function invocation(headers?: Record<string, string>): Request {
    return new Request("http://localhost:3100/api/inngest?fnId=signet-process-stripe-event&stepId=step", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ ctx: { run_id: "01HZZZZZZZZZZZZZZZZZZZZZZZ", attempt: 0 }, event: { name: "x", data: {} }, events: [], steps: {}, use_api: false }),
    });
  }

  it("AC15 : un appel non signe a /api/inngest recoit 401 et n'execute rien", async () => {
    stubProductionServe();
    const route = await import("../../apps/web/src/app/api/inngest/route");

    const response = await route.POST(invocation());

    expect(response.status, `corps brut : ${await response.clone().text()}`).toBe(401);
    expect(stripe.requests, "aucune fonction executee : aucun appel a Stripe").toEqual([]);
  });

  it("AC15 : un appel mal signe a /api/inngest recoit 401 et n'execute rien", async () => {
    stubProductionServe();
    const route = await import("../../apps/web/src/app/api/inngest/route");

    const response = await route.POST(invocation({ "x-inngest-signature": `t=${Math.floor(Date.now() / 1000)}&s=${"0".repeat(64)}` }));

    expect(response.status, `corps brut : ${await response.clone().text()}`).toBe(401);
    expect(stripe.requests).toEqual([]);
  });
});
