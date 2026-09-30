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
import { signUp } from "../helpers/auth";

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

/**
 * Controle de coherence sous la connexion d'administration (hors RLS).
 *
 * Ce n'est PAS une preuve independante : `asTenant` annule toujours sa
 * transaction, donc toute organisation creee a l'interieur aurait disparu
 * avant cette lecture, quelle que soit l'implementation. La preuve que
 * rien n'est cree tient a l'assertion `code: "SG002"` (l'instruction echoue,
 * atomiquement) ; ce comptage verifie seulement que rien n'a fui hors de la
 * transaction de test.
 */
async function countOrganizationsNamed(name: string): Promise<string | undefined> {
  const { rows } = await asBypassRls((client) =>
    client.query<{ c: string }>("SELECT count(*)::text AS c FROM organization WHERE name = $1", [name]),
  );
  return rows[0]?.c;
}

/**
 * Les utilisateurs sont REELS (ligne `app_user`) : sans la garde SG002, la
 * version de 0003 de `create_organization` reussirait (le membre owner
 * satisfait la FK), et le test echouerait sur l'absence de SG002. Avec des
 * UUID sans ligne `app_user`, l'ancienne fonction echouait deja en 23503 et
 * l'assertion ne discriminait que par le code (audit-010 INFO-3, review-010
 * A CORRIGER-2).
 */
describe("AC4 — create_organization : identite de session obligatoire (SG002), aucune organisation creee", () => {
  it("AC4 : create_organization sans app.user_id leve SG002 (owner reel), aucune organisation ne subsiste", async () => {
    const orgName = `SG002 Sans Identite ${Date.now()}`;
    const realOwner = await signUp();

    await expect(
      asTenant({}, async (client) => {
        await client.query<Record<string, unknown>>("SELECT * FROM signet.create_organization($1, $2)", [
          realOwner.userId,
          orgName,
        ]);
      }),
    ).rejects.toMatchObject({ code: "SG002" });

    // Controle de coherence seulement (voir countOrganizationsNamed).
    expect(await countOrganizationsNamed(orgName)).toBe("0");
  });

  it("AC4 : create_organization au nom d'un tiers reel (owner d'une autre organisation) leve SG002", async () => {
    const orgName = `SG002 Owner Different ${Date.now()}`;
    const sessionUser = await signUp();
    // Tiers reel : owner effectif d'une autre fixture. Sans la garde,
    // l'appel creerait une organisation dont ce tiers serait owner.
    const otherOrg = await createOrganizationFixture("SG002 Tiers Reel");

    await expect(
      asTenant({ userId: sessionUser.userId }, async (client) => {
        await client.query<Record<string, unknown>>("SELECT * FROM signet.create_organization($1, $2)", [
          otherOrg.owner.userId,
          orgName,
        ]);
      }),
    ).rejects.toMatchObject({ code: "SG002" });

    // Controle de coherence seulement (voir countOrganizationsNamed).
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
          WHERE pol.polroles @> ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'signet_definer')]::oid[]
             -- Politique sans clause TO (PUBLIC, polroles = {0}) : s'applique aussi a signet_definer.
             OR 0::oid = ANY(pol.polroles)`,
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
          WHERE pol.polroles @> ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'signet_app')]::oid[]
             -- Politique sans clause TO (PUBLIC, polroles = {0}) : s'applique aussi a signet_app.
             OR 0::oid = ANY(pol.polroles)`,
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

  /**
   * Cas limite concurrence (ADR-0011 § c) : STABLE est ce qui garantit
   * qu'aucune appartenance n'est mise en cache au-dela d'une instruction ;
   * IMMUTABLE est interdit (pre-evaluation figee dans un plan prepare
   * reutilise par le pool). Un test comportemental ne distingue pas les deux
   * sur des requetes non preparees : la volatilite est donc epinglee ici.
   */
  it("Catalogue : signet.current_org() est STABLE, SECURITY DEFINER, possedee par signet_definer", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ provolatile: string; prosecdef: boolean; owner: string }>(
        `SELECT p.provolatile, p.prosecdef, r.rolname AS owner
           FROM pg_proc p
           JOIN pg_roles r ON r.oid = p.proowner
          WHERE p.oid = 'signet.current_org()'::regprocedure`,
      ),
    );
    expect(rows).toEqual([{ provolatile: "s", prosecdef: true, owner: "signet_definer" }]);
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
