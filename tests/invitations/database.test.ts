/**
 * Tranche 003 — garanties portees par la base : AC5 (b, c), AC6 (base),
 * AC11, AC15 (catalogue), et contrat de donnees de la table `invitation`
 * (ERD §5).
 *
 * Les assertions d'isolation et d'autorisation passent par `asTenant`, donc par
 * le role applicatif `signet_app` (jamais un superutilisateur : il contournerait
 * la RLS et le test passerait toujours). La connexion d'administration ne sert
 * qu'a l'arrangement et aux lectures de controle.
 */
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { asBypassRls, asTenant, closeAllPools } from "../helpers/db";
import { signUp } from "../helpers/auth";
import { ROOT } from "../_factory/env";
import { addMemberDirect, createOrganizationFixture, createTwoOrganizationsFixture } from "../helpers/fixtures";
import {
  SEVEN_DAYS_SECONDS,
  insertInvitationDirect,
  randomTokenHash,
  readInvitationById,
  readInvitations,
} from "../helpers/invitations-db";
import { inviteeEmail } from "../helpers/invitations";

afterAll(async () => {
  await closeAllPools();
});

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

/** Codes qui signaleraient une erreur de test ou une absence d'implementation, jamais le refus attendu. */
const WRONG_REASON = ["42883", "42601", "42P01", "42703", "22P02", "08006", "28000", "28P01", "3D000"];

function expectPrivilegeRefusal(failure: PgFailure | undefined, what: string): void {
  expect(failure, `${what} doit etre refuse`).toBeDefined();
  expect(WRONG_REASON, `${what} : refus pour la mauvaise raison (${failure?.code} ${failure?.message})`).not.toContain(failure?.code);
  expect(failure?.code, `${what} : refus attendu par la RLS ou le privilege (42501)`).toBe("42501");
}

function insertSql(): string {
  return `INSERT INTO invitation (organization_id, email, token_hash, invited_by_user_id) VALUES ($1, $2, $3, $4)`;
}

function createViaFunction(client: PoolClient, organizationId: string, email: string) {
  return client.query<{ id: string; invited_by_user_id: string; role: string; lifetime: number; organization_id: string }>(
    `SELECT id, invited_by_user_id, role, organization_id,
            extract(epoch FROM (expires_at - created_at))::float8 AS lifetime
       FROM signet.create_invitation($1::uuid, $2::text, $3::bytea)`,
    [organizationId, email, randomTokenHash()],
  );
}

describe("AC5 (b) — isolation tenant en base, contexte etranger force (signet_app)", () => {
  it("AC5 (b) : contexte B + utilisateur owner de A -> 0 ligne de B visible, INSERT direct et create_invitation(B) refuses (42501), DELETE : 0 ligne, invitations de B intactes", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const invitationB = await insertInvitationDirect({
      organizationId: orgB.organizationId,
      email: inviteeEmail(),
      invitedByUserId: orgB.owner.userId,
    });
    const foreign = { organizationId: orgB.organizationId, userId: orgA.owner.userId };
    const legit = { organizationId: orgB.organizationId, userId: orgB.owner.userId };

    const witness = await asTenant(legit, async (client) =>
      (await client.query<{ id: string }>("SELECT id FROM invitation WHERE organization_id = $1", [orgB.organizationId])).rows,
    );
    expect(witness, "temoin positif : l'owner de B voit son invitation").toEqual([{ id: invitationB.id }]);

    const seen = await asTenant(foreign, async (client) => ({
      byOrg: (await client.query<{ id: string }>("SELECT id FROM invitation WHERE organization_id = $1", [orgB.organizationId])).rows,
      byId: (await client.query("SELECT id FROM invitation WHERE id = $1", [invitationB.id])).rows,
    }));
    expect(seen).toEqual({ byOrg: [], byId: [] });

    const insertFailure = await asTenant(foreign, (client) =>
      failureOf(() => client.query(insertSql(), [orgB.organizationId, inviteeEmail(), randomTokenHash(), orgA.owner.userId])),
    );
    expectPrivilegeRefusal(insertFailure, "INSERT direct dans invitation sous contexte etranger");

    const functionFailure = await asTenant(foreign, (client) => failureOf(() => createViaFunction(client, orgB.organizationId, inviteeEmail())));
    expectPrivilegeRefusal(functionFailure, "signet.create_invitation(B) sous contexte etranger");

    const deleted = await asTenant(foreign, (client) => client.query("DELETE FROM invitation WHERE organization_id = $1", [orgB.organizationId]));
    expect(deleted.rowCount, "DELETE des lignes de B : 0 ligne").toBe(0);

    expect(await readInvitations(orgB.organizationId), "les invitations de B sont intactes").toHaveLength(1);
    expect((await readInvitationById(invitationB.id))?.token_hash.equals(invitationB.token_hash)).toBe(true);
  });

  it("AC5 (b) : contexte A (owner de A) mais organisation cible B passee en parametre ou en colonne -> refus (42501), rien n'est cree chez B", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const ownContext = { organizationId: orgA.organizationId, userId: orgA.owner.userId };
    const email = inviteeEmail();

    const viaFunction = await asTenant(ownContext, (client) => failureOf(() => createViaFunction(client, orgB.organizationId, email)));
    const viaInsert = await asTenant(ownContext, (client) =>
      failureOf(() => client.query(insertSql(), [orgB.organizationId, email, randomTokenHash(), orgA.owner.userId])),
    );

    expectPrivilegeRefusal(viaFunction, "create_invitation(B) depuis le contexte de A");
    expectPrivilegeRefusal(viaInsert, "INSERT organization_id = B depuis le contexte de A");
    expect(await readInvitations(orgB.organizationId, email)).toEqual([]);
  });
});

