/**
 * Tranche 002 — garanties portees par la base : AC5 (b), AC6 (b, c, d, e),
 * AC9 (g), AC12.
 *
 * Tout se verifie directement en base, sous les roles reels (signet_app,
 * signet_billing) ou sous SET LOCAL ROLE pour ceux sans URL de suite : jamais
 * sous un superutilisateur pour une assertion d'isolation (il contournerait la
 * RLS et le test passerait toujours). La fonction d'application d'etat Stripe
 * est decouverte par le catalogue (seule fonction dont l'EXECUTE est accorde a
 * signet_billing), sans supposer son nom.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { asBypassRls, asTableOwner, asTenant, closeAllPools } from "../helpers/db";
import { createOrganizationFixture, createTwoOrganizationsFixture } from "../helpers/fixtures";
import { uniqueId } from "../helpers/billing";
import {
  asBilling,
  asBillingCommitted,
  asRoleFromAdmin,
  callApply,
  callApplyWithNulls,
  closeBillingPool,
  findApplyFunction,
  insertBillingEventDirect,
  readBillingEvents,
  readSubscriptionRow,
  setSubscriptionDirect,
  type ApplyInput,
} from "../helpers/billing-db";

afterAll(async () => {
  await closeBillingPool();
  await closeAllPools();
});

/** Codes qui signaleraient une erreur de test ou une absence d'implementation, jamais le refus attendu. */
const WRONG_REASON_CODES = ["42883", "42601", "42P01", "42703", "22P02", "08006", "28000", "28P01", "3D000"];

interface PgFailure {
  code?: string;
  message?: string;
  constraint?: string;
}

async function failureOf(operation: () => Promise<unknown>): Promise<PgFailure | undefined> {
  try {
    await operation();
    return undefined;
  } catch (error) {
    return error as PgFailure;
  }
}

function expectRefusalForTheRightReason(failure: PgFailure | undefined, what: string): void {
  expect(failure, `${what} doit etre refuse`).toBeDefined();
  expect(WRONG_REASON_CODES, `${what} : refus pour la mauvaise raison (${failure?.code} ${failure?.message})`).not.toContain(
    failure?.code,
  );
}

function applyInput(overrides: Partial<ApplyInput> & Pick<ApplyInput, "stripe_subscription_id" | "metadata_organization_id">): ApplyInput {
  return {
    stripe_event_id: uniqueId("evt_db"),
    stripe_read_at: new Date().toISOString(),
    occurred_at: new Date(Date.now() - 60_000).toISOString(),
    event_type: "customer.subscription.updated",
    stripe_customer_id: uniqueId("cus_db"),
    stripe_status: "active",
    is_pro_price: true,
    cancel_at_period_end: false,
    current_period_end: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString(),
    metadata_requested_by: null,
    ...overrides,
  };
}

describe("AC5 (b) — isolation tenant en base (signet_app)", () => {
  it("AC5 (b) : contexte B + utilisateur owner de A -> 0 ligne de subscription et de billing_event de B, toute ecriture refusee (l'owner de B, lui, les voit)", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    await insertBillingEventDirect({
      organizationId: orgB.organizationId,
      stripeEventId: uniqueId("evt_ac5b"),
      actorUserId: orgB.owner.userId,
    });
    const subscriptionBefore = await readSubscriptionRow(orgB.organizationId);
    const eventsBefore = await readBillingEvents(orgB.organizationId);
    const foreign = { organizationId: orgB.organizationId, userId: orgA.owner.userId };

    const legit = await asTenant({ organizationId: orgB.organizationId, userId: orgB.owner.userId }, async (client) => ({
      subscription: (await client.query("SELECT 1 FROM subscription WHERE organization_id = $1", [orgB.organizationId])).rowCount,
      events: (await client.query("SELECT 1 FROM billing_event WHERE organization_id = $1", [orgB.organizationId])).rowCount,
    }));
    expect(legit, "temoin positif : l'owner de B voit ses lignes").toEqual({ subscription: 1, events: 1 });

    const seen = await asTenant(foreign, async (client) => ({
      subscription: (await client.query("SELECT 1 FROM subscription WHERE organization_id = $1", [orgB.organizationId])).rows,
      events: (await client.query("SELECT 1 FROM billing_event WHERE organization_id = $1", [orgB.organizationId])).rows,
    }));
    expect(seen).toEqual({ subscription: [], events: [] });

    // Ecritures : refus par privilege (42501) ou 0 ligne visible a modifier ; jamais un effet.
    const updateSubscription = await asTenant(foreign, async (client) => {
      const failure = await failureOf(() =>
        client.query("UPDATE subscription SET tier = 'free', cancel_at_period_end = true WHERE organization_id = $1", [
          orgB.organizationId,
        ]),
      );
      return failure;
    });
    expect(updateSubscription === undefined || updateSubscription.code === "42501", `UPDATE subscription : ${updateSubscription?.code}`).toBe(true);

    const insertEvent = await asTenant(foreign, async (client) =>
      failureOf(() =>
        client.query(
          "INSERT INTO billing_event (organization_id, type, from_tier, to_tier, occurred_at) VALUES ($1, 'subscription_started', NULL, 'pro', now())",
          [orgB.organizationId],
        ),
      ),
    );
    expect(insertEvent?.code, "INSERT dans billing_event sous signet_app").toBe("42501");

    expect(await readSubscriptionRow(orgB.organizationId)).toEqual(subscriptionBefore);
    expect(await readBillingEvents(orgB.organizationId)).toEqual(eventsBefore);
  });
});

