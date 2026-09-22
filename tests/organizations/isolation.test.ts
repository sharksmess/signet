/**
 * Test d'isolation tenant — OBLIGATOIRE (discipline du projet, cf. test-writer,
 * ERD ADR-0001, regle nextjs.md "deux tenants reels, jamais un seul compte").
 *
 * Meme si une tranche future touchant `organization`/`member`/
 * `organization_link_usage`/`subscription` semble ne pas toucher au
 * multi-tenant, ce fichier doit continuer a passer. C'est la discipline citee
 * par la tranche elle-meme (anti-regression) qui empeche la fuite d'arriver
 * un jour, sur la tranche ou personne n'y avait pense.
 *
 * Verifie AC5 par requete directe sous `signet_app`, avec `SET LOCAL
 * app.organization_id` pose sur l'organisation A — jamais via la couche HTTP,
 * pour prouver que l'isolation vient de la base (RLS) et non d'une garde
 * applicative qu'une route future pourrait oublier.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { asTenant, asTableOwner, resetDatabase, closeAllPools } from "../helpers/db";
import { createTwoOrganizationsFixture, addMemberDirect } from "../helpers/fixtures";
import { signUp } from "../helpers/auth";

beforeAll(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeAllPools();
});

describe("Isolation tenant — organization / member / organization_link_usage / subscription", () => {
  it("AC5 : un membre de A ne peut LIRE aucune ligne organization de B", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();

    const rows = await asTenant(
      { organizationId: orgA.organizationId, userId: orgA.owner.userId },
      async (client) => {
        const result = await client.query("SELECT id FROM organization WHERE id = $1", [
          orgB.organizationId,
        ]);
        return result.rows;
      },
    );

    expect(rows).toEqual([]);
  });

  it("AC5 : un membre de A ne peut MODIFIER aucune ligne organization de B", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();

    const affected = await asTenant(
      { organizationId: orgA.organizationId, userId: orgA.owner.userId },
      async (client) => {
        const result = await client.query(
          "UPDATE organization SET name = 'Piratee' WHERE id = $1",
          [orgB.organizationId],
        );
        return result.rowCount;
      },
    );

    expect(affected).toBe(0);
  });

  it("AC5 : un membre de A ne peut LIRE aucune ligne member de B", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();

    const rows = await asTenant(
      { organizationId: orgA.organizationId, userId: orgA.owner.userId },
      async (client) => {
        const result = await client.query(
          "SELECT id FROM member WHERE organization_id = $1",
          [orgB.organizationId],
        );
        return result.rows;
      },
    );

    expect(rows).toEqual([]);
  });

  it("AC5 : un membre de A ne peut LIRE aucune ligne organization_link_usage de B", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();

    const rows = await asTenant(
      { organizationId: orgA.organizationId, userId: orgA.owner.userId },
      async (client) => {
        const result = await client.query(
          "SELECT organization_id FROM organization_link_usage WHERE organization_id = $1",
          [orgB.organizationId],
        );
        return result.rows;
      },
    );

    expect(rows).toEqual([]);
  });

  it("AC5 : un membre de A ne peut LIRE aucune ligne subscription de B", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();

    const rows = await asTenant(
      { organizationId: orgA.organizationId, userId: orgA.owner.userId },
      async (client) => {
        const result = await client.query(
          "SELECT organization_id FROM subscription WHERE organization_id = $1",
          [orgB.organizationId],
        );
        return result.rows;
      },
    );

    expect(rows).toEqual([]);
  });

  it("US-08.2 : dans l'organisation A elle-meme, un member (non-owner) ne peut pas lire subscription", async () => {
    const { orgA } = await createTwoOrganizationsFixture();
    const memberSession = await signUp();
    await addMemberDirect({
      organizationId: orgA.organizationId,
      userId: memberSession.userId,
      role: "member",
    });

    const rows = await asTenant(
      { organizationId: orgA.organizationId, userId: memberSession.userId },
      async (client) => {
        const result = await client.query(
          "SELECT organization_id FROM subscription WHERE organization_id = $1",
          [orgA.organizationId],
        );
        return result.rows;
      },
    );

    expect(rows).toEqual([]);
  });

  it("ERD §1 (fermeture par defaut) : sans SET LOCAL app.organization_id, aucune ligne organization n'est visible", async () => {
    const { orgA } = await createTwoOrganizationsFixture();

    const rows = await asTenant({}, async (client) => {
      const result = await client.query("SELECT id FROM organization WHERE id = $1", [
        orgA.organizationId,
      ]);
      return result.rows;
    });

    expect(rows).toEqual([]);
  });

  it("Anti-regression : FORCE ROW LEVEL SECURITY s'applique meme au role proprietaire des tables", async () => {
    const { orgA } = await createTwoOrganizationsFixture();

    // TEST_DATABASE_URL_TABLE_OWNER : le proprietaire des tables, SANS BYPASSRLS,
    // et sans jamais poser SET LOCAL app.organization_id. Sans FORCE, Postgres
    // exempterait ce role de toute politique par defaut (ERD §1) : ce test
    // echoue si `FORCE ROW LEVEL SECURITY` a ete retire d'`organization`.
    const rows = await asTableOwner(async (client) => {
      const result = await client.query("SELECT id FROM organization WHERE id = $1", [
        orgA.organizationId,
      ]);
      return result.rows;
    });

    expect(rows).toEqual([]);
  });
});
