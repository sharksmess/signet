/**
 * Tranche 010 — AC4 : fonctions SECURITY DEFINER et invariants de catalogue
 * (ADR-0011 § Tests exiges, ERD §1). Les invariants de 001 (creation par
 * signet.create_organization() seul chemin, dernier owner protege,
 * propagation du palier sans contexte ambiant) restent dans
 * tests/organizations/invariants.test.ts, inchange (AC1) : ce fichier ne les
 * duplique pas, il couvre les garanties NOUVELLES de cette tranche.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { asTenant, asBypassRls, closeAllPools, resetDatabase } from "../helpers/db";
import { createOrganizationFixture } from "../helpers/fixtures";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeAllPools();
});

describe("AC4 — organizations_for_user : identite de session obligatoire (SG002)", () => {
  it("AC4 : organizations_for_user sans app.user_id leve SG002", async () => {
    const someUserId = "00000000-0000-7000-8000-0000000000bb";

    await expect(
      asTenant({}, async (client) => {
        await client.query<Record<string, unknown>>("SELECT * FROM signet.organizations_for_user($1)", [someUserId]);
      }),
    ).rejects.toMatchObject({ code: "SG002" });
  });

  it("AC4 : organizations_for_user avec un parametre different de app.user_id leve SG002", async () => {
    const org = await createOrganizationFixture("SG002 Parametre Different");
    const differentUserId = "00000000-0000-7000-8000-0000000000cc";

    await expect(
      asTenant({ userId: org.owner.userId }, async (client) => {
        await client.query<Record<string, unknown>>("SELECT * FROM signet.organizations_for_user($1)", [differentUserId]);
      }),
    ).rejects.toMatchObject({ code: "SG002" });
  });
});

/** Lecture de controle sous la connexion d'administration (hors RLS). */
async function countOrganizationsNamed(name: string): Promise<string | undefined> {
  const { rows } = await asBypassRls((client) =>
    client.query<{ c: string }>("SELECT count(*)::text AS c FROM organization WHERE name = $1", [name]),
  );
  return rows[0]?.c;
}

describe("AC4 — create_organization : identite de session obligatoire (SG002), aucune organisation creee", () => {
  it("AC4 : create_organization sans app.user_id leve SG002 et ne cree aucune organisation (boite blanche)", async () => {
    const orgName = `SG002 Sans Identite ${Date.now()}`;
    const someOwnerId = "00000000-0000-7000-8000-0000000000dd";

    await expect(
      asTenant({}, async (client) => {
        await client.query<Record<string, unknown>>("SELECT * FROM signet.create_organization($1, $2)", [someOwnerId, orgName]);
      }),
    ).rejects.toMatchObject({ code: "SG002" });

    // Boite blanche, hors RLS et apres la transaction : une lecture sous
    // signet_app rendrait 0 ligne meme si l'organisation existait, et une
    // lecture dans la transaction deja annulee par l'exception leverait 25P02.
    expect(await countOrganizationsNamed(orgName)).toBe("0");
  });

  it("AC4 : create_organization avec p_owner_user_id different de app.user_id leve SG002 et ne cree aucune organisation", async () => {
    const orgName = `SG002 Owner Different ${Date.now()}`;
    const sessionUserId = "00000000-0000-7000-8000-0000000000ee";
    const differentOwnerId = "00000000-0000-7000-8000-0000000000ff";

    await expect(
      asTenant({ userId: sessionUserId }, async (client) => {
        await client.query<Record<string, unknown>>("SELECT * FROM signet.create_organization($1, $2)", [differentOwnerId, orgName]);
      }),
    ).rejects.toMatchObject({ code: "SG002" });

    expect(await countOrganizationsNamed(orgName)).toBe("0");
  });
});