describe("AC6 (b) — la fonction d'application d'etat Stripe n'est executable que par signet_billing", () => {
  it("AC6 (b) : la fonction est SECURITY DEFINER, possedee par signet_definer, search_path fige avec pg_temp en dernier", async () => {
    const fn = await findApplyFunction();

    expect(fn.securityDefiner).toBe(true);
    expect(fn.owner).toBe("signet_definer");
    expect(fn.config).toContain("search_path=pg_catalog, signet, public, pg_temp");
  });

  it("AC6 (b) : aucun GRANT n'en rend l'EXECUTE possible a PUBLIC, signet_app, signet_auth ni signet_owner (catalogue)", async () => {
    const fn = await findApplyFunction();

    const { rows } = await asBypassRls((client) =>
      client.query<{ grantee: string; allowed: boolean }>(
        `SELECT g.grantee, has_function_privilege(g.grantee, $1::regprocedure, 'EXECUTE') AS allowed
           FROM unnest(ARRAY['public', 'signet_app', 'signet_auth', 'signet_owner']) AS g(grantee)`,
        [fn.signature],
      ),
    );

    expect(rows.filter((r) => r.allowed).map((r) => r.grantee)).toEqual([]);
    expect(rows).toHaveLength(4);
  });

  it.each(["signet_app", "signet_auth", "signet_owner"] as const)(
    "AC6 (b) : un appel sous %s est refuse par le privilege (42501)",
    async (role) => {
      const fn = await findApplyFunction();

      const failure = await asRoleFromAdmin(role, (client) => failureOf(() => callApplyWithNulls(client, fn)));

      expect(failure?.code).toBe("42501");
    },
  );

  it("AC6 (b) : signet_billing n'a aucun privilege de table, de colonne, de sequence ni de creation de schema", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ object: string; privilege: string }>(
        `SELECT n.nspname || '.' || c.relname AS object, p.privilege
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(privilege)
          WHERE n.nspname IN ('public', 'signet') AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
            AND (has_table_privilege('signet_billing', c.oid, p.privilege)
                 OR (p.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                     AND has_any_column_privilege('signet_billing', c.oid, p.privilege)))
         UNION ALL
         SELECT n.nspname || '.' || c.relname, 'SEQUENCE ' || p.privilege
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) AS p(privilege)
          WHERE n.nspname IN ('public', 'signet') AND c.relkind = 'S'
            AND has_sequence_privilege('signet_billing', c.oid, p.privilege)
         UNION ALL
         SELECT 'schema ' || s.nspname, 'CREATE'
           FROM pg_namespace s
          WHERE s.nspname IN ('public', 'signet') AND has_schema_privilege('signet_billing', s.oid, 'CREATE')`,
      ),
    );

    expect(rows, "signet_billing n'agit que par la fonction").toEqual([]);
  });

  it("AC6 (b) : sous signet_billing, lire ou ecrire subscription et billing_event est refuse (42501)", async () => {
    const failures = await Promise.all([
      asBilling({}, (client) => failureOf(() => client.query("SELECT 1 FROM subscription"))),
      asBilling({}, (client) => failureOf(() => client.query("UPDATE subscription SET tier = 'pro'"))),
      asBilling({}, (client) => failureOf(() => client.query("SELECT 1 FROM billing_event"))),
      asBilling({}, (client) =>
        failureOf(() =>
          client.query("INSERT INTO billing_event (organization_id, type, to_tier, occurred_at) VALUES (gen_random_uuid(), 'subscription_started', 'pro', now())"),
        ),
      ),
    ]);

    expect(failures.map((f) => f?.code)).toEqual(["42501", "42501", "42501", "42501"]);
  });

  it("AC6 (b) : un seul EXECUTE accorde explicitement a signet_billing — la fonction d'application", async () => {
    const fn = await findApplyFunction(); // echoue si le nombre de GRANT explicites differe de 1

    expect(fn.signature).toMatch(/^signet\./);
  });
});