describe("AC5 (c) — les invitations de A ne sont jamais visibles sous le contexte de l'owner de B", () => {
  it("AC5 (c) : l'owner de B ne voit que les invitations de B, jamais celles de A", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const invitationA = await insertInvitationDirect({ organizationId: orgA.organizationId, email: inviteeEmail(), invitedByUserId: orgA.owner.userId });
    const invitationB = await insertInvitationDirect({ organizationId: orgB.organizationId, email: inviteeEmail(), invitedByUserId: orgB.owner.userId });

    const visibleToB = await asTenant({ organizationId: orgB.organizationId, userId: orgB.owner.userId }, async (client) =>
      (await client.query<{ id: string }>("SELECT id FROM invitation WHERE id = ANY($1::uuid[])", [[invitationA.id, invitationB.id]])).rows.map((r) => r.id),
    );
    const bWantsA = await asTenant({ organizationId: orgB.organizationId, userId: orgB.owner.userId }, async (client) =>
      (await client.query<{ id: string }>("SELECT id FROM invitation WHERE organization_id = $1", [orgA.organizationId])).rows,
    );
    const visibleToA = await asTenant({ organizationId: orgA.organizationId, userId: orgA.owner.userId }, async (client) =>
      (await client.query<{ id: string }>("SELECT id FROM invitation WHERE id = ANY($1::uuid[])", [[invitationA.id, invitationB.id]])).rows.map((r) => r.id),
    );

    expect(visibleToB).toEqual([invitationB.id]);
    expect(bWantsA, "meme en visant explicitement l'organisation A").toEqual([]);
    expect(visibleToA, "temoin symetrique").toEqual([invitationA.id]);
  });
});

