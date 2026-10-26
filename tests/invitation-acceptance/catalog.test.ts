/**
 * Tranche 006 — catalogue Postgres : AC4 (proconfig), AC12 (fonctions, politiques,
 * privileges) et AC13 (condition de Q-3, D-103 : la seule ECRITURE nouvelle de
 * `signet_definer` sur `invitation` est un UPDATE borne a l'acceptation).
 *
 * Lectures du catalogue sous la connexion d'administration (le catalogue n'est pas
 * soumis a la RLS) ; le volet comportemental d'AC13 (d) execute des UPDATE sous
 * `SET ROLE signet_definer` depuis la connexion d'administration : aucune
 * appartenance de role n'est ajoutee (ADR-0007), la transaction est toujours annulee.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signUp } from "../helpers/auth";
import { asBypassRls, closeAllPools } from "../helpers/db";
import { inviteeEmail } from "../helpers/invitations";
import { forgeInvitation } from "../helpers/invitations-accept";

afterAll(async () => {
  await closeAllPools();
});

interface FunctionRow {
  proname: string;
  sig: string;
  args: string;
  result: string;
  prosecdef: boolean;
  provolatile: string;
  owner: string;
  proconfig: string[] | null;
}

async function newFunctions(): Promise<FunctionRow[]> {
  const { rows } = await asBypassRls((client) =>
    client.query<FunctionRow>(
      `SELECT p.proname, p.oid::regprocedure::text AS sig, pg_get_function_identity_arguments(p.oid) AS args,
              pg_get_function_result(p.oid) AS result, p.prosecdef, p.provolatile::text AS provolatile,
              r.rolname AS owner, p.proconfig
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_roles r ON r.oid = p.proowner
        WHERE n.nspname = 'signet' AND p.proname IN ('lookup_invitation', 'accept_invitation')
        ORDER BY p.proname`,
    ),
  );
  return rows;
}

interface PolicyRow {
  polname: string;
  relname: string;
  polcmd: string;
  roles: string[];
  qual: string | null;
  withcheck: string | null;
}

/** Politiques de `table` applicables a `role` (clause TO le nommant, ou TO PUBLIC). */
async function policiesFor(table: string, role: string): Promise<PolicyRow[]> {
  const { rows } = await asBypassRls((client) =>
    client.query<PolicyRow>(
      `SELECT pol.polname, c.relname, pol.polcmd::text AS polcmd,
              ARRAY(SELECT CASE WHEN o = 0 THEN 'public' ELSE (SELECT rolname::text FROM pg_roles WHERE oid = o) END
                      FROM unnest(pol.polroles) AS o) AS roles,
              pg_get_expr(pol.polqual, pol.polrelid) AS qual,
              pg_get_expr(pol.polwithcheck, pol.polrelid) AS withcheck
         FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
        WHERE pol.polrelid = to_regclass($1)
          AND (pol.polroles @> ARRAY[(SELECT oid FROM pg_roles WHERE rolname = $2)]::oid[] OR 0::oid = ANY(pol.polroles))
        ORDER BY pol.polname`,
      [`public.${table}`, role],
    ),
  );
  return rows;
}

const normalized = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, " ").replace(/[()]/g, "").replace(/signet\./g, "");

// ---------------------------------------------------------------------------
// AC12
// ---------------------------------------------------------------------------

