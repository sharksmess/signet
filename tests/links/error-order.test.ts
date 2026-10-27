/**
 * Tranche 005 — ordre des messages 422 (contrat : chemin, puis url, puis
 * title ; review-005 A CORRIGER 2), sans figer les textes (D-124). Chaque
 * egalite est accompagnee d'une inegalite : si tous les 422 portaient le meme
 * texte, les inegalites echoueraient.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closeAllPools } from "../helpers/db";
import { createOrganizationFixture, type OrganizationFixture } from "../helpers/fixtures";
import { expectError } from "../helpers/billing";
import { closeLinkPools, createCollectionViaApi, messageOf, postLink, uniqueUrl } from "../helpers/links";

afterAll(async () => {
  await closeLinkPools();
  await closeAllPools();
});

let org: OrganizationFixture;
let collectionId: string;

beforeAll(async () => {
  org = await createOrganizationFixture("Ordre des 422");
  collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
});

const BAD_URL = "ftp://exemple.invalid/x";
const GOOD_TITLE = "Titre de test";
const BAD_PATH = "pas-un-uuid";

async function messageFor(path: string, payload: Record<string, unknown>, label: string): Promise<string> {
  const result = await postLink(org.owner, org.organizationId, path, payload);
  expectError(result, 422, "VALIDATION_FAILED", label);
  const message = messageOf(result);
  if (message === undefined) throw new Error(`${label} : aucun message. Corps brut : ${result.text}`);
  return message;
}

describe("ordre des messages 422", () => {
  it("titre seul invalide : message different de celui de l'url seule invalide", async () => {
    const urlOnly = await messageFor(collectionId, { url: BAD_URL, title: GOOD_TITLE }, "url seule");
    const titleOnly = await messageFor(collectionId, { url: uniqueUrl(), title: "" }, "titre seul");

    expect(titleOnly).not.toBe(urlOnly);
  });

  it("url ET titre invalides : message de l'url seule (l'url passe avant le titre)", async () => {
    const urlOnly = await messageFor(collectionId, { url: BAD_URL, title: GOOD_TITLE }, "url seule");
    const titleOnly = await messageFor(collectionId, { url: uniqueUrl(), title: "" }, "titre seul");
    const both = await messageFor(collectionId, { url: BAD_URL, title: "" }, "url et titre");

    expect(both).toBe(urlOnly);
    expect(both).not.toBe(titleOnly);
  });

  it("collectionId malforme : message different de celui de l'url seule invalide", async () => {
    const urlOnly = await messageFor(collectionId, { url: BAD_URL, title: GOOD_TITLE }, "url seule");
    const pathOnly = await messageFor(BAD_PATH, { url: uniqueUrl(), title: GOOD_TITLE }, "chemin seul");

    expect(pathOnly).not.toBe(urlOnly);
  });

  it("chemin invalide ET url invalide : message du chemin seul (le chemin passe avant l'url)", async () => {
    const urlOnly = await messageFor(collectionId, { url: BAD_URL, title: GOOD_TITLE }, "url seule");
    const pathOnly = await messageFor(BAD_PATH, { url: uniqueUrl(), title: GOOD_TITLE }, "chemin seul");
    const both = await messageFor(BAD_PATH, { url: BAD_URL, title: GOOD_TITLE }, "chemin et url");

    expect(both).toBe(pathOnly);
    expect(both).not.toBe(urlOnly);
  });

  it("chemin, url et titre tous invalides : message du chemin seul", async () => {
    const pathOnly = await messageFor(BAD_PATH, { url: uniqueUrl(), title: GOOD_TITLE }, "chemin seul");
    const all = await messageFor(BAD_PATH, { url: BAD_URL, title: "" }, "tout invalide");

    expect(all).toBe(pathOnly);
  });
});
