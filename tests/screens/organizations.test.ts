/**
 * Tranche 012 — AC2 (a, e, f), AC3 (mes organisations), AC4 (vue owner),
 * AC5 (vue member), AC12 (parcours reel d'invitation vers la vue member).
 *
 * Le member vient du parcours d'invitation reel (003 puis 006, fausse messagerie).
 * Les marqueurs de page (`data-testid`) sont fixes dans tests/helpers/screens.ts.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signUp, uniqueEmail } from "../helpers/auth";
import { getCollections, expectList, idsOf } from "../helpers/consultation";
import { closeAllPools } from "../helpers/db";
import { createOrganizationFixture, type OrganizationFixture } from "../helpers/fixtures";
import { resetInvitationFakes, startInvitationFakes, stopInvitationFakes, type InvitationFakes } from "../helpers/invitations";
import { createOrganization } from "../helpers/organizationsApi";
import { createCollectionViaApi } from "../helpers/links";
import { getMembers, getMyOrganizations, recordsOf, signUpAndJoin } from "../helpers/screen-reads";
import {
  collectionIdsOf,
  expectAbsent,
  expectFullStatus,
  expectPageStatus,
  getFullPage,
  getPage,
  hasTestId,
  organizationIdsOf,
  rowsOf,
  textOf,
  tagsNamed,
  uniqueOrgName,
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

const CREATION_FAILED_MESSAGE = "Votre compte est cree, mais l'organisation n'a pas pu l'etre. Creez-la ci-dessous.";

describe("AC2 : inscription et message d'echec de creation", () => {
  it("AC2 (a) : la page /inscription sert exactement trois champs (adresse, mot de passe, nom de l'organisation)", async () => {
    const page = await getPage("/inscription", null);

    expectPageStatus(page, 200, "GET /inscription");
    const fields = ["input", "textarea", "select"].flatMap((name) => tagsNamed(page.text, name));
    const visibleFields = fields.filter((tag) => tag.attributes.type !== "hidden");
    expect(visibleFields.map((tag) => `${tag.name}:${tag.attributes.type ?? "text"}`).sort(), `champs de la page. Corps brut : ${page.text}`).toEqual([
      "input:email",
      "input:password",
      "input:text",
    ]);
    expect(hasTestId(page.text, "sign-up-form")).toBe(true);
  });

  it("AC2 (e) : /organisations?creation=echec, pour un compte sans organisation, affiche le message fixe et le formulaire de creation", async () => {
    const session = await signUp();

    const full = await getFullPage("/organisations?creation=echec", session);

    expectFullStatus(full, 200, "creation=echec");
    expect(textOf(full.html.text), `texte visible. Corps brut : ${full.html.text}`).toContain(CREATION_FAILED_MESSAGE);
    expect(hasTestId(full.html.text, "create-organization-form")).toBe(true);
    expect(organizationIdsOf(full.html.text)).toEqual([]);
  });

  it("AC2 (e) : sans le parametre, le message n'est pas affiche ; le formulaire de creation l'est", async () => {
    const session = await signUp();

    const full = await getFullPage("/organisations", session);

    expectFullStatus(full, 200, "organisations sans parametre");
    expect(textOf(full.html.text)).not.toContain("l'organisation n'a pas pu l'etre");
    expect(full.rsc.text).not.toContain("n'a pas pu l'etre");
    expect(hasTestId(full.html.text, "create-organization-form")).toBe(true);
  });

  it.each(["Echec", "ECHEC", "echec ", "echec2", "oui", "", "true", "1", "%65chec"])(
    "AC2 (e) : creation=%j n'affiche pas le message (seule la valeur exacte « echec » le fait)",
    async (value) => {
      const session = await signUp();

      const full = await getFullPage(`/organisations?creation=${encodeURIComponent(value)}`, session);

      expectFullStatus(full, 200, `creation=${value}`);
      expect(textOf(full.html.text)).not.toContain(CREATION_FAILED_MESSAGE);
      expect(full.rsc.text).not.toContain("n'a pas pu l'etre");
    },
  );

  it("AC2 (e) : une valeur piegee du parametre n'apparait nulle part dans la reponse complete (HTML et charge RSC), ni brute ni echappee", async () => {
    const session = await signUp();
    const marker = `PIEGE-ABSENT-${randomUUID().slice(0, 8)}`;
    const trap = `${marker}"><img src=x onerror=alert(1)>`;

    const full = await getFullPage(`/organisations?creation=${encodeURIComponent(trap)}`, session);

    expectFullStatus(full, 200, "creation=valeur piegee");
    expectAbsent(full, [marker, trap, "onerror=alert(1)", "&lt;img src=x", encodeURIComponent(trap), encodeURIComponent(marker)], "valeur piegee du parametre creation");
    expect(textOf(full.html.text)).not.toContain(CREATION_FAILED_MESSAGE);
  });

  it("AC2 (f) : un compte inscrit puis son organisation creee par les vraies routes la voit dans /organisations et comme owner sur sa page", async () => {
    const owner = await signUp({ email: uniqueEmail("inscrit") });
    const name = uniqueOrgName("AC2f");
    const created = await createOrganization(owner, { name });
    expect(created.status, `creation : ${JSON.stringify(created.body)}`).toBe(201);
    const organizationId = (created.body as { id: string }).id;

    const list = await getFullPage("/organisations", owner);
    const detail = await getFullPage(`/organisations/${organizationId}`, owner);

    expectFullStatus(list, 200, "AC2 f : /organisations");
    expect(organizationIdsOf(list.html.text)).toEqual([organizationId]);
    expect(textOf(list.html.text)).toContain(name);
    expectFullStatus(detail, 200, "AC2 f : page de l'organisation");
    expect(textOf(detail.html.text)).toContain(name);
    const members = rowsOf(detail.html.text, "member-row").map((row) => textOf(row));
    expect(members).toHaveLength(1);
    expect(members[0]).toContain(owner.email);
    expect(members[0]).toContain("owner");
    expect(hasTestId(detail.html.text, "subscription-block"), "un owner voit le bloc Palier").toBe(true);
  });
});

describe("AC3 : mes organisations", () => {
  it("AC3 : la page liste exactement les organisations de listMyOrganizations de l'appelant, dans son ordre, chacune avec un lien vers /organisations/<id>", async () => {
    const owner = await signUp();
    const names: string[] = [];
    for (const label of ["premiere", "deuxieme", "troisieme"]) {
      const name = uniqueOrgName(`AC3-${label}`);
      names.push(name);
      const created = await createOrganization(owner, { name });
      expect(created.status, `creation ${label} : ${JSON.stringify(created.body)}`).toBe(201);
    }
    const expectedIds = recordsOf(await getMyOrganizations(owner), "listMyOrganizations").map((item) => String(item.id));
    expect(expectedIds).toHaveLength(3);

    const full = await getFullPage("/organisations", owner);

    expectFullStatus(full, 200, "AC3 : /organisations");
    expect(organizationIdsOf(full.html.text), "meme liste, meme ordre que la lecture").toEqual(expectedIds);
    const rows = rowsOf(full.html.text, "organization-row").map((row) => textOf(row));
    const expectedNames = recordsOf(await getMyOrganizations(owner), "listMyOrganizations").map((item) => String(item.name));
    expect(rows.map((row, index) => row.includes(expectedNames[index] ?? "\u0000"))).toEqual([true, true, true]);
    expect(hasTestId(full.html.text, "create-organization-form")).toBe(true);
  });

  it("AC3 : l'organisation d'un autre utilisateur n'y figure pas, et ?userId=<autre> ne change rien", async () => {
    const mine = await createOrganizationFixture(uniqueOrgName("AC3-moi"));
    const theirs = await createOrganizationFixture(uniqueOrgName("AC3-autre"));

    const plain = await getFullPage("/organisations", mine.owner);
    const tampered = await getFullPage(`/organisations?userId=${theirs.owner.userId}`, mine.owner);

    expectFullStatus(plain, 200, "AC3 : sans parametre");
    expectFullStatus(tampered, 200, "AC3 : ?userId=<autre>");
    expect(organizationIdsOf(plain.html.text)).toEqual([mine.organizationId]);
    expect(organizationIdsOf(tampered.html.text)).toEqual([mine.organizationId]);
    for (const page of [plain, tampered]) {
      expectAbsent(page, [theirs.name, theirs.organizationId, theirs.owner.email, theirs.owner.userId], "AC3 : donnees de l'autre utilisateur");
    }
    expect(tampered.html.text, "reponse identique avec et sans parametre").toBe(plain.html.text);
  });

  it("AC3 : etat vide explicite si l'utilisateur n'a aucune organisation, formulaire de creation present", async () => {
    const lonely = await signUp();

    const full = await getFullPage("/organisations", lonely);

    expectFullStatus(full, 200, "AC3 : etat vide");
    expect(organizationIdsOf(full.html.text)).toEqual([]);
    expect(hasTestId(full.html.text, "empty-organizations"), "marqueur d'etat vide").toBe(true);
    expect(hasTestId(full.html.text, "create-organization-form")).toBe(true);
  });
});

describe("AC4 : vue de l'owner", () => {
  it("AC4 : nom, collections (ordre de listCollections), membres (ordre de listMembers, role), bloc Palier (Free, active) et formulaire d'invitation", async () => {
    const org = await createOrganizationFixture(uniqueOrgName("AC4"));
    const member = await signUpAndJoin(fakes, org);
    const collectionNames = ["Veille-Test-A", "Veille-Test-B", "Veille-Test-C"].map((n) => `${n}-${Date.now()}`);
    for (const name of collectionNames) await createCollectionViaApi(org.owner, org.organizationId, name);
    const expectedCollectionIds = idsOf(expectList(await getCollections(org.owner, org.organizationId), "listCollections"));
    const expectedMembers = recordsOf(await getMembers(org.owner, org.organizationId), "listMembers");

    const full = await getFullPage(`/organisations/${org.organizationId}`, org.owner);

    expectFullStatus(full, 200, "AC4 : page de l'organisation (owner)");
    expect(textOf(full.html.text)).toContain(org.name);
    expect(collectionIdsOf(full.html.text, org.organizationId), "collections dans l'ordre de la lecture").toEqual(expectedCollectionIds);
    const collectionRows = rowsOf(full.html.text, "collection-row").map((row) => textOf(row));
    expect(collectionRows).toHaveLength(3);
    expect(collectionRows.every((row) => collectionNames.some((name) => row.includes(name)))).toBe(true);
    const memberRows = rowsOf(full.html.text, "member-row").map((row) => textOf(row));
    expect(memberRows, "membres dans l'ordre de la lecture").toHaveLength(expectedMembers.length);
    expectedMembers.forEach((expected, index) => {
      expect(memberRows[index], `membre ${index}`).toContain(String(expected.email));
      expect(memberRows[index], `role du membre ${index}`).toContain(String(expected.role));
    });
    expect(String(expectedMembers[1]?.userId)).toBe(member.userId);
    expect(hasTestId(full.html.text, "subscription-block"), "bloc Palier").toBe(true);
    expect(hasTestId(full.html.text, "invite-form"), "formulaire d'invitation").toBe(true);
    expect(hasTestId(full.html.text, "create-collection-form")).toBe(true);
    const text = textOf(full.html.text);
    expect(text).toContain("Palier");
    expect(text).toContain("Free");
    expect(text).toContain("active");
  });

  it("AC4 : etat vide : une organisation sans collection l'indique explicitement", async () => {
    const org = await createOrganizationFixture(uniqueOrgName("AC4-vide"));

    const full = await getFullPage(`/organisations/${org.organizationId}`, org.owner);

    expectFullStatus(full, 200, "AC4 : organisation sans collection");
    expect(collectionIdsOf(full.html.text, org.organizationId)).toEqual([]);
    expect(hasTestId(full.html.text, "empty-collections")).toBe(true);
  });

  it("AC4 : un identifiant en majuscules dans le chemin designe la meme organisation", async () => {
    const org = await createOrganizationFixture(uniqueOrgName("AC4-maj"));

    const upper = await getFullPage(`/organisations/${org.organizationId.toUpperCase()}`, org.owner);

    expectFullStatus(upper, 200, "AC4 : chemin en majuscules");
    expect(textOf(upper.html.text)).toContain(org.name);
  });
});

describe("AC5 : vue du member (invitation reelle)", () => {
  async function ownerAndMemberPages(): Promise<{
    org: OrganizationFixture;
    asOwner: Awaited<ReturnType<typeof getFullPage>>;
    asMember: Awaited<ReturnType<typeof getFullPage>>;
    memberSession: Awaited<ReturnType<typeof signUpAndJoin>>;
  }> {
    const org = await createOrganizationFixture(uniqueOrgName("AC5"));
    const memberSession = await signUpAndJoin(fakes, org);
    for (const name of ["Collection-Test-1", "Collection-Test-2"]) await createCollectionViaApi(org.owner, org.organizationId, `${name}-${Date.now()}`);
    const asOwner = await getFullPage(`/organisations/${org.organizationId}`, org.owner);
    const asMember = await getFullPage(`/organisations/${org.organizationId}`, memberSession);
    return { org, asOwner, asMember, memberSession };
  }

  it("AC5 : le member voit nom, collections et membres identiques a ceux de l'owner", async () => {
    const { org, asOwner, asMember } = await ownerAndMemberPages();

    expectFullStatus(asMember, 200, "AC5 : page de l'organisation (member)");
    expect(textOf(asMember.html.text)).toContain(org.name);
    expect(collectionIdsOf(asMember.html.text, org.organizationId)).toEqual(collectionIdsOf(asOwner.html.text, org.organizationId));
    expect(collectionIdsOf(asMember.html.text, org.organizationId)).toHaveLength(2);
    expect(rowsOf(asMember.html.text, "member-row").map(textOf)).toEqual(rowsOf(asOwner.html.text, "member-row").map(textOf));
    expect(rowsOf(asMember.html.text, "member-row")).toHaveLength(2);
    expect(hasTestId(asMember.html.text, "create-collection-form"), "un member cree des collections").toBe(true);
  });

  it("AC5 : la reponse complete du member ne contient ni le bloc Palier, ni le formulaire d'invitation, ni leurs marqueurs, ni les cles de l'abonnement", async () => {
    const { asOwner, asMember } = await ownerAndMemberPages();

    expect(hasTestId(asOwner.html.text, "subscription-block"), "precondition : l'owner voit le bloc").toBe(true);
    for (const { label, text } of [
      { label: "HTML", text: asMember.html.text },
      { label: "charge RSC", text: asMember.rsc.text },
    ]) {
      expect(text, `${label} : marqueur du bloc Palier`).not.toContain("subscription-block");
      expect(text, `${label} : marqueur du formulaire d'invitation`).not.toContain("invite-form");
      expect(text, `${label} : libelle Palier`).not.toContain("Palier");
      expect(text, `${label} : libelle du formulaire d'invitation`).not.toMatch(/Inviter/);
      expect(text, `${label} : cle de l'abonnement`).not.toMatch(/(?:"|\\")(?:tier|status|cancelAtPeriodEnd|currentPeriodEnd)(?:"|\\")\s*:/);
      expect(text, `${label} : cancelAtPeriodEnd`).not.toContain("cancelAtPeriodEnd");
      expect(text, `${label} : currentPeriodEnd`).not.toContain("currentPeriodEnd");
    }
  });

  it("AC5 : ?role=owner (et tout autre parametre) ne change rien : reponse identique a celle sans parametre", async () => {
    const { org, asMember, memberSession } = await ownerAndMemberPages();

    for (const query of ["?role=owner", "?role=owner&tier=pro", "?owner=1", "?subscription=1"]) {
      const tampered = await getFullPage(`/organisations/${org.organizationId}${query}`, memberSession);
      expectFullStatus(tampered, 200, `AC5 : ${query}`);
      expect(tampered.html.text, `HTML identique avec ${query}`).toBe(asMember.html.text);
      expect(tampered.rsc.text, `charge RSC identique avec ${query}`).toBe(asMember.rsc.text);
      expect(hasTestId(tampered.html.text, "invite-form")).toBe(false);
    }
  });
});

describe("AC12 : parcours reel d'invitation et d'acceptation", () => {
  it("AC12 : apres invitation (003) et acceptation (006) par les vraies routes, /organisations de l'invite liste l'organisation et sa page montre la vue member", async () => {
    const org = await createOrganizationFixture(uniqueOrgName("AC12"));
    const invited = await signUpAndJoin(fakes, org);

    const list = await getFullPage("/organisations", invited);
    const page = await getFullPage(`/organisations/${org.organizationId}`, invited);

    expectFullStatus(list, 200, "AC12 : /organisations de l'invite");
    expect(organizationIdsOf(list.html.text)).toEqual([org.organizationId]);
    expect(textOf(list.html.text)).toContain(org.name);
    expectFullStatus(page, 200, "AC12 : page de l'organisation de l'invite");
    const roles = rowsOf(page.html.text, "member-row").map(textOf);
    expect(roles.find((row) => row.includes(invited.email))).toContain("member");
    expect(roles.find((row) => row.includes(org.owner.email))).toContain("owner");
    expect(hasTestId(page.html.text, "subscription-block")).toBe(false);
    expect(hasTestId(page.html.text, "invite-form")).toBe(false);
  });
});