describe("AC6 (base) — permission insuffisante, owner seul (D-086 P-3)", () => {
  it("AC6 : sous le contexte d'un member, invitation de son organisation renvoie 0 ligne (une existe), create_invitation, INSERT direct refuses (42501), DELETE : 0 ligne", async () => {
    const org = await createOrganizationFixture("AC6 base member");
    const member = await signUp();
    await addMemberDirect({ organizationId: org.organizationId, userId: member.userId, role: "member" });
    const existing = await insertInvitationDirect({ organizationId: org.organizationId, email: inviteeEmail(), invitedByUserId: org.owner.userId });
    const asMember = { organizationId: org.organizationId, userId: member.userId };

    const ownerView = await asTenant({ organizationId: org.organizationId, userId: org.owner.userId }, async (client) =>
      (await client.query<{ id: string }>("SELECT id FROM invitation WHERE organization_id = $1", [org.organizationId])).rows,
    );
    expect(ownerView, "temoin positif : l'owner voit l'invitation").toEqual([{ id: existing.id }]);

    const memberView = await asTenant(asMember, async (client) =>
      (await client.query<{ id: string }>("SELECT id FROM invitation WHERE organization_id = $1", [org.organizationId])).rows,
    );
    expect(memberView).toEqual([]);

    const viaFunction = await asTenant(asMember, (client) => failureOf(() => createViaFunction(client, org.organizationId, inviteeEmail())));
    expectPrivilegeRefusal(viaFunction, "create_invitation par un member");
    const viaInsert = await asTenant(asMember, (client) =>
      failureOf(() => client.query(insertSql(), [org.organizationId, inviteeEmail(), randomTokenHash(), member.userId])),
    );
    expectPrivilegeRefusal(viaInsert, "INSERT direct par un member");
    const deleted = await asTenant(asMember, (client) => client.query("DELETE FROM invitation WHERE organization_id = $1", [org.organizationId]));
    expect(deleted.rowCount).toBe(0);

    expect(await readInvitations(org.organizationId), "l'invitation de l'owner est intacte").toHaveLength(1);
  });

  it("AC6 : temoin positif — sous le contexte de l'owner, create_invitation insere une ligne member, invited_by = l'owner (jamais un parametre), 7 jours", async () => {
    const org = await createOrganizationFixture("AC6 base owner");
    const email = inviteeEmail();

    const created = await asTenant({ organizationId: org.organizationId, userId: org.owner.userId }, async (client) => {
      const result = await createViaFunction(client, org.organizationId, email);
      return result.rows;
    });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      organization_id: org.organizationId,
      invited_by_user_id: org.owner.userId,
      role: "member",
      lifetime: SEVEN_DAYS_SECONDS,
    });
  });

  it("AC9 / ERD §5 : create_invitation purge la ligne expiree du couple puis insere ; une ligne encore valide donne 23505 (invitation_pending_idx)", async () => {
    const org = await createOrganizationFixture("AC9 base fonction");
    const ctx = { organizationId: org.organizationId, userId: org.owner.userId };
    const expiredEmail = inviteeEmail();
    const expired = await insertInvitationDirect({
      organizationId: org.organizationId,
      email: expiredEmail,
      invitedByUserId: org.owner.userId,
      createdAtOffset: "-8 days",
      expiresAtOffset: "-1 day",
    });
    const validEmail = inviteeEmail();
    await insertInvitationDirect({ organizationId: org.organizationId, email: validEmail, invitedByUserId: org.owner.userId });

    const purged = await asTenant(ctx, async (client) => {
      const created = await createViaFunction(client, org.organizationId, expiredEmail);
      const stillThere = await client.query("SELECT 1 FROM invitation WHERE id = $1", [expired.id]);
      return { createdId: created.rows[0]?.id, expiredStillThere: stillThere.rowCount };
    });
    expect(purged.createdId).toBeTypeOf("string");
    expect(purged.createdId).not.toBe(expired.id);
    expect(purged.expiredStillThere, "la ligne expiree est supprimee dans la meme transaction").toBe(0);

    const duplicate = await asTenant(ctx, (client) => failureOf(() => createViaFunction(client, org.organizationId, validEmail)));
    expect(duplicate?.code).toBe("23505");
    expect(duplicate?.constraint).toBe("invitation_pending_idx");
  });
});

describe("AC11 — expiration imposee par la base", () => {
  async function insertWithDates(createdAt: string, expiresAt: string): Promise<void> {
    const org = await createOrganizationFixture("AC11 dates");
    await asBypassRls((client) =>
      client.query(
        `INSERT INTO invitation (organization_id, email, token_hash, invited_by_user_id, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)`,
        [org.organizationId, inviteeEmail(), randomTokenHash(), org.owner.userId, createdAt, expiresAt],
      ),
    );
  }

  it("AC11 : expires_at = created_at + 7 jours exactement est accepte (temoin)", async () => {
    await expect(insertWithDates("2026-03-01T10:00:00Z", "2026-03-08T10:00:00Z")).resolves.toBeUndefined();
  });

  it("AC11 : expires_at > created_at + 7 jours -> 23514", async () => {
    await expect(insertWithDates("2026-03-01T10:00:00Z", "2026-03-08T10:00:01Z")).rejects.toMatchObject({ code: "23514" });
  });

  it.each([
    ["expires_at = created_at", "2026-03-01T10:00:00Z"],
    ["expires_at < created_at", "2026-02-28T10:00:00Z"],
  ])("AC11 : %s -> 23514", async (_label, expiresAt) => {
    await expect(insertWithDates("2026-03-01T10:00:00Z", expiresAt)).rejects.toMatchObject({ code: "23514" });
  });

  it("AC11 : create_invitation n'accepte aucun parametre de date (signature du catalogue : uuid, text, bytea)", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ args: string; names: string[] | null; secdef: boolean; nargs: number }>(
        `SELECT pg_get_function_identity_arguments(p.oid) AS args, p.proargnames AS names, p.prosecdef AS secdef, p.pronargs AS nargs
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'signet' AND p.proname = 'create_invitation'`,
      ),
    );

    expect(rows, "signet.create_invitation existe, une seule signature").toHaveLength(1);
    expect(rows[0]?.nargs).toBe(3);
    expect(rows[0]?.args).toBe("p_organization_id uuid, p_email text, p_token_hash bytea");
    expect(rows[0]?.secdef).toBe(false);
  });
});

