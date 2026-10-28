/**
 * Tranche 009 — AC4 (session, US-07.3) et AC5 (validation et ordre des
 * erreurs : 401 < 422 < 404 organisation < 404 collection). Les deux routes GET
 * sont couvertes. Les textes des messages ne sont pas figes (D-124) : on prouve
 * qu'ils sont fixes (sans la valeur soumise ni Zod) et lesquels sont distincts.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signUp } from "../helpers/auth";
import { closeAllPools } from "../helpers/db";
import { createOrganizationFixture, createTwoOrganizationsFixture, type OrganizationFixture } from "../helpers/fixtures";
import { expectError } from "../helpers/billing";
import { createCollectionViaApi, expectCleanErrorBody } from "../helpers/links";
import {
  getCollections,
  getCollectionsWithCookie,
  getLinks,
  getLinksWithCookie,
  messageFrom,
} from "../helpers/consultation";

afterAll(async () => {
  await closeAllPools();
});

const MALFORMED = ["pas-un-uuid", "12345", "00000000-0000-0000-0000-00000000000g", "00000000-0000-0000-0000-0000000000000"];

describe("AC4 — session (US-07.3)", () => {
  let org: OrganizationFixture;
  let collectionId: string;

  beforeAll(async () => {
    org = await createOrganizationFixture("AC4 session");
    collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
  });

  it("AC4 : sans cookie -> 401 UNAUTHENTICATED sur les deux routes, ids valides", async () => {
    expectError(await getCollections(null, org.organizationId), 401, "UNAUTHENTICATED", "collections sans session");
    expectError(await getLinks(null, org.organizationId, collectionId), 401, "UNAUTHENTICATED", "liens sans session");
  });

  it("AC4 : cookie invalide -> 401 UNAUTHENTICATED sur les deux routes", async () => {
    const cookie = "better-auth.session_token=invalide.invalide";
    expectError(await getCollectionsWithCookie(org.organizationId, cookie), 401, "UNAUTHENTICATED", "collections, cookie invalide");
    expectError(await getLinksWithCookie(org.organizationId, collectionId, cookie), 401, "UNAUTHENTICATED", "liens, cookie invalide");
  });

  it("AC4 : quelle que soit la validite des identifiants du chemin (malformes, inexistants) -> 401", async () => {
    const cookie = "better-auth.session_token=invalide.invalide";
    for (const bad of MALFORMED) {
      expectError(await getCollections(null, bad), 401, "UNAUTHENTICATED", `collections, organisation ${bad}`);
      expectError(await getLinks(null, bad, bad), 401, "UNAUTHENTICATED", `liens, chemin ${bad}`);
      expectError(await getLinks(null, org.organizationId, bad), 401, "UNAUTHENTICATED", `liens, collection ${bad}`);
      expectError(await getLinksWithCookie(bad, bad, cookie), 401, "UNAUTHENTICATED", `liens, cookie invalide, chemin ${bad}`);
    }
    expectError(await getCollections(null, randomUUID()), 401, "UNAUTHENTICATED", "collections, organisation inexistante");
    expectError(await getLinks(null, randomUUID(), randomUUID()), 401, "UNAUTHENTICATED", "liens, chemin inexistant");
    expectError(await getLinks(null, org.organizationId, randomUUID()), 401, "UNAUTHENTICATED", "liens, collection inexistante");
  });

  it("AC4 : la reponse 401 ne revele rien de la ressource (meme corps avec ou sans identifiants valides)", async () => {
    const valid = await getLinks(null, org.organizationId, collectionId);
    const unknown = await getLinks(null, randomUUID(), randomUUID());
    const malformed = await getLinks(null, "pas-un-uuid", "pas-un-uuid");

    expectError(valid, 401, "UNAUTHENTICATED", "identifiants valides");
    expectError(unknown, 401, "UNAUTHENTICATED", "identifiants inexistants");
    expectError(malformed, 401, "UNAUTHENTICATED", "identifiants malformes");
    expect(valid.text).toBe(unknown.text);
    expect(valid.text).toBe(malformed.text);
    expectCleanErrorBody(valid, "401", [org.organizationId, collectionId]);
  });
});

describe("AC5 — validation et ordre des erreurs", () => {
  it("AC5 : organizationId malforme -> 422 VALIDATION_FAILED, message fixe sans la valeur soumise ni Zod (collections et liens)", async () => {
    const org = await createOrganizationFixture("AC5 organisation malformee");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");

    for (const bad of MALFORMED) {
      const forCollections = await getCollections(org.owner, bad);
      const forLinks = await getLinks(org.owner, bad, collectionId);

      expectError(forCollections, 422, "VALIDATION_FAILED", `collections, organisation ${JSON.stringify(bad)}`);
      expectError(forLinks, 422, "VALIDATION_FAILED", `liens, organisation ${JSON.stringify(bad)}`);
      expectCleanErrorBody(forCollections, `collections ${bad}`, [bad]);
      expectCleanErrorBody(forLinks, `liens ${bad}`, [bad, collectionId]);
      expect(messageFrom(forLinks), "meme message pour le meme defaut sur les deux routes").toBe(messageFrom(forCollections));
    }
  });

  it("AC5 : collectionId malforme -> 422 VALIDATION_FAILED, message fixe sans la valeur soumise ni Zod", async () => {
    const org = await createOrganizationFixture("AC5 collection malformee");

    for (const bad of MALFORMED) {
      const result = await getLinks(org.owner, org.organizationId, bad);

      expectError(result, 422, "VALIDATION_FAILED", `liens, collection ${JSON.stringify(bad)}`);
      expectCleanErrorBody(result, `liens collection ${bad}`, [bad, org.organizationId]);
    }
  });

  it("AC5 : session, organisation non membre (ou inexistante) et collectionId malforme -> 422 (la validation passe avant l'appartenance)", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();

    const foreign = await getLinks(orgB.owner, orgA.organizationId, "pas-un-uuid");
    const unknown = await getLinks(orgB.owner, randomUUID(), "pas-un-uuid");

    expectError(foreign, 422, "VALIDATION_FAILED", "organisation d'autrui, collection malformee");
    expectError(unknown, 422, "VALIDATION_FAILED", "organisation inexistante, collection malformee");
    expect(foreign.text, "ne revele rien sur l'organisation").toBe(unknown.text);
  });

  it("AC5 : organisation ET collection malformees -> message de l'organisation, different de celui de la collection", async () => {
    const org = await createOrganizationFixture("AC5 deux malformes");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");

    const orgOnly = await getLinks(org.owner, "pas-un-uuid", collectionId);
    const collectionOnly = await getLinks(org.owner, org.organizationId, "pas-un-uuid");
    const both = await getLinks(org.owner, "pas-un-uuid", "pas-un-uuid");

    expectError(orgOnly, 422, "VALIDATION_FAILED", "organisation seule malformee");
    expectError(collectionOnly, 422, "VALIDATION_FAILED", "collection seule malformee");
    expectError(both, 422, "VALIDATION_FAILED", "les deux malformes");
    expect(messageFrom(both)).toBe(messageFrom(orgOnly));
    expect(messageFrom(both)).not.toBe(messageFrom(collectionOnly));
  });

  it("AC5 : sans session et chemin malforme -> 401 (la session passe avant la validation)", async () => {
    expectError(await getCollections(null, "pas-un-uuid"), 401, "UNAUTHENTICATED", "collections");
    expectError(await getLinks(null, "pas-un-uuid", "pas-un-uuid"), 401, "UNAUTHENTICATED", "liens");
  });

  it("AC5 : organisation non membre et collection inexistante -> 404 ORGANIZATION_NOT_FOUND (l'organisation passe avant la collection)", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const stranger = await signUp();

    const asOwnerOfB = await getLinks(orgB.owner, orgA.organizationId, randomUUID());
    const asStranger = await getLinks(stranger, orgA.organizationId, randomUUID());
    const unknownOrg = await getLinks(orgB.owner, randomUUID(), randomUUID());

    expectError(asOwnerOfB, 404, "ORGANIZATION_NOT_FOUND", "owner de B, organisation A, collection inexistante");
    expectError(asStranger, 404, "ORGANIZATION_NOT_FOUND", "utilisateur sans organisation");
    expectError(unknownOrg, 404, "ORGANIZATION_NOT_FOUND", "organisation inexistante");
    expect(asOwnerOfB.text).toBe(unknownOrg.text);
    expect(asStranger.text).toBe(unknownOrg.text);
  });

  it("AC5 : organisation membre et collection inexistante -> 404 COLLECTION_NOT_FOUND, sans identifiant dans le corps", async () => {
    const org = await createOrganizationFixture("AC5 collection inexistante");
    const missing = randomUUID();

    const result = await getLinks(org.owner, org.organizationId, missing);

    expectError(result, 404, "COLLECTION_NOT_FOUND", "collection inexistante dans mon organisation");
    expectCleanErrorBody(result, "collection inexistante", [missing, org.organizationId]);
  });

  it("AC5 : collections d'une organisation inexistante ou d'autrui -> 404 ORGANIZATION_NOT_FOUND, corps sans identifiant", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const missing = randomUUID();

    const foreign = await getCollections(orgB.owner, orgA.organizationId);
    const unknown = await getCollections(orgB.owner, missing);

    expectError(foreign, 404, "ORGANIZATION_NOT_FOUND", "collections d'autrui");
    expectError(unknown, 404, "ORGANIZATION_NOT_FOUND", "collections d'une organisation inexistante");
    expectCleanErrorBody(foreign, "collections d'autrui", [orgA.organizationId]);
    expectCleanErrorBody(unknown, "collections inexistantes", [missing]);
  });
});