describe("AC6 (c) — contexte etranger force, sous signet_billing", () => {
  async function twoOrganizationsWithA_Pro(): Promise<{
    orgA: Awaited<ReturnType<typeof createTwoOrganizationsFixture>>["orgA"];
    orgB: Awaited<ReturnType<typeof createTwoOrganizationsFixture>>["orgB"];
    subscriptionId: string;
    customerId: string;
  }> {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const subscriptionId = uniqueId("sub_ac6c");
    const customerId = uniqueId("cus_ac6c");
    await setSubscriptionDirect(orgA.organizationId, {
      tier: "pro",
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      currentPeriodEnd: new Date(Date.now() + 10 * 24 * 3600 * 1000),
    });
    return { orgA, orgB, subscriptionId, customerId };
  }

  it("AC6 (c) : contexte ambiant = B (organisation et owner de B), abonnement rattache a A -> A est modifiee, B est inchangee", async () => {
    const { orgA, orgB, subscriptionId, customerId } = await twoOrganizationsWithA_Pro();
    const fn = await findApplyFunction();
    const beforeB = await readSubscriptionRow(orgB.organizationId);
    const eventId = uniqueId("evt_ac6c");

    await asBillingCommitted({ organizationId: orgB.organizationId, userId: orgB.owner.userId }, (client) =>
      callApply(
        client,
        fn,
        applyInput({
          stripe_event_id: eventId,
          stripe_subscription_id: subscriptionId,
          stripe_customer_id: customerId,
          metadata_organization_id: orgA.organizationId,
          cancel_at_period_end: true,
        }),
      ),
    );

    expect(await readSubscriptionRow(orgA.organizationId)).toMatchObject({
      cancel_at_period_end: true,
      stripe_subscription_id: subscriptionId,
    });
    expect(await readSubscriptionRow(orgB.organizationId), "B est inchangee").toEqual(beforeB);
    expect(await readBillingEvents(orgB.organizationId), "aucun evenement facturable pour B").toEqual([]);
  });

  it("AC6 (c) : un abonnement deja rattache a A presente avec metadata.organization_id = B leve, sans aucune ecriture", async () => {
    const { orgA, orgB, subscriptionId, customerId } = await twoOrganizationsWithA_Pro();
    const fn = await findApplyFunction();
    const beforeA = await readSubscriptionRow(orgA.organizationId);
    const beforeB = await readSubscriptionRow(orgB.organizationId);
    const eventId = uniqueId("evt_ac6c2");

    const failure = await failureOf(() =>
      asBillingCommitted({ organizationId: orgB.organizationId, userId: orgB.owner.userId }, (client) =>
        callApply(
          client,
          fn,
          applyInput({
            stripe_event_id: eventId,
            stripe_subscription_id: subscriptionId,
            stripe_customer_id: customerId,
            metadata_organization_id: orgB.organizationId,
            cancel_at_period_end: true,
          }),
        ),
      ),
    );

    expectRefusalForTheRightReason(failure, "l'application d'un abonnement de A avec metadata = B");
    expect(await readSubscriptionRow(orgA.organizationId)).toEqual(beforeA);
    expect(await readSubscriptionRow(orgB.organizationId)).toEqual(beforeB);
    expect(await readBillingEvents(orgA.organizationId)).toEqual([]);
    expect(await readBillingEvents(orgB.organizationId)).toEqual([]);
  });
});

