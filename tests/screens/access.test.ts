/**
 * Tranche 012 — AC1 : acces sans session, cookie invalide, pages publiques, renvois
 * avec session.
 *
 * Pages lues par `fetch` sur TEST_APP_BASE_URL, `redirect: "manual"` ; « reponse
 * complete » = HTML + charge RSC. Les identifiants reels viennent d'une AUTRE
 * session (deux tenants reels).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signUp } from "../helpers/auth";
import { closeAllPools } from "../helpers/db";
import { createCollectionViaApi } from "../helpers/links";
import { createOrganizationFixture, type OrganizationFixture } from "../helpers/fixtures";
import {
  addLinkDirect,
  expectAbsent,
  expectPageStatus,
  getFullPage,
  getPage,
  uniqueOrgName,
} from "../helpers/screens";
import { INVALID_COOKIE } from "../helpers/screen-reads";

let org: OrganizationFixture;
let collectionId: string;
let linkId: string;
let collectionName: string;
let linkTitle: string;
let linkUrl: string;
let secrets: string[];

beforeAll(async () => {
  org = await createOrganizationFixture(uniqueOrgName("AC1"));
  collectionName = `Collection-Test-AC1-${Date.now()}`;
  collectionId = await createCollectionViaApi(org.owner, org.organizationId, collectionName);
  linkTitle = "Titre-Test-AC1-secret";
  linkUrl = "https://secret-ac1.invalid/page";
  linkId = await addLinkDirect({ organizationId: org.organizationId, collectionId, userId: org.owner.userId, url: linkUrl, title: linkTitle });
  secrets = [org.name, org.organizationId, org.owner.email, collectionName, collectionId, linkTitle, linkUrl, "secret-ac1.invalid", linkId];
});

afterAll(async () => {
  await closeAllPools();
});

function privatePaths(): string[] {
  return ["/organisations", `/organisations/${org.organizationId}`, `/organisations/${org.organizationId}/collections/${collectionId}`];
}

function expectLoginRedirect(location: string | null, label: string): void {
  expect(location, `${label} : en-tete Location present`).not.toBeNull();
  const target = new URL(location ?? "", "http://hote.invalid");
  expect(target.pathname, `${label} : renvoi vers /connexion (Location ${location})`).toBe("/connexion");
  expect(target.search, `${label} : aucun parametre de retour (L-2)`).toBe("");
  expect(target.hash, `${label} : aucun fragment`).toBe("");
  expect(location, `${label} : aucun parametre ni fragment dans le texte de Location`).not.toMatch(/[?#]/);
}

describe("AC1 : sans session", () => {
  it("AC1 : « / » renvoie 307 vers /connexion, sans parametre ni fragment", async () => {
    const page = await getPage("/", null);

    expectPageStatus(page, 307, "GET / sans session");
    expectLoginRedirect(page.location, "GET /");
  });

  it.each([0, 1, 2])("AC1 : la page privee %i (organisations, organisation, collection) renvoie 307 vers /connexion, sans aucune donnee dans la reponse", async (index) => {
    const path = privatePaths()[index] ?? "";

    const full = await getFullPage(path, null);

    expectPageStatus(full.html, 307, `GET ${path} sans session`);
    expectLoginRedirect(full.html.location, `GET ${path}`);
    expectAbsent(full, secrets, `GET ${path} sans session`);
  });

  it("AC1 : un identifiant d'une autre session ne change rien : meme renvoi pour une organisation et une collection inexistantes", async () => {
    const real = await getPage(`/organisations/${org.organizationId}`, null);
    const unknown = await getPage("/organisations/00000000-0000-4000-8000-000000000000", null);

    expectPageStatus(unknown, 307, "GET organisation inexistante sans session");
    expect(unknown.location).toBe(real.location);
  });
});

describe("AC1 : cookie invalide -> meme resultat que sans session", () => {
  it.each([0, 1, 2])("AC1 : la page privee %i avec un cookie invalide renvoie 307 vers /connexion, sans donnee", async (index) => {
    const path = privatePaths()[index] ?? "";

    const full = await getFullPage(path, INVALID_COOKIE);

    expectPageStatus(full.html, 307, `GET ${path} cookie invalide`);
    expectLoginRedirect(full.html.location, `GET ${path} cookie invalide`);
    expectAbsent(full, secrets, `GET ${path} cookie invalide`);
  });

  it("AC1 : « / » avec un cookie invalide renvoie 307 vers /connexion", async () => {
    const page = await getPage("/", INVALID_COOKIE);

    expectPageStatus(page, 307, "GET / cookie invalide");
    expectLoginRedirect(page.location, "GET / cookie invalide");
  });
});

describe("AC1 : pages publiques et renvois avec session", () => {
  it.each(["/connexion", "/inscription", "/invitations/accept"])("AC1 : %s repond 200 sans session", async (path) => {
    const page = await getPage(path, null);

    expectPageStatus(page, 200, `GET ${path} sans session`);
    expect(page.contentType ?? "").toContain("text/html");
  });

  it("AC1 : /invitations/accept repond 200 aussi avec un fragment (jamais envoye au serveur) et une chaine de requete quelconque", async () => {
    const page = await getPage("/invitations/accept?x=1", null);

    expectPageStatus(page, 200, "GET /invitations/accept?x=1");
  });

  it.each(["/", "/connexion", "/inscription"])("AC1 : %s avec une session valide renvoie 307 vers /organisations", async (path) => {
    const session = await signUp();

    const page = await getPage(path, session.cookie);

    expectPageStatus(page, 307, `GET ${path} avec session`);
    const target = new URL(page.location ?? "", "http://hote.invalid");
    expect(target.pathname, `Location ${page.location}`).toBe("/organisations");
    expect(target.search).toBe("");
  });

  it("AC1 : /invitations/accept avec une session reste 200 (la page propose d'accepter)", async () => {
    const session = await signUp();

    const page = await getPage("/invitations/accept", session.cookie);

    expectPageStatus(page, 200, "GET /invitations/accept avec session");
  });
});
