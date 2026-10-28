/**
 * Tranche 012 — AC6 (organisation d'autrui) et AC7 (collection d'autrui).
 *
 * Test d'isolation tenant de la tranche : deux tenants reels (A et B), des
 * comptes distincts, un compte membre des deux. Les pages sont lues avec le
 * cookie de session de l'appelant ; « reponse complete » = HTML + charge RSC.
 *
 * Comparaison de deux 404 : les identifiants demandes sont remplaces par des
 * jetons fixes (le chemin demande figure dans l'arbre de la charge RSC), puis les
 * reponses completes doivent etre egales.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeAllPools } from "../helpers/db";
import { createOrganizationFixture, type OrganizationFixture } from "../helpers/fixtures";
import { resetInvitationFakes, startInvitationFakes, stopInvitationFakes, type InvitationFakes } from "../helpers/invitations";
import { createCollectionViaApi } from "../helpers/links";
import { joinByInvitation } from "../helpers/screen-reads";
import { signUp, type AuthenticatedSession } from "../helpers/auth";
import {
  addLinkDirect,
  expectAbsent,
  expectFullStatus,
  getFullPage,
  replaceIds,
  textOf,
  uniqueOrgName,
  type FullPage,
} from "../helpers/screens";

let fakes: InvitationFakes;

beforeAll(async () => {
  fakes = await startInvitationFakes();
});

beforeEach(() => {
  resetInvitationFakes(fakes);
});

afterAll(async () => {
  await stopInvitationFakes(fakes);
  await closeAllPools();
});

interface Tenant {
  org: OrganizationFixture;
  member: AuthenticatedSession;
  collectionId: string;
  collectionName: string;
  linkTitle: string;
  linkUrl: string;
  secrets: string[];
}

async function buildTenant(label: string): Promise<Tenant> {
  const org = await createOrganizationFixture(uniqueOrgName(label));
  const member = await signUp();
  await joinByInvitation(fakes, org, member);
  const collectionName = `Collection-Test-${label}-${Date.now()}`;
  const collectionId = await createCollectionViaApi(org.owner, org.organizationId, collectionName);
  const linkTitle = `Titre-Test-${label}-prive`;
  const linkUrl = `https://prive-${label.toLowerCase()}.invalid/page`;
  await addLinkDirect({ organizationId: org.organizationId, collectionId, userId: org.owner.userId, url: linkUrl, title: linkTitle });
  const tenant: Tenant = {
    org,
    member,
    collectionId,
    collectionName,
    linkTitle,
    linkUrl,
    secrets: [org.name, org.organizationId, org.owner.email, org.owner.userId, member.email, member.userId, collectionName, collectionId, linkTitle, linkUrl, `prive-${label.toLowerCase()}.invalid`],
  };
  await expectOwnPagesOpen(tenant);
  return tenant;
}

/** Precondition : sans elle, une route absente (404 partout) ferait passer les comparaisons de 404 a vide. */
async function expectOwnPagesOpen(...tenants: Tenant[]): Promise<void> {
  for (const tenant of tenants) {
    const own = await getFullPage(`/organisations/${tenant.org.organizationId}`, tenant.org.owner);
    expectFullStatus(own, 200, "precondition : le proprietaire ouvre sa propre organisation");
    const collection = await getFullPage(`/organisations/${tenant.org.organizationId}/collections/${tenant.collectionId}`, tenant.org.owner);
    expectFullStatus(collection, 200, "precondition : le proprietaire ouvre sa propre collection");
  }
}

const FIXED_ORG = "ORG_ID_FIXE";
const FIXED_COLLECTION = "COLLECTION_ID_FIXE";

function normalized(page: FullPage, replacements: readonly (readonly [string, string])[]): { html: string; rsc: string } {
  return { html: replaceIds(page.html.text, replacements), rsc: replaceIds(page.rsc.text, replacements) };
}

