/**
 * Tranche 004 — AC6 : concurrence (US-05.3). Les requetes partent ensemble
 * (Promise.all) ; la garantie vient de l'index unique, pas d'une lecture
 * prealable : exactement un 201, les autres 409 COLLECTION_NAME_TAKEN, une seule
 * ligne en base.
 */
import { describe, it, expect, afterAll } from "vitest";
import { closeAllPools } from "../helpers/db";
import { createOrganizationFixture } from "../helpers/fixtures";
import { codeOf, expectStatus } from "../helpers/billing";
import { createMemberSession, postCollection, readCollections, uniqueCollectionName } from "../helpers/collections";

afterAll(async () => {
  await closeAllPools();
});

describe("AC6 — concurrence", () => {
  it("AC6 : deux POST simultanes du meme nom dans A -> exactement un 201 et un 409 COLLECTION_NAME_TAKEN, une seule ligne", async () => {
    const org = await createOrganizationFixture("AC6 meme nom");
    const name = uniqueCollectionName();

    const results = await Promise.all([
      postCollection(org.owner, org.organizationId, { name }),
      postCollection(org.owner, org.organizationId, { name }),
    ]);

    const statuses = results.map((r) => r.status).sort();
    expect(statuses, `statuts recus, corps : ${results.map((r) => r.text).join(" | ")}`).toEqual([201, 409]);
    const conflict = results.find((r) => r.status === 409);
    expect(conflict && codeOf(conflict)).toBe("COLLECTION_NAME_TAKEN");
    expect(await readCollections(org.organizationId, name)).toHaveLength(1);
  });

  it("AC6 : variante de casse, 'Veille' et 'veille' simultanes -> exactement un 201 et un 409, une seule ligne", async () => {
    const org = await createOrganizationFixture("AC6 casse");
    const name = uniqueCollectionName();

    const results = await Promise.all([
      postCollection(org.owner, org.organizationId, { name }),
      postCollection(org.owner, org.organizationId, { name: name.toLowerCase() }),
    ]);

    expect(results.map((r) => r.status).sort(), `corps : ${results.map((r) => r.text).join(" | ")}`).toEqual([201, 409]);
    const conflict = results.find((r) => r.status === 409);
    expect(conflict && codeOf(conflict)).toBe("COLLECTION_NAME_TAKEN");
    expect(await readCollections(org.organizationId, name)).toHaveLength(1);
  });

  it("AC6 : plusieurs rafales simultanees (owner et member, casses melangees) -> un seul 201 par nom, toutes les autres 409", async () => {
    const org = await createOrganizationFixture("AC6 rafales");
    const member = await createMemberSession(org.organizationId);
    const names = [uniqueCollectionName("Alpha"), uniqueCollectionName("Beta"), uniqueCollectionName("Gamma")];
    const calls = names.flatMap((name) => [
      { name, request: postCollection(org.owner, org.organizationId, { name }) },
      { name, request: postCollection(member, org.organizationId, { name: name.toUpperCase() }) },
      { name, request: postCollection(org.owner, org.organizationId, { name: ` ${name.toLowerCase()} ` }) },
    ]);

    const results = await Promise.all(calls.map(async (c) => ({ name: c.name, result: await c.request })));

    for (const name of names) {
      const mine = results.filter((r) => r.name === name).map((r) => r.result);
      expect(mine.map((r) => r.status).sort(), `nom ${name}, corps : ${mine.map((r) => r.text).join(" | ")}`).toEqual([201, 409, 409]);
      for (const conflict of mine.filter((r) => r.status === 409)) expectStatus(conflict, 409, `conflit ${name}`);
      expect(await readCollections(org.organizationId, name), `une seule ligne pour ${name}`).toHaveLength(1);
    }
    expect(await readCollections(org.organizationId)).toHaveLength(names.length);
  });

  it("AC6 : un meme nom simultane dans deux organisations differentes -> deux 201 (l'unicite ne traverse pas les tenants)", async () => {
    const orgA = await createOrganizationFixture("AC6 tenant A");
    const orgB = await createOrganizationFixture("AC6 tenant B");
    const name = uniqueCollectionName();

    const [inA, inB] = await Promise.all([
      postCollection(orgA.owner, orgA.organizationId, { name }),
      postCollection(orgB.owner, orgB.organizationId, { name }),
    ]);

    expectStatus(inA, 201, "creation dans A");
    expectStatus(inB, 201, "creation dans B");
  });
});
