/**
 * Tranche 009 — AC2 (ordre, D-131 points 1 et 2) et AC8 (organisation
 * retrogradee au-dessus du quota, patron de 005). Les deux routes GET sont
 * couvertes.
 */
import { describe, it, expect, afterAll } from "vitest";
import { closeAllPools } from "../helpers/db";
import { createOrganizationFixture } from "../helpers/fixtures";
import { createProOrganization, expectStatus } from "../helpers/billing";
import { readSubscriptionRow, setSubscriptionDirect } from "../helpers/billing-db";
import { createCollectionsViaApi, createCollectionViaApi, linkState, postLink, readLinks, seedLinks, uniqueUrl, closeLinkPools } from "../helpers/links";
import { postCollection, readCollections, uniqueCollectionName } from "../helpers/collections";
import {
  expectList,
  expectTiedPrecondition,
  getCollections,
  getLinks,
  idsOf,
  insertTiedCollections,
  insertTiedLinks,
  sortedDescending,
} from "../helpers/consultation";

afterAll(async () => {
  await closeLinkPools();
  await closeAllPools();
});

describe("AC2 — ordre (US-07.2, D-131 points 1 et 2)", () => {
  it("AC2 : collections creees par POST a des instants differents -> de la plus recente a la plus ancienne", async () => {
    const org = await createOrganizationFixture("AC2 collections distinctes");
    const created: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const result = await postCollection(org.owner, org.organizationId, { name: uniqueCollectionName(`Ordre ${index}`) });
      expectStatus(result, 201, `creation ${index}`);
      created.push(idsOf([result.body])[0] ?? "");
    }

    const items = expectList(await getCollections(org.owner, org.organizationId), "GET collections");

    expect(idsOf(items)).toEqual([...created].reverse());
  });

  it("AC2 : liens ajoutes par POST a des instants differents -> du plus recent au plus ancien", async () => {
    const org = await createOrganizationFixture("AC2 liens distincts");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    const added: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const result = await postLink(org.owner, org.organizationId, collectionId, { url: uniqueUrl(), title: `Ordre ${index}` });
      expectStatus(result, 201, `ajout ${index}`);
      added.push(idsOf([result.body])[0] ?? "");
    }

    const items = expectList(await getLinks(org.owner, org.organizationId, collectionId), "GET liens");

    expect(idsOf(items)).toEqual([...added].reverse());
  });

  it("AC2 : collections a horodatage egal (meme transaction) -> identifiants decroissants, quel que soit l'ordre d'insertion", async () => {
    const org = await createOrganizationFixture("AC2 collections egales");
    const inserted = await insertTiedCollections({ organizationId: org.organizationId, userId: org.owner.userId });
    expectTiedPrecondition(inserted, "collections");

    const items = expectList(await getCollections(org.owner, org.organizationId), "GET collections");

    expect(idsOf(items)).toEqual(sortedDescending(inserted.insertionOrder));
  });

  it("AC2 : liens a horodatage egal (meme transaction) -> identifiants decroissants, quel que soit l'ordre d'insertion", async () => {
    const org = await createOrganizationFixture("AC2 liens egaux");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    const inserted = await insertTiedLinks({ organizationId: org.organizationId, collectionId, userId: org.owner.userId });
    expectTiedPrecondition(inserted, "liens");

    const items = expectList(await getLinks(org.owner, org.organizationId, collectionId), "GET liens");

    expect(idsOf(items)).toEqual(sortedDescending(inserted.insertionOrder));
  });

  it("AC2 : une chaine de requete (?sort=asc, ?order=name) ne change ni l'ordre des collections ni celui des liens", async () => {
    const org = await createOrganizationFixture("AC2 chaine de requete");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Zeta");
    expectStatus(await postCollection(org.owner, org.organizationId, { name: "Alpha" }), 201, "arrangement : Alpha");
    await insertTiedLinks({ organizationId: org.organizationId, collectionId, userId: org.owner.userId });
    const collections = expectList(await getCollections(org.owner, org.organizationId), "collections sans requete");
    const links = expectList(await getLinks(org.owner, org.organizationId, collectionId), "liens sans requete");
    expect(idsOf(collections), "precondition : deux collections").toHaveLength(2);
    expect(idsOf(links), "precondition : six liens").toHaveLength(6);

    for (const query of ["?sort=asc", "?order=name", "?sort=asc&order=name&limit=1"]) {
      expect(expectList(await getCollections(org.owner, org.organizationId, query), `collections ${query}`)).toEqual(collections);
      expect(expectList(await getLinks(org.owner, org.organizationId, collectionId, query), `liens ${query}`)).toEqual(links);
    }
  });
});

describe("AC8 — organisation retrogradee au-dessus du quota (patron de 005)", () => {
  it("AC8 : Pro puis Free avec 75 liens -> la lecture rend les 75 liens (somme des collections), dans l'ordre d'AC2, sans rien supprimer ni modifier, compteur 75", async () => {
    const pro = await createProOrganization({ name: "AC8 retrogradation lecture" });
    const { org } = pro;
    const collections = await createCollectionsViaApi(org.owner, org.organizationId, 3);
    await seedLinks({ organizationId: org.organizationId, userId: org.owner.userId, collectionIds: collections, count: 75 });
    await setSubscriptionDirect(org.organizationId, { tier: "free" });
    expect((await readSubscriptionRow(org.organizationId)).tier, "precondition : retrogradee en Free").toBe("free");
    expect(await linkState(org.organizationId), "precondition : 75 liens, compteur 75").toEqual({ rows: 75, counter: 75 });
    const rowsBefore = await readLinks(org.organizationId);

    let total = 0;
    const seen: string[] = [];
    for (const collectionId of collections) {
      const items = expectList(await getLinks(org.owner, org.organizationId, collectionId), `GET liens de la collection ${collectionId}`);
      const expected = (await readLinks(org.organizationId, collectionId)).map((row) => row.id).reverse();
      expect(expected.length, "precondition : chaque collection porte des liens").toBeGreaterThan(0);
      expect(idsOf(items), "ordre d'AC2 : created_at DESC puis id DESC").toEqual(expected);
      expect(idsOf(items), "meme horodatage (une seule insertion) : identifiants decroissants").toEqual(sortedDescending(expected));
      total += items.length;
      seen.push(...idsOf(items));
    }

    expect(total, "75 liens lus au total").toBe(75);
    expect(new Set(seen).size, "aucun lien lu deux fois").toBe(75);
    expect([...seen].sort()).toEqual(rowsBefore.map((row) => row.id).sort());
    expect(await linkState(org.organizationId), "compteur inchange, aucun lien supprime").toEqual({ rows: 75, counter: 75 });
    expect(await readLinks(org.organizationId), "aucun lien modifie").toEqual(rowsBefore);
    const listed = expectList(await getCollections(org.owner, org.organizationId), "GET collections de l'organisation retrogradee");
    expect(idsOf(listed).sort()).toEqual([...collections].sort());
    expect((await readCollections(org.organizationId)).map((c) => c.id).sort()).toEqual([...collections].sort());
  });
});