describe("AC6 : organisation d'autrui", () => {
  it("AC6 : 404 identique, reponse complete comprise, a celle d'un UUID inexistant et d'un identifiant malforme ; aucune donnee de l'organisation", async () => {
    const tenantA = await buildTenant("AC6-A");
    const tenantB = await buildTenant("AC6-B");
    const unknownId = randomUUID();
    const malformedIds = ["pas-un-uuid", "12345"];

    const foreign = await getFullPage(`/organisations/${tenantB.org.organizationId}`, tenantA.org.owner);
    const unknown = await getFullPage(`/organisations/${unknownId}`, tenantA.org.owner);
    const malformed = await Promise.all(malformedIds.map((id) => getFullPage(`/organisations/${id}`, tenantA.org.owner)));

    expectFullStatus(foreign, 404, "AC6 : organisation d'autrui");
    expectFullStatus(unknown, 404, "AC6 : UUID inexistant");
    for (const page of malformed) expectFullStatus(page, 404, "AC6 : identifiant malforme (L-7)");
    const reference = normalized(unknown, [[unknownId, FIXED_ORG]]);
    expect(normalized(foreign, [[tenantB.org.organizationId, FIXED_ORG]]), "organisation d'autrui == UUID inexistant").toEqual(reference);
    malformed.forEach((page, index) => {
      expect(normalized(page, [[malformedIds[index] ?? "", FIXED_ORG]]), `malforme ${malformedIds[index]} == UUID inexistant`).toEqual(reference);
    });
    expectAbsent(foreign, tenantB.secrets, "AC6 : donnees de l'organisation d'autrui");
  });

  it("AC6 : un member (invite) d'une organisation n'ouvre pas l'organisation d'autrui non plus", async () => {
    const tenantA = await buildTenant("AC6-C");
    const tenantB = await buildTenant("AC6-D");
    const unknownId = randomUUID();

    const foreign = await getFullPage(`/organisations/${tenantB.org.organizationId}`, tenantA.member);
    const unknown = await getFullPage(`/organisations/${unknownId}`, tenantA.member);

    expectFullStatus(foreign, 404, "AC6 : member, organisation d'autrui");
    expect(normalized(foreign, [[tenantB.org.organizationId, FIXED_ORG]])).toEqual(normalized(unknown, [[unknownId, FIXED_ORG]]));
    expectAbsent(foreign, tenantB.secrets, "AC6 : donnees d'autrui vues par un member");
  });

  it("AC6 : un identifiant en majuscules d'une organisation d'autrui est tout aussi introuvable", async () => {
    const tenantA = await buildTenant("AC6-E");
    const tenantB = await buildTenant("AC6-F");

    const foreign = await getFullPage(`/organisations/${tenantB.org.organizationId.toUpperCase()}`, tenantA.org.owner);

    expectFullStatus(foreign, 404, "AC6 : majuscules");
    expectAbsent(foreign, tenantB.secrets, "AC6 : majuscules");
  });

  it("AC6 : la page introuvable ne contient aucun texte libre : son texte visible est le meme pour tout identifiant", async () => {
    const tenantA = await buildTenant("AC6-G");

    const one = await getFullPage(`/organisations/${randomUUID()}`, tenantA.org.owner);
    const two = await getFullPage(`/organisations/${randomUUID()}`, tenantA.org.owner);

    expect(textOf(one.html.text).length).toBeGreaterThan(0);
    expect(textOf(one.html.text)).toBe(textOf(two.html.text));
  });
});