describe("AC6 (d) — invariants de catalogue etendus a billing_event", () => {
  it("AC6 (d) : billing_event a la RLS activee ET forcee", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = to_regclass('public.billing_event')",
      ),
    );

    expect(rows, "la table billing_event n'existe pas (migration de la tranche 002 attendue)").toHaveLength(1);
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("AC6 (d) : sur billing_event, signet_app n'a que des politiques de lecture, signet_definer une politique d'INSERT sur context_org() et jamais current_org(", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ polname: string; polcmd: string; roles: string[]; qual: string | null; withcheck: string | null }>(
        `SELECT pol.polname, pol.polcmd::text AS polcmd,
                ARRAY(SELECT CASE WHEN o = 0 THEN 'public' ELSE (SELECT rolname FROM pg_roles WHERE oid = o) END
                        FROM unnest(pol.polroles) AS o) AS roles,
                pg_get_expr(pol.polqual, pol.polrelid) AS qual,
                pg_get_expr(pol.polwithcheck, pol.polrelid) AS withcheck
           FROM pg_policy pol
          WHERE pol.polrelid = to_regclass('public.billing_event')`,
      ),
    );

    expect(rows.length, "billing_event n'a aucune politique").toBeGreaterThan(0);
    const forApp = rows.filter((r) => r.roles.includes("signet_app") || r.roles.includes("public"));
    expect(forApp.length).toBeGreaterThan(0);
    expect(forApp.map((r) => `${r.polname}:${r.polcmd}`).filter((s) => !s.endsWith(":r"))).toEqual([]);
    const forDefiner = rows.filter((r) => r.roles.includes("signet_definer"));
    const insert = forDefiner.find((r) => r.polcmd === "a");
    expect(insert, "politique d'INSERT pour signet_definer").toBeDefined();
    expect(insert?.withcheck ?? "").toContain("context_org(");
    for (const row of forDefiner) {
      expect(`${row.qual ?? ""} ${row.withcheck ?? ""}`, `${row.polname} : current_org( interdit aux politiques signet_definer`).not.toContain("current_org(");
    }
    for (const row of forApp) {
      expect(`${row.qual ?? ""} ${row.withcheck ?? ""}`, `${row.polname} : context_org( interdit aux politiques signet_app`).not.toContain("context_org(");
    }
  });

  it("AC6 (d) : appelee sans aucune donnee Stripe sous un contexte etranger, la fonction leve et n'invente aucune organisation depuis le contexte ambiant", async () => {
    // Complement d'AC6 (c) : avec des arguments NULL, la fonction doit lever
    // plutot que de se rabattre sur app.organization_id.
    const fn = await findApplyFunction();
    const { orgB } = await createTwoOrganizationsFixture();
    const before = await readSubscriptionRow(orgB.organizationId);

    const failure = await failureOf(() =>
      asBilling({ organizationId: orgB.organizationId, userId: orgB.owner.userId }, (client) =>
        callApplyWithNulls(client, fn),
      ),
    );

    expectRefusalForTheRightReason(failure, "un appel sans aucune donnee Stripe sous contexte etranger");
    expect(await readSubscriptionRow(orgB.organizationId)).toEqual(before);
  });
});

