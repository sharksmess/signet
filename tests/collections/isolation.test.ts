/**
 * Tranche 004 — AC5 : isolation tenant (US-05.2, US-09).
 *
 * (a), (b), (d) par l'API avec deux tenants reels ; (c) directement en base,
 * sous le role applicatif `signet_app` (asTenant), contexte etranger force : la
 * RLS doit refuser seule, sans l'aide du controle applicatif. La connexion
 * d'administration ne sert qu'a l'arrangement et aux lectures de controle.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signUp } from "../helpers/auth";
import { asBypassRls, asTenant, closeAllPools } from "../helpers/db";
import { createOrganizationFixture, createTwoOrganizationsFixture } from "../helpers/fixtures";
import { expectError, expectStatus } from "../helpers/billing";
import {
  createMemberSession,
  insertCollectionDirect,
  postCollection,
  readCollections,
  uniqueCollectionName,
} from "../helpers/collections";

afterAll(async () => {
  await closeAllPools();
});

interface PgFailure {
  code?: string;
  message?: string;
}

async function failureOf(operation: () => Promise<unknown>): Promise<PgFailure | undefined> {
  try {
    await operation();
    return undefined;
  } catch (error) {
    return error as PgFailure;
  }
}

describe("AC5 (a) — isolation par l'API", () => {
  it("AC5 (a) : l'owner de B cree dans A -> 404 ORGANIZATION_NOT_FOUND, corps strictement identique a celui d'un UUID inexistant, aucune ligne dans A ni dans B", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const name = uniqueCollectionName();

    const foreign = await postCollection(orgB.owner, orgA.organizationId, { name });
    const unknown = await postCollection(orgB.owner, randomUUID(), { name });

    expectError(foreign, 404, "ORGANIZATION_NOT_FOUND", "owner de B vers A");
    expectError(unknown, 404, "ORGANIZATION_NOT_FOUND", "owner de B vers un UUID inexistant");
    expect(foreign.text, "corps octet pour octet identiques").toBe(unknown.text);
    expect(await readCollections(orgA.organizationId)).toEqual([]);
    expect(await readCollections(orgB.organizationId)).toEqual([]);

    const witness = await postCollection(orgA.owner, orgA.organizationId, { name });
    expectStatus(witness, 201, "temoin : l'owner de A peut creer chez lui");
  });

  it("AC5 (a) : un utilisateur sans aucune organisation recoit le meme 404", async () => {
    const { orgA } = await createTwoOrganizationsFixture();
    const stranger = await signUp();
    const lonely = await postCollection(stranger, orgA.organizationId, { name: uniqueCollectionName() });
    const unknown = await postCollection(stranger, randomUUID(), { name: uniqueCollectionName() });

    expectError(lonely, 404, "ORGANIZATION_NOT_FOUND", "non-membre");
    expect(lonely.text).toBe(unknown.text);
    expect(await readCollections(orgA.organizationId)).toEqual([]);
  });
});

describe("AC5 (b) — le chemin fait autorite", () => {
  it("AC5 (b) : un organizationId = B dans le corps d'une requete adressee a A par un membre de A cree la collection dans A", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const member = await createMemberSession(orgA.organizationId);
    const name = uniqueCollectionName();

    const result = await postCollection(member, orgA.organizationId, {
      name,
      organizationId: orgB.organizationId,
      createdByUserId: orgB.owner.userId,
    });

    expectStatus(result, 201, "corps portant organizationId = B");
    expect(result.body).toMatchObject({ organizationId: orgA.organizationId, name });
    const inA = await readCollections(orgA.organizationId);
    expect(inA.map((r) => r.name)).toEqual([name]);
    expect(inA[0]?.created_by_user_id, "l'auteur est l'appelant, jamais un champ du corps").toBe(member.userId);
    expect(await readCollections(orgB.organizationId)).toEqual([]);
  });

  it("AC5 (b) : un membre de A qui vise B dans le chemin et A dans le corps recoit 404, rien n'est cree", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();

    const result = await postCollection(orgA.owner, orgB.organizationId, { name: uniqueCollectionName(), organizationId: orgA.organizationId });

    expectError(result, 404, "ORGANIZATION_NOT_FOUND", "chemin B, corps A");
    expect(await readCollections(orgA.organizationId)).toEqual([]);
    expect(await readCollections(orgB.organizationId)).toEqual([]);
  });
});

describe("AC5 (c) — contexte etranger force en base, role signet_app", () => {
  /** Precondition : un refus 42501 ne peut venir que de la RLS, pas d'un GRANT manquant. */
  async function expectAppCanInsertCollection(): Promise<void> {
    const { rows } = await asBypassRls((client) =>
      client.query<{ ok: boolean }>("SELECT has_table_privilege('signet_app', 'public.collection', 'INSERT') AS ok"),
    );
    expect(rows[0]?.ok, "precondition : signet_app detient INSERT sur collection").toBe(true);
  }

  const insertSql = "INSERT INTO collection (organization_id, name, created_by_user_id) VALUES ($1, $2, $3)";

  it("AC5 (c) : contexte A + utilisateur owner de B -> SELECT ne rend aucune ligne de A, INSERT d'une collection de A refuse (42501)", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const existing = await insertCollectionDirect({ organizationId: orgA.organizationId, name: uniqueCollectionName(), createdByUserId: orgA.owner.userId });
    await expectAppCanInsertCollection();
    const foreign = { organizationId: orgA.organizationId, userId: orgB.owner.userId };
    const legit = { organizationId: orgA.organizationId, userId: orgA.owner.userId };

    const witness = await asTenant(legit, async (client) =>
      (await client.query<{ id: string }>("SELECT id FROM collection WHERE organization_id = $1", [orgA.organizationId])).rows,
    );
    expect(witness, "temoin positif : l'owner de A voit sa collection").toEqual([{ id: existing.id }]);

    const seen = await asTenant(foreign, async (client) => ({
      byOrg: (await client.query<{ id: string }>("SELECT id FROM collection WHERE organization_id = $1", [orgA.organizationId])).rows,
      byId: (await client.query<{ id: string }>("SELECT id FROM collection WHERE id = $1", [existing.id])).rows,
    }));
    expect(seen).toEqual({ byOrg: [], byId: [] });

    const failure = await asTenant(foreign, (client) =>
      failureOf(() => client.query(insertSql, [orgA.organizationId, uniqueCollectionName(), orgB.owner.userId])),
    );
    expect(failure, "INSERT dans A sous contexte etranger doit etre refuse").toBeDefined();
    expect(failure?.code, `refus par la RLS (${failure?.message})`).toBe("42501");

    expect(await readCollections(orgA.organizationId), "la collection de A est intacte, rien n'a ete ajoute").toHaveLength(1);
  });

  it("AC5 (c) : contexte B (owner de B) -> INSERT d'une ligne dont organization_id = A refuse par le WITH CHECK (42501) ; le meme INSERT dans B reussit (temoin)", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    await expectAppCanInsertCollection();
    const ctxB = { organizationId: orgB.organizationId, userId: orgB.owner.userId };

    const failure = await asTenant(ctxB, (client) =>
      failureOf(() => client.query(insertSql, [orgA.organizationId, uniqueCollectionName(), orgB.owner.userId])),
    );
    expect(failure, "INSERT organization_id = A depuis le contexte B doit etre refuse").toBeDefined();
    expect(failure?.code, `refus par WITH CHECK (${failure?.message})`).toBe("42501");

    const inserted = await asTenant(ctxB, async (client) =>
      (await client.query<{ organization_id: string }>(`${insertSql} RETURNING organization_id`, [orgB.organizationId, uniqueCollectionName(), orgB.owner.userId])).rows,
    );
    expect(inserted, "temoin positif : l'INSERT dans le contexte legitime reussit").toEqual([{ organization_id: orgB.organizationId }]);
    expect(await readCollections(orgA.organizationId)).toEqual([]);
  });

  it("AC5 (c) : sans app.user_id, aucune collection visible ni inserable malgre un app.organization_id valide", async () => {
    const org = await createOrganizationFixture("AC5 c sans identite");
    await insertCollectionDirect({ organizationId: org.organizationId, name: uniqueCollectionName(), createdByUserId: org.owner.userId });
    await expectAppCanInsertCollection();

    const seen = await asTenant({ organizationId: org.organizationId }, async (client) =>
      (await client.query("SELECT id FROM collection WHERE organization_id = $1", [org.organizationId])).rows,
    );
    expect(seen).toEqual([]);

    const failure = await asTenant({ organizationId: org.organizationId }, (client) =>
      failureOf(() => client.query(insertSql, [org.organizationId, uniqueCollectionName(), org.owner.userId])),
    );
    expect(failure?.code, `refus par la RLS (${failure?.message})`).toBe("42501");
  });

  it("AC5 (c) : un member de A voit et cree dans A sous son propre contexte (la RLS n'exige pas le role owner)", async () => {
    const org = await createOrganizationFixture("AC5 c member");
    const member = await createMemberSession(org.organizationId);
    const existing = await insertCollectionDirect({ organizationId: org.organizationId, name: uniqueCollectionName(), createdByUserId: org.owner.userId });
    const ctx = { organizationId: org.organizationId, userId: member.userId };

    const result = await asTenant(ctx, async (client) => ({
      seen: (await client.query<{ id: string }>("SELECT id FROM collection WHERE organization_id = $1", [org.organizationId])).rows,
      inserted: (await client.query(`${insertSql} RETURNING id`, [org.organizationId, uniqueCollectionName(), member.userId])).rowCount,
    }));

    expect(result.seen).toEqual([{ id: existing.id }]);
    expect(result.inserted).toBe(1);
  });
});

describe("AC5 (d) — l'unicite est par organisation", () => {
  it("AC5 (d) : Veille existe dans A ; l'owner de B cree Veille dans B -> 201", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    expectStatus(await postCollection(orgA.owner, orgA.organizationId, { name: "Veille" }), 201, "Veille dans A");

    const inB = await postCollection(orgB.owner, orgB.organizationId, { name: "Veille" });
    const inBLower = await postCollection(orgB.owner, orgB.organizationId, { name: "veille" });

    expectStatus(inB, 201, "Veille dans B");
    expectError(inBLower, 409, "COLLECTION_NAME_TAKEN", "veille dans B apres Veille dans B");
    expect((await readCollections(orgA.organizationId)).map((r) => r.name)).toEqual(["Veille"]);
    expect((await readCollections(orgB.organizationId)).map((r) => r.name)).toEqual(["Veille"]);
  });
});