describe("AC12 — fonctions SECURITY DEFINER du schema signet (D-033, ADR-0011)", () => {
  it("AC12 : l'ensemble des fonctions SECURITY DEFINER de signet est celui d'avant la migration 0015 plus lookup_invitation et accept_invitation", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ proname: string }>(
        `SELECT DISTINCT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.prosecdef AND n.nspname = 'signet' ORDER BY p.proname`,
      ),
    );

    expect(rows.map((r) => r.proname)).toEqual(
      [
        "accept_invitation",
        "apply_stripe_subscription",
        "assert_owner_remains",
        "create_organization",
        "create_organization_counters",
        "current_org",
        "lookup_invitation",
        "organizations_for_user",
        "propagate_subscription_quota",
      ].sort(),
    );
  });

  it("AC12 : lookup_invitation(bytea) et accept_invitation(bytea) : SECURITY DEFINER, proprietaire signet_definer, signatures et colonnes de retour exactes, volatilite STABLE / VOLATILE", async () => {
    const functions = await newFunctions();

    expect(functions.map((f) => f.sig), "deux fonctions, une signature chacune").toEqual([
      "signet.accept_invitation(bytea)",
      "signet.lookup_invitation(bytea)",
    ]);
    const [accept, lookup] = functions;
    for (const fn of functions) {
      expect(fn.prosecdef, `${fn.proname} : SECURITY DEFINER`).toBe(true);
      expect(fn.owner, `${fn.proname} : proprietaire`).toBe("signet_definer");
      expect(fn.args, `${fn.proname} : un seul parametre, sans identifiant d'utilisateur`).toBe("p_token_hash bytea");
    }
    expect(lookup?.result, "colonnes de retour de lookup_invitation (rien d'autre que le nom, l'e-mail et l'etat)").toBe(
      "TABLE(organization_name text, email text, state text)",
    );
    expect(accept?.result).toBe("TABLE(organization_id uuid)");
    expect(lookup?.provolatile, "lookup_invitation est STABLE").toBe("s");
    expect(accept?.provolatile, "accept_invitation est VOLATILE").toBe("v");
  });

  it("AC4 / AC12 : search_path fige (pg_temp en dernier) et TimeZone=UTC dans proconfig des deux fonctions (D-091)", async () => {
    const functions = await newFunctions();

    expect(functions).toHaveLength(2);
    for (const fn of functions) {
      expect(fn.proconfig, `${fn.proname} : search_path`).toContain("search_path=pg_catalog, signet, public, pg_temp");
      expect(fn.proconfig, `${fn.proname} : fuseau fige`).toContain("TimeZone=UTC");
    }
  });

  it("AC12 : EXECUTE pour signet_app seul (ni PUBLIC, ni signet_auth, signet_billing, signet_owner)", async () => {
    const functions = await newFunctions();
    expect(functions).toHaveLength(2);

    for (const fn of functions) {
      const { rows } = await asBypassRls((client) =>
        client.query<{ grantee: string; allowed: boolean }>(
          `SELECT g.grantee, has_function_privilege(g.grantee, $1::regprocedure, 'EXECUTE') AS allowed
             FROM unnest(ARRAY['public', 'signet_app', 'signet_auth', 'signet_billing', 'signet_owner']) AS g(grantee)`,
          [fn.sig],
        ),
      );
      expect(rows.filter((r) => r.allowed).map((r) => r.grantee), `${fn.sig} : seul signet_app peut l'executer`).toEqual(["signet_app"]);
    }
  });

  it("AC12 : les quatre politiques nouvelles sont TO signet_definer seulement, n'appellent pas current_org( (ADR-0011 R1), et ont la commande attendue", async () => {
    const expected: Array<[string, string, string]> = [
      ["invitation", "invitation_definer_token_lookup", "r"],
      ["invitation", "invitation_definer_context_read", "r"],
      ["invitation", "invitation_definer_accept", "w"],
      ["app_user", "app_user_definer_self_read", "r"],
    ];

    for (const [table, name, command] of expected) {
      const policy = (await policiesFor(table, "signet_definer")).find((p) => p.polname === name);
      expect(policy, `${table}.${name} existe et s'applique a signet_definer`).toBeDefined();
      expect(policy?.roles, `${name} : TO signet_definer seulement`).toEqual(["signet_definer"]);
      expect(policy?.polcmd, `${name} : commande`).toBe(command);
      expect(`${policy?.qual ?? ""} ${policy?.withcheck ?? ""}`, `${name} : jamais current_org(`).not.toContain("current_org(");
    }
  });

  it("AC12 : politiques de lecture — empreinte (reglage transitoire app.invitation_token_hash), contexte de l'organisation ; app_user : sa propre ligne (current_user_id)", async () => {
    const invitation = await policiesFor("invitation", "signet_definer");
    const appUser = await policiesFor("app_user", "signet_definer");

    const byToken = invitation.find((p) => p.polname === "invitation_definer_token_lookup");
    expect(normalized(byToken?.qual)).toContain("token_hash");
    expect(normalized(byToken?.qual)).toContain("app.invitation_token_hash");
    const byContext = invitation.find((p) => p.polname === "invitation_definer_context_read");
    expect(normalized(byContext?.qual)).toMatch(/organization_id = context_org/);
    const self = appUser.find((p) => p.polname === "app_user_definer_self_read");
    expect(normalized(self?.qual)).toMatch(/id = current_user_id/);
  });

  it("AC12 : signet_definer ne lit de app_user que (id, email) ; signet_app garde SELECT, INSERT, DELETE sur invitation (ni UPDATE, ni TRUNCATE)", async () => {
    const columns = await asBypassRls((client) =>
      client.query<{ attname: string; can_select: boolean }>(
        `SELECT a.attname::text AS attname, has_column_privilege('signet_definer', c.oid, a.attnum, 'SELECT') AS can_select
           FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
          WHERE a.attrelid = to_regclass('public.app_user') AND a.attnum > 0 AND NOT a.attisdropped`,
      ),
    );
    expect(columns.rows.filter((c) => c.can_select).map((c) => c.attname).sort(), "colonnes de app_user lisibles par signet_definer").toEqual(["email", "id"]);

    const app = await asBypassRls((client) =>
      client.query<{ privilege: string; allowed: boolean }>(
        `SELECT p.privilege, has_table_privilege('signet_app', to_regclass('public.invitation'), p.privilege) AS allowed
           FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p(privilege)`,
      ),
    );
    expect(app.rows.filter((r) => r.allowed).map((r) => r.privilege).sort()).toEqual(["DELETE", "INSERT", "SELECT"]);
  });
});