describe("AC6 (e) — role signet_billing et reglages des roles (INFO-1, D-064)", () => {
  const FIVE_ROLES = ["signet_owner", "signet_app", "signet_auth", "signet_definer", "signet_billing"];

  it("AC6 (e) : signet_billing est LOGIN avec NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query(
        `SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit
           FROM pg_roles WHERE rolname = 'signet_billing'`,
      ),
    );

    expect(rows, "le role signet_billing n'existe pas (migration de roles de la tranche 002 attendue)").toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rolcanlogin: true,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
    });
  });

  it("AC6 (e) : aucune appartenance entre roles dans un sens ni dans l'autre pour les cinq roles signet_* (member et roleid)", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ member_role: string; parent_role: string }>(
        `SELECT m.rolname AS member_role, r.rolname AS parent_role
           FROM pg_auth_members am
           JOIN pg_roles m ON m.oid = am.member
           JOIN pg_roles r ON r.oid = am.roleid
          WHERE m.rolname = ANY($1::text[]) OR r.rolname = ANY($1::text[])`,
        [FIVE_ROLES],
      ),
    );

    expect(rows).toEqual([]);
  });

  it("AC6 (e) : aucun reglage dans pg_db_role_setting pour les cinq roles signet_* (toutes bases)", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ rolname: string; setconfig: string[] }>(
        `SELECT r.rolname, s.setconfig
           FROM pg_db_role_setting s
           JOIN pg_roles r ON r.oid = s.setrole
          WHERE r.rolname = ANY($1::text[])`,
        [FIVE_ROLES],
      ),
    );

    expect(rows).toEqual([]);
  });
});

describe("AC9 (g) — Pro sans stripe_subscription_id impossible", () => {
  it("AC9 (g) : UPDATE subscription SET tier='pro', stripe_subscription_id=NULL sous la connexion d'administration echoue sur subscription_pro_is_backed_chk (23514)", async () => {
    const org = await createOrganizationFixture("AC9 g contrainte");

    await expect(
      asBypassRls((client) =>
        client.query("UPDATE subscription SET tier = 'pro', stripe_subscription_id = NULL WHERE organization_id = $1", [
          org.organizationId,
        ]),
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "subscription_pro_is_backed_chk" });
    expect(await readSubscriptionRow(org.organizationId)).toMatchObject({ tier: "free" });
  });

  it("AC9 (g) : la fonction d'application leve plutot que d'ecrire un Pro sans abonnement Stripe", async () => {
    const org = await createOrganizationFixture("AC9 g fonction");
    const fn = await findApplyFunction();
    const before = await readSubscriptionRow(org.organizationId);
    const eventId = uniqueId("evt_ac9g");
    const input = applyInput({
      stripe_event_id: eventId,
      stripe_subscription_id: uniqueId("sub_ac9g"),
      metadata_organization_id: org.organizationId,
    });

    const failure = await failureOf(() =>
      asBillingCommitted({}, (client) =>
        client.query(`SELECT ${fn.qualifiedName}($1::jsonb)`, [JSON.stringify({ ...input, stripe_subscription_id: null })]),
      ),
    );

    expectRefusalForTheRightReason(failure, "l'application d'un Pro sans stripe_subscription_id");
    expect(await readSubscriptionRow(org.organizationId)).toEqual(before);
    expect(await readBillingEvents(org.organizationId)).toEqual([]);
  });
});