describe("AC7 : collection d'autrui", () => {
  it("AC7 : /organisations/<A>/collections/<collection de B> pour un membre de A seul : 404 identique a une collection inexistante de A", async () => {
    const tenantA = await buildTenant("AC7-A");
    const tenantB = await buildTenant("AC7-B");
    const unknownCollection = randomUUID();

    const crossed = await getFullPage(`/organisations/${tenantA.org.organizationId}/collections/${tenantB.collectionId}`, tenantA.org.owner);
    const unknown = await getFullPage(`/organisations/${tenantA.org.organizationId}/collections/${unknownCollection}`, tenantA.org.owner);

    expectFullStatus(crossed, 404, "AC7 : collection de B sous A");
    expectFullStatus(unknown, 404, "AC7 : collection inexistante de A");
    const replacements = (collectionId: string): (readonly [string, string])[] => [
      [tenantA.org.organizationId, FIXED_ORG],
      [collectionId, FIXED_COLLECTION],
    ];
    expect(normalized(crossed, replacements(tenantB.collectionId))).toEqual(normalized(unknown, replacements(unknownCollection)));
    expectAbsent(crossed, tenantB.secrets, "AC7 : donnees de B");
  });

  it("AC7 : pour un membre de A ET de B, le chemin fait autorite : la collection de B sous A est 404, identique a une collection inexistante de A", async () => {
    const tenantA = await buildTenant("AC7-C");
    const tenantB = await buildTenant("AC7-D");
    const both = await signUp();
    await joinByInvitation(fakes, tenantA.org, both);
    await joinByInvitation(fakes, tenantB.org, both);
    const unknownCollection = randomUUID();

    const crossed = await getFullPage(`/organisations/${tenantA.org.organizationId}/collections/${tenantB.collectionId}`, both);
    const unknown = await getFullPage(`/organisations/${tenantA.org.organizationId}/collections/${unknownCollection}`, both);
    const ownPath = await getFullPage(`/organisations/${tenantB.org.organizationId}/collections/${tenantB.collectionId}`, both);

    expectFullStatus(crossed, 404, "AC7 : membre des deux, collection de B sous A");
    expectFullStatus(unknown, 404, "AC7 : membre des deux, collection inexistante de A");
    expect(
      normalized(crossed, [[tenantA.org.organizationId, FIXED_ORG], [tenantB.collectionId, FIXED_COLLECTION]]),
      "le chemin fait autorite",
    ).toEqual(normalized(unknown, [[tenantA.org.organizationId, FIXED_ORG], [unknownCollection, FIXED_COLLECTION]]));
    expectAbsent(crossed, [tenantB.linkTitle, tenantB.linkUrl, tenantB.collectionName], "AC7 : aucun titre, URL ni nom de B sous le chemin de A");
    expectFullStatus(ownPath, 200, "AC7 : precondition, sous son propre chemin la collection de B s'ouvre pour ce compte");
    expect(textOf(ownPath.html.text)).toContain(tenantB.linkTitle);
  });

  it("AC7 : la collection de B sous son propre chemin, pour un non-membre de B : 404 identique a celui d'une organisation d'autrui (AC6)", async () => {
    const tenantA = await buildTenant("AC7-E");
    const tenantB = await buildTenant("AC7-F");
    const unknownOrg = randomUUID();
    const unknownCollection = randomUUID();

    const foreign = await getFullPage(`/organisations/${tenantB.org.organizationId}/collections/${tenantB.collectionId}`, tenantA.org.owner);
    const unknown = await getFullPage(`/organisations/${unknownOrg}/collections/${unknownCollection}`, tenantA.org.owner);
    const orgLevel = await getFullPage(`/organisations/${tenantB.org.organizationId}`, tenantA.org.owner);

    expectFullStatus(foreign, 404, "AC7 : collection de B pour un non-membre de B");
    expectFullStatus(unknown, 404, "AC7 : organisation et collection inexistantes");
    expect(
      normalized(foreign, [[tenantB.org.organizationId, FIXED_ORG], [tenantB.collectionId, FIXED_COLLECTION]]),
    ).toEqual(normalized(unknown, [[unknownOrg, FIXED_ORG], [unknownCollection, FIXED_COLLECTION]]));
    expect(textOf(foreign.html.text), "meme page introuvable que celle d'une organisation d'autrui").toBe(textOf(orgLevel.html.text));
    expectAbsent(foreign, tenantB.secrets, "AC7 : donnees de B");
  });

  it("AC7 : un identifiant de collection malforme est aussi introuvable, sous une organisation dont on est membre", async () => {
    const tenantA = await buildTenant("AC7-G");
    const unknownCollection = randomUUID();

    const malformed = await getFullPage(`/organisations/${tenantA.org.organizationId}/collections/pas-un-uuid`, tenantA.org.owner);
    const unknown = await getFullPage(`/organisations/${tenantA.org.organizationId}/collections/${unknownCollection}`, tenantA.org.owner);

    expectFullStatus(malformed, 404, "AC7 : collection malformee");
    expect(normalized(malformed, [[tenantA.org.organizationId, FIXED_ORG], ["pas-un-uuid", FIXED_COLLECTION]])).toEqual(
      normalized(unknown, [[tenantA.org.organizationId, FIXED_ORG], [unknownCollection, FIXED_COLLECTION]]),
    );
  });
});