// ---------------------------------------------------------------------------
// AC13
// ---------------------------------------------------------------------------

describe("AC13 — seule ecriture nouvelle : un UPDATE borne a l'acceptation (condition de Q-3, D-103)", () => {
  it("AC13 (a) : signet_definer a SELECT au niveau table ; UPDATE sur exactement accepted_at et accepted_by_user_id ; ni INSERT, ni DELETE, ni TRUNCATE", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ attname: string; can_update: boolean; can_insert: boolean }>(
        `SELECT a.attname::text AS attname,
                has_column_privilege('signet_definer', c.oid, a.attnum, 'UPDATE') AS can_update,
                has_column_privilege('signet_definer', c.oid, a.attnum, 'INSERT') AS can_insert
           FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
          WHERE a.attrelid = to_regclass('public.invitation') AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY a.attnum`,
      ),
    );
    const table = await asBypassRls((client) =>
      client.query<{ privilege: string; allowed: boolean }>(
        `SELECT p.privilege, has_table_privilege('signet_definer', to_regclass('public.invitation'), p.privilege) AS allowed
           FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p(privilege)`,
      ),
    );

    expect(rows.length, "colonnes de invitation lues").toBeGreaterThan(8);
    expect(rows.filter((c) => c.can_update).map((c) => c.attname).sort(), "UPDATE : exactement ces deux colonnes").toEqual(["accepted_at", "accepted_by_user_id"]);
    for (const column of ["email", "expires_at", "organization_id", "token_hash", "role", "invited_by_user_id", "created_at", "id"]) {
      expect(rows.find((c) => c.attname === column)?.can_update, `UPDATE de ${column} refuse`).toBe(false);
    }
    expect(rows.filter((c) => c.can_insert).map((c) => c.attname), "INSERT : aucune colonne").toEqual([]);
    expect(table.rows.filter((r) => r.allowed).map((r) => r.privilege), "niveau table : SELECT seulement").toEqual(["SELECT"]);
  });

  it("AC13 (b) : exactement trois politiques s'appliquent a signet_definer sur invitation : deux SELECT (r) et un UPDATE (w) ; aucune ALL, INSERT ni DELETE", async () => {
    const policies = await policiesFor("invitation", "signet_definer");

    expect(policies.map((p) => `${p.polname}:${p.polcmd}`).sort()).toEqual([
      "invitation_definer_accept:w",
      "invitation_definer_context_read:r",
      "invitation_definer_token_lookup:r",
    ]);
    expect(policies.filter((p) => ["*", "a", "d"].includes(p.polcmd)), "aucune politique ALL, INSERT ni DELETE").toEqual([]);
  });

  it("AC13 (c) : invitation_definer_accept — USING : context_org() et accepted_at IS NULL ; WITH CHECK : context_org(), accepted_at IS NOT NULL et accepted_by_user_id = current_user_id()", async () => {
    const policy = (await policiesFor("invitation", "signet_definer")).find((p) => p.polname === "invitation_definer_accept");

    expect(policy, "invitation_definer_accept existe").toBeDefined();
    const using = normalized(policy?.qual);
    const check = normalized(policy?.withcheck);
    expect(using).toMatch(/organization_id = context_org/);
    expect(using).toContain("accepted_at IS NULL");
    expect(check).toMatch(/organization_id = context_org/);
    expect(check).toContain("accepted_at IS NOT NULL");
    expect(check).toMatch(/accepted_by_user_id = current_user_id/);
  });

  it("AC13 (d) : sous SET ROLE signet_definer, un UPDATE d'une autre colonne (email, expires_at, organization_id) ou posant accepted_by_user_id a un autre utilisateur est refuse ; l'acceptation legitime reussit une fois ; une ligne deja acceptee n'est plus modifiable", async () => {
    const email = inviteeEmail();
    const forged = await forgeInvitation({ email, label: "AC13 d" });
    const invitee = await signUp({ email });
    const stranger = await signUp();

    const outcome = await asBypassRls(async (client) => {
      await client.query("BEGIN");
      try {
        const { rows } = await client.query<{ rolsuper: boolean }>("SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
        expect(
          rows[0]?.rolsuper,
          "ce volet exige que la connexion d'administration de test puisse faire SET ROLE sans appartenance (superutilisateur, ADR-0007) ; sinon le remplacer par (a) a (c) et l'ecrire dans le journal de tranche",
        ).toBe(true);
        await client.query("SELECT set_config('app.organization_id', $1, true), set_config('app.user_id', $2, true)", [
          forged.org.organizationId,
          invitee.userId,
        ]);
        await client.query("SET LOCAL lc_messages = 'C'");
        await client.query("SET LOCAL ROLE signet_definer");
        const attempt = async (sql: string, params: unknown[]): Promise<{ rowCount: number | null; code?: string; message?: string }> => {
          await client.query("SAVEPOINT attempt");
          try {
            const result = await client.query(sql, params);
            await client.query("RELEASE SAVEPOINT attempt");
            return { rowCount: result.rowCount };
          } catch (error) {
            await client.query("ROLLBACK TO SAVEPOINT attempt");
            const failure = error as { code?: string; message?: string };
            return { rowCount: null, code: failure.code, message: failure.message };
          }
        };
        const id = forged.row.id;
        const result = {
          email: await attempt("UPDATE invitation SET email = $2 WHERE id = $1", [id, "autre@example.test"]),
          expires: await attempt("UPDATE invitation SET expires_at = expires_at - interval '1 hour' WHERE id = $1", [id]),
          organization: await attempt("UPDATE invitation SET organization_id = $2 WHERE id = $1", [id, stranger.userId]),
          otherUser: await attempt(
            "UPDATE invitation SET accepted_at = now(), accepted_by_user_id = $2 WHERE id = $1",
            [id, stranger.userId],
          ),
          legitimate: await attempt(
            "UPDATE invitation SET accepted_at = now(), accepted_by_user_id = signet.current_user_id() WHERE id = $1",
            [id],
          ),
          again: await attempt("UPDATE invitation SET accepted_at = now(), accepted_by_user_id = signet.current_user_id() WHERE id = $1", [id]),
          reassign: await attempt("UPDATE invitation SET accepted_by_user_id = $2 WHERE id = $1", [id, stranger.userId]),
        };
        return result;
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
      }
    });

    expect(outcome.legitimate, "temoin positif : l'acceptation legitime modifie une ligne").toEqual({ rowCount: 1 });
    for (const column of ["email", "expires", "organization"] as const) {
      expect(outcome[column].code, `${column} : refus par privilege de colonne (${outcome[column].message})`).toBe("42501");
      expect(outcome[column].message, `${column} : refus de privilege`).toMatch(/permission denied/i);
    }
    expect(outcome.otherUser.code, `accepted_by_user_id d'un autre utilisateur : refus par WITH CHECK (${outcome.otherUser.message})`).toBe("42501");
    expect(outcome.otherUser.message).toMatch(/row-level security/i);
    expect(outcome.again, "ligne deja acceptee : aucune ligne modifiable (USING accepted_at IS NULL)").toEqual({ rowCount: 0 });
    expect(outcome.reassign, "ligne deja acceptee : accepted_by_user_id non reaffectable").toEqual({ rowCount: 0 });
  });
});