describe("AC15 — fonctions et catalogue (D-033, ADR-0011)", () => {
  it("AC15 : create_invitation est SECURITY INVOKER, search_path fige avec pg_temp en dernier, EXECUTE pour signet_app seul", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ secdef: boolean; config: string[] | null; sig: string }>(
        `SELECT p.prosecdef AS secdef, p.proconfig AS config, p.oid::regprocedure::text AS sig
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'signet' AND p.proname = 'create_invitation'`,
      ),
    );
    const fn = rows[0];
    expect(fn, "signet.create_invitation n'existe pas (migration de la tranche 003 attendue)").toBeDefined();
    expect(fn?.secdef).toBe(false);
    expect(fn?.config).toContain("search_path=pg_catalog, signet, public, pg_temp");

    const privileges = await asBypassRls((client) =>
      client.query<{ grantee: string; allowed: boolean }>(
        `SELECT g.grantee, has_function_privilege(g.grantee, $1::regprocedure, 'EXECUTE') AS allowed
           FROM unnest(ARRAY['public', 'signet_app', 'signet_auth', 'signet_billing', 'signet_owner']) AS g(grantee)`,
        [fn?.sig],
      ),
    );
    const allowed = privileges.rows.filter((r) => r.allowed).map((r) => r.grantee);
    expect(allowed, "seul signet_app peut executer create_invitation (PUBLIC, signet_auth, signet_billing, signet_owner : non)").toEqual(["signet_app"]);
  });

  it("AC15 : aucune fonction SECURITY DEFINER nouvelle — la migration 0014 ne contient pas SECURITY DEFINER et ses fonctions ne sont pas definer dans le catalogue", async () => {
    const dir = path.join(ROOT, "packages/db/migrations");
    const file = readdirSync(dir).find((name) => name.startsWith("0014_") && name.endsWith(".sql"));
    expect(file, "packages/db/migrations/0014_*.sql (migration de la tranche 003)").toBeDefined();
    const sql = readFileSync(path.join(dir, file ?? ""), "utf8");
    const code = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");

    expect(code).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(code, "la migration cree create_invitation").toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+signet\.create_invitation/i);
    const created = [...code.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+signet\.(\w+)/gi)].map((m) => m[1] ?? "");
    const { rows } = await asBypassRls((client) =>
      client.query<{ proname: string; secdef: boolean }>(
        `SELECT p.proname, p.prosecdef AS secdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'signet' AND p.proname = ANY($1::text[])`,
        [created],
      ),
    );
    expect(rows.map((r) => r.proname).sort()).toEqual([...new Set(created)].sort());
    expect(rows.filter((r) => r.secdef).map((r) => r.proname), "aucune fonction de la migration n'est definer").toEqual([]);
  });

  it("AC15 : invitation a la RLS activee ET forcee, aucune politique TO PUBLIC ; politiques applicables a signet_app : signet_app seulement, aucun UPDATE, owner seul sur current_org() (jamais context_org)", async () => {
    const flags = await asBypassRls((client) =>
      client.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = to_regclass('public.invitation')",
      ),
    );
    expect(flags.rows, "la table invitation n'existe pas (migration de la tranche 003 attendue)").toHaveLength(1);
    expect(flags.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

    const { rows } = await asBypassRls((client) =>
      client.query<{ polname: string; polcmd: string; roles: string[]; qual: string | null; withcheck: string | null }>(
        `SELECT pol.polname, pol.polcmd::text AS polcmd,
                ARRAY(SELECT CASE WHEN o = 0 THEN 'public' ELSE (SELECT rolname::text FROM pg_roles WHERE oid = o) END
                        FROM unnest(pol.polroles) AS o) AS roles,
                pg_get_expr(pol.polqual, pol.polrelid) AS qual,
                pg_get_expr(pol.polwithcheck, pol.polrelid) AS withcheck
           FROM pg_policy pol WHERE pol.polrelid = to_regclass('public.invitation')`,
      ),
    );
    expect(rows.length, "invitation a des politiques").toBeGreaterThan(0);
    expect(rows.filter((r) => r.roles.includes("public")).map((r) => r.polname), "aucune politique TO PUBLIC").toEqual([]);
    // D-102 Q-3 (regle D-065 n°2) : memes assertions, restreintes aux politiques applicables a signet_app ;
    // celles de signet_definer (tranche 006) sont verifiees par tests/invitation-acceptance (AC13).
    const appRows = rows.filter((r) => r.roles.includes("signet_app"));
    expect(appRows.length, "invitation a des politiques signet_app").toBeGreaterThan(0);
    for (const row of appRows) {
      expect(row.roles, `${row.polname} : signet_app seulement`).toEqual(["signet_app"]);
      const text = `${row.qual ?? ""} ${row.withcheck ?? ""}`;
      expect(text, `${row.polname} : context_org( interdit aux politiques signet_app`).not.toContain("context_org(");
      expect(text, `${row.polname} : filtre sur le tenant courant`).toContain("current_org(");
    }
    expect(appRows.map((r) => r.polcmd).sort(), "SELECT, INSERT, DELETE seulement (UPDATE : tranche 006)").toEqual(["a", "d", "r"]);
  });

  it("AC15 : privileges de table — signet_app a SELECT, INSERT, DELETE, ni UPDATE ni TRUNCATE ; signet_auth et signet_billing n'ont aucun privilege", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ role: string; privilege: string; allowed: boolean }>(
        `SELECT r.role, p.privilege, has_table_privilege(r.role, to_regclass('public.invitation'), p.privilege) AS allowed
           FROM unnest(ARRAY['signet_app', 'signet_auth', 'signet_billing']) AS r(role)
           CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p(privilege)`,
      ),
    );
    const granted = (role: string) => rows.filter((r) => r.role === role && r.allowed).map((r) => r.privilege).sort();

    expect(granted("signet_app")).toEqual(["DELETE", "INSERT", "SELECT"]);
    expect(granted("signet_auth")).toEqual([]);
    expect(granted("signet_billing")).toEqual([]);
  });
});