describe("AC12 — billing_event est append-only", () => {
  async function organizationWithEvent(): Promise<{ organizationId: string; ownerId: string; eventRowId: string }> {
    const org = await createOrganizationFixture("AC12 journal");
    const eventRowId = await insertBillingEventDirect({
      organizationId: org.organizationId,
      stripeEventId: uniqueId("evt_ac12"),
      actorUserId: org.owner.userId,
    });
    return { organizationId: org.organizationId, ownerId: org.owner.userId, eventRowId };
  }

  it.each([
    ["UPDATE", "UPDATE billing_event SET to_tier = 'pro' WHERE id = $1"],
    ["DELETE", "DELETE FROM billing_event WHERE id = $1"],
  ])("AC12 : %s sous signet_app (owner legitime de l'organisation) est refuse par le privilege (42501)", async (_label, sql) => {
    const { organizationId, ownerId, eventRowId } = await organizationWithEvent();
    const before = await readBillingEvents(organizationId);

    const failure = await asTenant({ organizationId, userId: ownerId }, async (client) => {
      const visible = await client.query("SELECT 1 FROM billing_event WHERE id = $1", [eventRowId]);
      expect(visible.rowCount, "temoin positif : la ligne est visible de l'owner").toBe(1);
      return failureOf(() => client.query(sql, [eventRowId]));
    });

    expect(failure?.code).toBe("42501");
    expect(await readBillingEvents(organizationId)).toEqual(before);
  });

  it.each([
    ["UPDATE", "UPDATE billing_event SET to_tier = 'pro' WHERE id = $1"],
    ["DELETE", "DELETE FROM billing_event WHERE id = $1"],
  ])("AC12 : %s sous la connexion d'administration (proprietaire) est refuse par le trigger billing_event_immutable", async (_label, sql) => {
    const { organizationId, eventRowId } = await organizationWithEvent();
    const before = await readBillingEvents(organizationId);

    const failure = await failureOf(() => asBypassRls((client) => client.query(sql, [eventRowId])));

    expectRefusalForTheRightReason(failure, `${_label} sur billing_event par l'administrateur`);
    expect(failure?.code, "pas un refus de privilege : le trigger doit etre la barriere").not.toBe("42501");
    expect(await readBillingEvents(organizationId)).toEqual(before);
  });

  it.each([
    ["UPDATE", "UPDATE billing_event SET to_tier = 'pro' WHERE id = $1"],
    ["DELETE", "DELETE FROM billing_event WHERE id = $1"],
  ])("AC12 : %s sous le role proprietaire des tables (RLS forcee, sans BYPASSRLS) ne modifie jamais la ligne", async (_label, sql) => {
    const { organizationId, eventRowId } = await organizationWithEvent();
    const before = await readBillingEvents(organizationId);

    const outcome = await asTableOwner(async (client: PoolClient) => {
      const failure = await failureOf(() => client.query(sql, [eventRowId]));
      return failure;
    });

    if (outcome !== undefined) expectRefusalForTheRightReason(outcome, `${_label} par le proprietaire des tables`);
    expect(await readBillingEvents(organizationId), "la ligne est intacte").toEqual(before);
  });

  it("AC12 : la suppression d'une organisation laisse ses billing_event en place (aucune FK sur organization_id)", async () => {
    const { organizationId } = await organizationWithEvent();
    const before = await readBillingEvents(organizationId);
    expect(before).toHaveLength(1);

    await asBypassRls((client) => client.query("DELETE FROM organization WHERE id = $1", [organizationId]));

    const orgStillThere = await asBypassRls((client) =>
      client.query("SELECT 1 FROM organization WHERE id = $1", [organizationId]),
    );
    expect(orgStillThere.rowCount, "fixture : l'organisation est supprimee").toBe(0);
    expect(await readBillingEvents(organizationId)).toEqual(before);
  });

  it("AC12 : actor_user_id est mis a NULL (ON DELETE SET NULL) quand l'utilisateur est supprime, la ligne reste", async () => {
    const { organizationId, ownerId } = await organizationWithEvent();
    // L'organisation est supprimee d'abord (le dernier owner d'une organisation vivante est protege par member_keep_last_owner).
    await asBypassRls(async (client) => {
      await client.query("DELETE FROM organization WHERE id = $1", [organizationId]);
      await client.query("DELETE FROM app_user WHERE id = $1", [ownerId]);
    });

    const events = await readBillingEvents(organizationId);

    expect(events).toHaveLength(1);
    expect(events[0]?.actor_user_id).toBeNull();
  });

  it("AC12 : la forme d'un evenement est contrainte (billing_event_shape) — un tier_changed de pro vers pro est refuse (23514)", async () => {
    const org = await createOrganizationFixture("AC12 forme");

    await expect(
      asBypassRls((client) =>
        client.query(
          `INSERT INTO billing_event (organization_id, type, from_tier, to_tier, stripe_event_id, occurred_at)
           VALUES ($1, 'tier_changed', 'pro', 'pro', $2, now())`,
          [org.organizationId, `evt_shape_${randomUUID().slice(0, 8)}`],
        ),
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "billing_event_shape" });
  });

  it("AC12 : un meme stripe_event_id ne peut etre insere deux fois (index unique partiel) — 23505", async () => {
    const org = await createOrganizationFixture("AC12 unicite");
    const stripeEventId = uniqueId("evt_uniq");
    await insertBillingEventDirect({ organizationId: org.organizationId, stripeEventId });

    await expect(insertBillingEventDirect({ organizationId: org.organizationId, stripeEventId })).rejects.toMatchObject({
      code: "23505",
    });
    expect(await readBillingEvents(org.organizationId)).toHaveLength(1);
  });
});
