/**
 * Tranche 009 — AC6 : isolation tenant (US-07.1, US-09). (a), (b), (c) par
 * l'API avec des tenants reels ; (d) directement en base, sous le role
 * applicatif `signet_app` (asTenant), contexte etranger force : la RLS doit
 * rendre zero ligne seule. La connexion d'administration ne sert qu'a
 * l'arrangement et aux preconditions.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signUp } from "../helpers/auth";
import { asTenant, closeAllPools } from "../helpers/db";
import { createOrganizationFixture, createTwoOrganizationsFixture, addMemberDirect } from "../helpers/fixtures";
import { expectError, expectStatus } from "../helpers/billing";
import { createMemberSession, readCollections } from "../helpers/collections";
import { createCollectionViaApi, postLink, readLinks, uniqueUrl } from "../helpers/links";
import { expectList, getCollections, getLinks, idsOf } from "../helpers/consultation";

afterAll(async () => {
  await closeAllPools();
});

async function organizationWithLink(name: string) {
  const org = await createOrganizationFixture(name);
  const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
  const link = await postLink(org.owner, org.organizationId, collectionId, { url: uniqueUrl(), title: `Lien de ${name}` });
  expectStatus(link, 201, `arrangement : lien de ${name}`);
  return { org, collectionId, linkId: idsOf([link.body])[0] ?? "" };
}

describe("AC6 (a) — l'owner de B lit A", () => {
  it("AC6 (a) : l'owner de B lit les collections de A -> 404 ORGANIZATION_NOT_FOUND, corps strictement identique a celui d'un UUID inexistant", async () => {
    const a = await organizationWithLink("AC6 a collections A");
    const b = await createOrganizationFixture("AC6 a collections B");

    const foreign = await getCollections(b.owner, a.org.organizationId);
    const unknown = await getCollections(b.owner, randomUUID());

    expectError(foreign, 404, "ORGANIZATION_NOT_FOUND", "owner de B vers les collections de A");
    expectError(unknown, 404, "ORGANIZATION_NOT_FOUND", "owner de B vers une organisation inexistante");
    expect(foreign.text, "corps octet pour octet identiques").toBe(unknown.text);
    expect(expectList(await getCollections(a.org.owner, a.org.organizationId), "temoin : l'owner de A lit chez lui")).toHaveLength(1);
  });

  it("AC6 (a) : l'owner de B lit les liens d'une collection de A -> 404 ORGANIZATION_NOT_FOUND, corps strictement identique a celui d'un UUID inexistant", async () => {
    const a = await organizationWithLink("AC6 a liens A");
    const b = await createOrganizationFixture("AC6 a liens B");

    const foreign = await getLinks(b.owner, a.org.organizationId, a.collectionId);
    const unknown = await getLinks(b.owner, randomUUID(), a.collectionId);

    expectError(foreign, 404, "ORGANIZATION_NOT_FOUND", "owner de B vers les liens de A");
    expectError(unknown, 404, "ORGANIZATION_NOT_FOUND", "owner de B vers une organisation inexistante");
    expect(foreign.text, "corps octet pour octet identiques").toBe(unknown.text);
    expect(expectList(await getLinks(a.org.owner, a.org.organizationId, a.collectionId), "temoin : l'owner de A lit chez lui")).toHaveLength(1);
  });

  it("AC6 (a) : un utilisateur sans aucune organisation recoit le meme 404 sur les deux routes", async () => {
    const a = await organizationWithLink("AC6 a sans organisation");
    const stranger = await signUp();

    const collections = await getCollections(stranger, a.org.organizationId);
    const collectionsUnknown = await getCollections(stranger, randomUUID());
    const links = await getLinks(stranger, a.org.organizationId, a.collectionId);
    const linksUnknown = await getLinks(stranger, randomUUID(), a.collectionId);

    expectError(collections, 404, "ORGANIZATION_NOT_FOUND", "collections");
    expectError(links, 404, "ORGANIZATION_NOT_FOUND", "liens");
    expect(collections.text).toBe(collectionsUnknown.text);
    expect(links.text).toBe(linksUnknown.text);
  });
});

describe("AC6 (b) — le chemin fait autorite : collection de B sous le chemin de A", () => {
  it("AC6 (b) : un membre de A demande une collection de B sous le chemin de A -> 404 COLLECTION_NOT_FOUND, corps strictement identique a celui d'un UUID de collection inexistant", async () => {
    const a = await organizationWithLink("AC6 b A");
    const b = await organizationWithLink("AC6 b B");
    const member = await createMemberSession(a.org.organizationId);

    for (const [label, session] of [
      ["owner de A", a.org.owner],
      ["member de A", member],
    ] as const) {
      const foreign = await getLinks(session, a.org.organizationId, b.collectionId);
      const unknown = await getLinks(session, a.org.organizationId, randomUUID());

      expectError(foreign, 404, "COLLECTION_NOT_FOUND", `${label} : collection de B sous le chemin de A`);
      expectError(unknown, 404, "COLLECTION_NOT_FOUND", `${label} : collection inexistante`);
      expect(foreign.text, `${label} : corps octet pour octet identiques`).toBe(unknown.text);
    }
  });
});

describe("AC6 (c) — membre de A et de B : le chemin decide", () => {
  it("AC6 (c) : par chaque chemin il ne voit que les donnees de l'organisation du chemin ; collection de l'autre organisation -> 404 COLLECTION_NOT_FOUND", async () => {
    const a = await organizationWithLink("AC6 c A");
    const b = await organizationWithLink("AC6 c B");
    const both = await signUp();
    await addMemberDirect({ organizationId: a.org.organizationId, userId: both.userId, role: "member" });
    await addMemberDirect({ organizationId: b.org.organizationId, userId: both.userId, role: "member" });

    const underA = expectList(await getCollections(both, a.org.organizationId), "collections sous A");
    const underB = expectList(await getCollections(both, b.org.organizationId), "collections sous B");
    expect(idsOf(underA)).toEqual([a.collectionId]);
    expect(idsOf(underB)).toEqual([b.collectionId]);

    expect(idsOf(expectList(await getLinks(both, a.org.organizationId, a.collectionId), "liens de A sous A"))).toEqual([a.linkId]);
    expect(idsOf(expectList(await getLinks(both, b.org.organizationId, b.collectionId), "liens de B sous B"))).toEqual([b.linkId]);

    const bUnderA = await getLinks(both, a.org.organizationId, b.collectionId);
    const aUnderB = await getLinks(both, b.org.organizationId, a.collectionId);
    const unknown = await getLinks(both, a.org.organizationId, randomUUID());
    expectError(bUnderA, 404, "COLLECTION_NOT_FOUND", "collection de B sous le chemin de A");
    expectError(aUnderB, 404, "COLLECTION_NOT_FOUND", "collection de A sous le chemin de B");
    expect(bUnderA.text, "indistinguable d'une collection inexistante").toBe(unknown.text);
    expect(aUnderB.text, "indistinguable d'une collection inexistante").toBe(unknown.text);
  });
});

describe("AC6 (d) — contexte etranger force en base, role signet_app", () => {
  it("AC6 (d) : contexte app.organization_id = A + app.user_id = owner de B -> SELECT sur collection et link de A rendent zero ligne ; le contexte legitime les voit", async () => {
    const a = await organizationWithLink("AC6 d A");
    const b = await createOrganizationFixture("AC6 d B");
    expect(await readCollections(a.org.organizationId), "precondition : la collection de A existe").toHaveLength(1);
    expect(await readLinks(a.org.organizationId), "precondition : le lien de A existe").toHaveLength(1);
    const legit = { organizationId: a.org.organizationId, userId: a.org.owner.userId };
    const foreign = { organizationId: a.org.organizationId, userId: b.owner.userId };

    const read = (ctx: typeof legit) =>
      asTenant(ctx, async (client) => ({
        collectionsByOrg: (await client.query<{ id: string }>("SELECT id FROM collection WHERE organization_id = $1", [a.org.organizationId])).rows,
        collectionsById: (await client.query<{ id: string }>("SELECT id FROM collection WHERE id = $1", [a.collectionId])).rows,
        linksByOrg: (await client.query<{ id: string }>("SELECT id FROM link WHERE organization_id = $1", [a.org.organizationId])).rows,
        linksByCollection: (await client.query<{ id: string }>("SELECT id FROM link WHERE collection_id = $1", [a.collectionId])).rows,
      }));

    const witness = await read(legit);
    const seen = await read(foreign);

    expect(witness.collectionsByOrg, "temoin positif : l'owner de A voit sa collection").toEqual([{ id: a.collectionId }]);
    expect(witness.linksByOrg, "temoin positif : l'owner de A voit son lien").toEqual([{ id: a.linkId }]);
    expect(seen).toEqual({ collectionsByOrg: [], collectionsById: [], linksByOrg: [], linksByCollection: [] });
  });

  it("AC6 (d) : contexte organisation = A sans app.user_id -> zero ligne de collection et de link", async () => {
    const a = await organizationWithLink("AC6 d sans identite");

    const seen = await asTenant({ organizationId: a.org.organizationId }, async (client) => ({
      collections: (await client.query<{ id: string }>("SELECT id FROM collection WHERE organization_id = $1", [a.org.organizationId])).rows,
      links: (await client.query<{ id: string }>("SELECT id FROM link WHERE organization_id = $1", [a.org.organizationId])).rows,
    }));

    expect(seen).toEqual({ collections: [], links: [] });
  });
});

describe("AC6 — deux organisations, deux listes", () => {
  it("AC6 : les collections de A et de B ne se melangent jamais, meme avec des noms identiques", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const inA = await createCollectionViaApi(orgA.owner, orgA.organizationId, "Veille");
    const inB = await createCollectionViaApi(orgB.owner, orgB.organizationId, "Veille");

    expect(idsOf(expectList(await getCollections(orgA.owner, orgA.organizationId), "collections de A"))).toEqual([inA]);
    expect(idsOf(expectList(await getCollections(orgB.owner, orgB.organizationId), "collections de B"))).toEqual([inB]);
  });
});
