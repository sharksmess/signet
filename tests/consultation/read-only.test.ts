/**
 * Tranche 009 — AC10 : lecture seule prouvee. Apres une serie de lectures
 * (succes et chaque cas d'erreur d'AC4 a AC6), les lignes `collection` et
 * `link` et la ligne `organization_link_usage` sont inchangees. La partie
 * « aucun privilege, aucune politique, aucune fonction SECURITY DEFINER
 * nouveaux » est portee par les tests de catalogue de 004 et 005, qui doivent
 * rester verts sans modification : rien n'est reecrit ici.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { closeAllPools } from "../helpers/db";
import { createOrganizationFixture } from "../helpers/fixtures";
import { expectError, expectStatus } from "../helpers/billing";
import { createMemberSession } from "../helpers/collections";
import { closeLinkPools, createCollectionViaApi, postLink, uniqueUrl } from "../helpers/links";
import {
  expectList,
  getCollections,
  getCollectionsWithCookie,
  getLinks,
  getLinksWithCookie,
  snapshotOrganization,
} from "../helpers/consultation";

afterAll(async () => {
  await closeLinkPools();
  await closeAllPools();
});

describe("AC10 — lecture seule", () => {
  it("AC10 : une serie de lectures (succes et erreurs) laisse collection, link et organization_link_usage inchanges, dans l'organisation lue et dans celle de l'appelant etranger", async () => {
    const a = await createOrganizationFixture("AC10 A");
    const b = await createOrganizationFixture("AC10 B");
    const member = await createMemberSession(a.organizationId);
    const collectionA = await createCollectionViaApi(a.owner, a.organizationId, "Veille");
    await createCollectionViaApi(a.owner, a.organizationId, "Autre");
    const collectionB = await createCollectionViaApi(b.owner, b.organizationId, "Veille");
    for (const [session, organizationId, collectionId] of [
      [a.owner, a.organizationId, collectionA],
      [b.owner, b.organizationId, collectionB],
    ] as const) {
      expectStatus(await postLink(session, organizationId, collectionId, { url: uniqueUrl(), title: "Arrangement" }), 201, "arrangement : lien");
    }
    const beforeA = await snapshotOrganization(a.organizationId);
    const beforeB = await snapshotOrganization(b.organizationId);
    expect(beforeA, "precondition : A a 2 collections, 1 lien, compteur 1").toMatchObject({ collections: 2, links: 1, usage: { link_count: 1 } });
    expect(beforeB, "precondition : B a 1 collection, 1 lien, compteur 1").toMatchObject({ collections: 1, links: 1, usage: { link_count: 1 } });
    const cookie = "better-auth.session_token=invalide.invalide";

    // Succes
    expectList(await getCollections(a.owner, a.organizationId), "owner : collections");
    expectList(await getCollections(member, a.organizationId, "?sort=asc"), "member : collections");
    expectList(await getLinks(a.owner, a.organizationId, collectionA), "owner : liens");
    expectList(await getLinks(member, a.organizationId, collectionA.toUpperCase()), "member : liens");
    // AC4
    expectError(await getCollections(null, a.organizationId), 401, "UNAUTHENTICATED", "collections sans session");
    expectError(await getLinks(null, a.organizationId, collectionA), 401, "UNAUTHENTICATED", "liens sans session");
    expectError(await getCollectionsWithCookie(a.organizationId, cookie), 401, "UNAUTHENTICATED", "collections, cookie invalide");
    expectError(await getLinksWithCookie(a.organizationId, collectionA, cookie), 401, "UNAUTHENTICATED", "liens, cookie invalide");
    // AC5
    expectError(await getCollections(a.owner, "pas-un-uuid"), 422, "VALIDATION_FAILED", "collections, organisation malformee");
    expectError(await getLinks(a.owner, a.organizationId, "pas-un-uuid"), 422, "VALIDATION_FAILED", "liens, collection malformee");
    expectError(await getLinks(a.owner, "pas-un-uuid", "pas-un-uuid"), 422, "VALIDATION_FAILED", "liens, deux malformes");
    expectError(await getLinks(a.owner, a.organizationId, randomUUID()), 404, "COLLECTION_NOT_FOUND", "liens, collection inexistante");
    expectError(await getLinks(a.owner, randomUUID(), randomUUID()), 404, "ORGANIZATION_NOT_FOUND", "liens, organisation inexistante");
    // AC6
    expectError(await getCollections(b.owner, a.organizationId), 404, "ORGANIZATION_NOT_FOUND", "owner de B vers les collections de A");
    expectError(await getLinks(b.owner, a.organizationId, collectionA), 404, "ORGANIZATION_NOT_FOUND", "owner de B vers les liens de A");
    expectError(await getLinks(a.owner, a.organizationId, collectionB), 404, "COLLECTION_NOT_FOUND", "owner de A, collection de B sous A");

    expect(await snapshotOrganization(a.organizationId), "organisation A inchangee").toEqual(beforeA);
    expect(await snapshotOrganization(b.organizationId), "organisation B inchangee").toEqual(beforeB);
  });

  it("AC10 : la lecture d une organisation sans lien laisse son compteur inchange", async () => {
    const org = await createOrganizationFixture("AC10 compteur");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Vide");
    const before = await snapshotOrganization(org.organizationId);

    expectList(await getCollections(org.owner, org.organizationId), "collections");
    expectList(await getLinks(org.owner, org.organizationId, collectionId), "liens d'une collection vide");

    expect(await snapshotOrganization(org.organizationId)).toEqual(before);
    expect(before.links).toBe(0);
  });
});