describe("Contrat de donnees (ERD §5)", () => {
  async function insertRaw(overrides: Partial<Record<"email" | "role" | "token_hash" | "accepted_at" | "accepted_by_user_id", unknown>>, org: { organizationId: string; ownerId: string }): Promise<void> {
    const values = {
      email: inviteeEmail(),
      role: "member",
      token_hash: randomTokenHash(),
      accepted_at: null,
      accepted_by_user_id: null,
      ...overrides,
    };
    await asBypassRls((client) =>
      client.query(
        `INSERT INTO invitation (organization_id, email, role, token_hash, invited_by_user_id, accepted_at, accepted_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [org.organizationId, values.email, values.role, values.token_hash, org.ownerId, values.accepted_at, values.accepted_by_user_id],
      ),
    );
  }

  it("ERD §5 : CHECK — e-mail en minuscules, longueur 254, role member, empreinte de 32 octets, coherence de l'acceptation (23514)", async () => {
    const org = await createOrganizationFixture("ERD checks");
    const ctx = { organizationId: org.organizationId, ownerId: org.owner.userId };

    await expect(insertRaw({}, ctx), "temoin : une ligne conforme est acceptee").resolves.toBeUndefined();
    await expect(insertRaw({ email: "Majuscule@example.test" }, ctx)).rejects.toMatchObject({ code: "23514" });
    await expect(insertRaw({ email: `${"a".repeat(250)}@example.test` }, ctx)).rejects.toMatchObject({ code: "23514" });
    await expect(insertRaw({ role: "owner" }, ctx)).rejects.toMatchObject({ code: "23514" });
    await expect(insertRaw({ token_hash: Buffer.alloc(31, 1) }, ctx)).rejects.toMatchObject({ code: "23514" });
    await expect(insertRaw({ token_hash: Buffer.alloc(33, 1) }, ctx)).rejects.toMatchObject({ code: "23514" });
    await expect(insertRaw({ accepted_at: new Date() }, ctx), "acceptee par personne").rejects.toMatchObject({ code: "23514" });
    await expect(insertRaw({ accepted_by_user_id: org.owner.userId }, ctx), "utilisateur sans date d'acceptation").rejects.toMatchObject({ code: "23514" });
  });

  it("ERD §5 : index uniques — empreinte unique (23505), une seule invitation en attente par (organisation, e-mail) mais plusieurs acceptees possibles", async () => {
    const org = await createOrganizationFixture("ERD index");
    const other = await signUp();
    const hash = randomTokenHash();
    const email = inviteeEmail();
    await insertInvitationDirect({ organizationId: org.organizationId, email: inviteeEmail(), invitedByUserId: org.owner.userId, tokenHash: hash });

    await expect(
      insertInvitationDirect({ organizationId: org.organizationId, email: inviteeEmail(), invitedByUserId: org.owner.userId, tokenHash: hash }),
    ).rejects.toMatchObject({ code: "23505" });

    await insertInvitationDirect({ organizationId: org.organizationId, email, invitedByUserId: org.owner.userId });
    await expect(
      insertInvitationDirect({ organizationId: org.organizationId, email, invitedByUserId: org.owner.userId }),
    ).rejects.toMatchObject({ code: "23505" });
    await insertInvitationDirect({ organizationId: org.organizationId, email, invitedByUserId: org.owner.userId, accepted: { byUserId: other.userId } });
    await insertInvitationDirect({ organizationId: org.organizationId, email, invitedByUserId: org.owner.userId, accepted: { byUserId: other.userId } });
    expect(await readInvitations(org.organizationId, email), "une en attente + deux acceptees").toHaveLength(3);
  });

  it("ERD §5 : index nommes presents (invitation_token_hash_idx, invitation_pending_idx partiel, invitation_org_idx, invitation_expires_idx partiel)", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ indexname: string; indexdef: string }>(
        "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'invitation'",
      ),
    );
    const byName = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));

    expect(byName.invitation_token_hash_idx, "invitation_token_hash_idx").toMatch(/UNIQUE.*token_hash/);
    expect(byName.invitation_pending_idx, "invitation_pending_idx").toMatch(/UNIQUE.*organization_id, email.*WHERE.*accepted_at IS NULL/);
    expect(byName.invitation_org_idx, "invitation_org_idx").toMatch(/organization_id/);
    expect(byName.invitation_expires_idx, "invitation_expires_idx").toMatch(/expires_at.*WHERE.*accepted_at IS NULL/);
  });

  it("ERD §5 : cles etrangeres — invitation supprimee avec son organisation (CASCADE), utilisateur invitant protege (RESTRICT, 23503 sur la cle de l'invitation)", async () => {
    const org = await createOrganizationFixture("ERD fk");
    const inviter = await signUp();
    const byInviter = await insertInvitationDirect({ organizationId: org.organizationId, email: inviteeEmail(), invitedByUserId: inviter.userId });
    const byOwner = await insertInvitationDirect({ organizationId: org.organizationId, email: inviteeEmail(), invitedByUserId: org.owner.userId });

    const failure = await failureOf(() => asBypassRls((client) => client.query("DELETE FROM app_user WHERE id = $1", [inviter.userId])));

    expect(failure?.code).toBe("23503");
    expect(failure?.constraint, "la cle etrangere de l'invitation, pas une autre").toMatch(/^invitation_/);
    expect(await readInvitationById(byInviter.id), "l'invitation est conservee").toBeDefined();

    await asBypassRls((client) => client.query("DELETE FROM organization WHERE id = $1", [org.organizationId]));
    expect(await readInvitationById(byInviter.id), "supprimee avec l'organisation").toBeUndefined();
    expect(await readInvitationById(byOwner.id), "supprimee avec l'organisation").toBeUndefined();
  });
});