describe("Tests exiges (ADR-0011) — catalogue et primitives", () => {
  it("Catalogue : toute fonction SECURITY DEFINER du schema signet appartient a signet_definer", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ sig: string; owner: string }>(
        `SELECT p.oid::regprocedure::text AS sig, r.rolname AS owner
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           JOIN pg_roles r ON r.oid = p.proowner
          WHERE p.prosecdef AND n.nspname = 'signet'`,
      ),
    );
    const bad = rows.filter((r) => r.owner !== "signet_definer").map((r) => `${r.sig} (owner=${r.owner})`);
    expect(bad, "une fonction SECURITY DEFINER de signet n'est pas possedee par signet_definer").toEqual([]);
  });

  it("Catalogue : aucune politique applicable a signet_definer n'appelle current_org( (recursion, ADR-0011 R1)", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ policy: string; qual: string | null; withcheck: string | null }>(
        `SELECT n.nspname || '.' || c.relname || '.' || pol.polname AS policy,
                pg_get_expr(pol.polqual, pol.polrelid) AS qual,
                pg_get_expr(pol.polwithcheck, pol.polrelid) AS withcheck
           FROM pg_policy pol
           JOIN pg_class c ON c.oid = pol.polrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE pol.polroles @> ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'signet_definer')]::oid[]`,
      ),
    );
    const bad = rows
      .filter((r) => (r.qual ?? "").includes("current_org(") || (r.withcheck ?? "").includes("current_org("))
      .map((r) => r.policy);
    expect(bad, "une politique signet_definer appelle current_org(, rouvre la recursion sur member").toEqual([]);
  });

  it("Catalogue : aucune politique applicable a signet_app n'appelle context_org( (primitive reservee a signet_definer)", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ policy: string; qual: string | null; withcheck: string | null }>(
        `SELECT n.nspname || '.' || c.relname || '.' || pol.polname AS policy,
                pg_get_expr(pol.polqual, pol.polrelid) AS qual,
                pg_get_expr(pol.polwithcheck, pol.polrelid) AS withcheck
           FROM pg_policy pol
           JOIN pg_class c ON c.oid = pol.polrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE pol.polroles @> ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'signet_app')]::oid[]`,
      ),
    );
    const bad = rows
      .filter((r) => (r.qual ?? "").includes("context_org(") || (r.withcheck ?? "").includes("context_org("))
      .map((r) => r.policy);
    expect(bad, "une politique signet_app appelle context_org(, la primitive brute reservee a signet_definer").toEqual(
      [],
    );
  });

  it("signet.context_org() existe, et n'est executable ni par signet_app ni par PUBLIC", async () => {
    const oidResult = await asBypassRls((client) =>
      client.query<{ oid: string | null }>("SELECT to_regprocedure('signet.context_org()')::text AS oid"),
    );
    const oid = oidResult.rows[0]?.oid;
    expect(oid, "signet.context_org() n'existe pas encore (migration 0009 attendue)").not.toBeNull();

    const priv = await asBypassRls((client) =>
      client.query<{ app: boolean; pub: boolean }>(
        `SELECT has_function_privilege('signet_app', $1::regprocedure, 'EXECUTE') AS app,
                has_function_privilege('public', $1::regprocedure, 'EXECUTE') AS pub`,
        [oid],
      ),
    );
    expect(priv.rows[0]?.app, "signet_app ne doit jamais executer context_org()").toBe(false);
    expect(priv.rows[0]?.pub, "PUBLIC ne doit jamais executer context_org()").toBe(false);
  });

  it("signet.current_org() sans contexte renvoie NULL sans lever (primitive de politique, pas une operation)", async () => {
    const value = await asTenant({}, async (client) => {
      const result = await client.query<{ v: string | null }>("SELECT signet.current_org() AS v");
      return result.rows[0]?.v;
    });
    expect(value).toBeNull();
  });

  it("Catalogue : le search_path de chaque fonction SECURITY DEFINER de signet contient pg_temp (en dernier)", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ sig: string; config: string[] | null }>(
        `SELECT p.oid::regprocedure::text AS sig, p.proconfig AS config
           FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.prosecdef AND n.nspname = 'signet'`,
      ),
    );
    const bad = rows
      .filter((r) => {
        const searchPathEntry = (r.config ?? []).find((c) => c.startsWith("search_path="));
        if (!searchPathEntry) return true;
        const parts = searchPathEntry
          .slice("search_path=".length)
          .split(",")
          .map((s) => s.trim());
        return parts[parts.length - 1] !== "pg_temp";
      })
      .map((r) => r.sig);
    expect(bad, "une fonction SECURITY DEFINER de signet n'a pas pg_temp en dernier dans son search_path").toEqual([]);
  });
});
