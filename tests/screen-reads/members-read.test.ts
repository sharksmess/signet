/**
 * Tranche 013 — `GET /api/organizations/:organizationId/members` (contrat
 * `listMembers`) : AC5 (lecture nominale), AC6 (ordre), AC7 (session,
 * validation, ordre des erreurs), AC9 (invitation en attente).
 *
 * Les members d'AC5, AC6 (ordre d'arrivee) et AC9 viennent du parcours
 * d'invitation reel (003 puis 006). L'ordre a date d'arrivee egale est force en
 * base (administration, une seule transaction).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { listMembers } from "../../docs/02-architecture/api-contracts/members";
import { signUp } from "../helpers/auth";
import { expectError, expectStatus } from "../helpers/billing";
import { closeAllPools } from "../helpers/db";
import { createOrganizationFixture } from "../helpers/fixtures";
import { resetInvitationFakes, startInvitationFakes, stopInvitationFakes, type InvitationFakes, inviteeEmail } from "../helpers/invitations";
import { issueInvitation, postAccept, signUpWithEmail } from "../helpers/invitations-accept";
import { expectExactKeys, getCollections, messageFrom } from "../helpers/consultation";
import { expectCleanErrorBody } from "../helpers/links";
import {
  expectTiedPrecondition,
  fieldOf,
  getMembers,
  getMembersWithCookie,
  INVALID_COOKIE,
  INVALID_ORGANIZATION_ID_MESSAGE,
  insertTiedMembers,
  joinByInvitation,
  MALFORMED_IDS,
  readMembersWithEmail,
  recordsOf,
  signUpAndJoin,
  signUpUsersForTie,
} from "../helpers/screen-reads";

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

describe("AC5 — lecture nominale par l'owner et par un member", () => {
  it("AC5 : l'owner et un member (invitation acceptee) obtiennent 200 et la meme liste, qui contient l'appelant, avec roles et adresses enregistres", async () => {
    const org = await createOrganizationFixture("AC5 nominal");
    const member = await signUpAndJoin(fakes, org);

    const asOwner = await getMembers(org.owner, org.organizationId);
    const asMember = await getMembers(member, org.organizationId);

    const ownerItems = recordsOf(asOwner, "owner : GET members");
    const memberItems = recordsOf(asMember, "member : GET members");
    expect(memberItems, "la meme liste pour les deux appelants").toEqual(ownerItems);
    expect(asMember.text).toBe(asOwner.text);
    expectExactKeys(ownerItems, ["userId", "email", "role"], "AC5");
    expect(listMembers.output.safeParse(ownerItems).success, `conforme a listMembers.output : ${asOwner.text}`).toBe(true);
    expect(ownerItems).toEqual([
      { userId: org.owner.userId, email: org.owner.email, role: "owner" },
      { userId: member.userId, email: member.email, role: "member" },
    ]);
    const recorded = await readMembersWithEmail(org.organizationId);
    expect(ownerItems).toEqual(recorded.map((row) => ({ userId: row.user_id, email: row.email, role: row.role })));
  });

  it("AC5 : un organizationId en majuscules dans le chemin designe la meme organisation", async () => {
    const org = await createOrganizationFixture("AC5 majuscules");
    const lower = await getMembers(org.owner, org.organizationId);

    const upper = await getMembers(org.owner, org.organizationId.toUpperCase());

    expect(recordsOf(upper, "chemin en majuscules")).toEqual(recordsOf(lower, "chemin en minuscules"));
    expect(upper.text).toBe(lower.text);
    expect(recordsOf(upper, "chemin en majuscules")).toHaveLength(1);
  });

  it("AC5 : un owner seul voit exactement lui-meme (la liste contient toujours l'appelant)", async () => {
    const org = await createOrganizationFixture("AC5 seul");

    const items = recordsOf(await getMembers(org.owner, org.organizationId), "owner seul");

    expect(items).toEqual([{ userId: org.owner.userId, email: org.owner.email, role: "owner" }]);
  });
});

describe("AC6 — ordre (D-138 point 3)", () => {
  it("AC6 : date d'arrivee croissante, le fondateur en premier, meme si l'identifiant du dernier arrive est plus petit", async () => {
    const org = await createOrganizationFixture("AC6 arrivees");
    // m2 s'inscrit AVANT m1 (identifiant plus petit), mais m1 rejoint en premier.
    const m2 = await signUp();
    const m1 = await signUp();
    expect(m2.userId < m1.userId, "precondition : l'identifiant de m2 est inferieur a celui de m1").toBe(true);
    await joinByInvitation(fakes, org, m1);
    await joinByInvitation(fakes, org, m2);

    const items = recordsOf(await getMembers(m2, org.organizationId), "GET members");

    expect(fieldOf(items, "userId")).toEqual([org.owner.userId, m1.userId, m2.userId]);
    expect(fieldOf(items, "role")).toEqual(["owner", "member", "member"]);
  });

  it("AC6 : a date d'arrivee egale (meme transaction) -> user_id croissant, apres le fondateur, quel que soit l'ordre d'insertion", async () => {
    const org = await createOrganizationFixture("AC6 egalite");
    const tie = await signUpUsersForTie();
    const tied = await insertTiedMembers(org.organizationId, tie.insertionOrder);
    expectTiedPrecondition(tied, "membres");
    const [anyTied] = tie.sessions;
    if (!anyTied) throw new Error("signUpUsersForTie n'a rendu aucune session");

    const asOwner = recordsOf(await getMembers(org.owner, org.organizationId), "owner");
    const asTied = recordsOf(await getMembers(anyTied, org.organizationId), "membre ex aequo");

    expect(fieldOf(asOwner, "userId")).toEqual([org.owner.userId, ...tie.ascending]);
    expect(asTied).toEqual(asOwner);
  });

  it("AC6 : une chaine de requete (?sort=desc, ?order=email) ne change rien", async () => {
    const org = await createOrganizationFixture("AC6 chaine de requete");
    const tie = await signUpUsersForTie();
    await insertTiedMembers(org.organizationId, tie.insertionOrder);
    const plain = await getMembers(org.owner, org.organizationId);
    expect(recordsOf(plain, "sans requete"), "precondition : cinq membres").toHaveLength(5);

    for (const query of ["?sort=desc", "?order=email", "?sort=desc&limit=1&userId=" + tie.ascending[0]]) {
      const result = await getMembers(org.owner, org.organizationId, query);

      expect(result.status, query).toBe(200);
      expect(result.text, query).toBe(plain.text);
    }
  });
});

describe("AC7 — session, validation et ordre des erreurs", () => {
  it("AC7 : sans cookie -> 401 UNAUTHENTICATED, meme avec un chemin valide, inexistant ou malforme", async () => {
    const org = await createOrganizationFixture("AC7 sans session");
    const reference = await getMembers(null, org.organizationId);

    expectError(reference, 401, "UNAUTHENTICATED", "chemin valide");
    expect(Object.keys(reference.body as object).sort()).toEqual(["code", "message"]);
    expect(reference.text, "meme corps que le 401 commun").toBe((await getCollections(null, org.organizationId)).text);
    for (const path of [randomUUID(), ...MALFORMED_IDS]) {
      const result = await getMembers(null, path);

      expectError(result, 401, "UNAUTHENTICATED", `sans session, chemin ${path}`);
      expect(result.text, `le 401 ne revele rien du chemin ${path}`).toBe(reference.text);
    }
  });

  it("AC7 : cookie invalide -> 401 UNAUTHENTICATED quelle que soit la validite du chemin", async () => {
    const org = await createOrganizationFixture("AC7 cookie invalide");

    for (const path of [org.organizationId, randomUUID(), ...MALFORMED_IDS]) {
      expectError(await getMembersWithCookie(path, INVALID_COOKIE), 401, "UNAUTHENTICATED", `cookie invalide, chemin ${path}`);
    }
  });

  it("AC7 : identifiant malforme avec session -> 422 VALIDATION_FAILED, message fixe « Identifiant d'organisation invalide. », sans la valeur soumise ni Zod", async () => {
    const org = await createOrganizationFixture("AC7 malforme");

    for (const bad of MALFORMED_IDS) {
      const result = await getMembers(org.owner, bad);

      expectError(result, 422, "VALIDATION_FAILED", `organisation ${JSON.stringify(bad)}`);
      expect(messageFrom(result)).toBe(INVALID_ORGANIZATION_ID_MESSAGE);
      expect(Object.keys(result.body as object).sort()).toEqual(["code", "message"]);
      expectCleanErrorBody(result, `malforme ${bad}`, [bad, org.organizationId]);
    }
  });

  it("AC7 : session, organisation d'autrui ou inexistante et chemin malforme -> 422 (la validation passe avant l'appartenance), corps identiques", async () => {
    const a = await createOrganizationFixture("AC7 A");
    const b = await createOrganizationFixture("AC7 B");

    const foreign = await getMembers(b.owner, a.organizationId.slice(0, -1) + "g");
    const unknown = await getMembers(b.owner, "pas-un-uuid");

    expectError(foreign, 422, "VALIDATION_FAILED", "malforme proche de l'organisation d'autrui");
    expectError(unknown, 422, "VALIDATION_FAILED", "malforme quelconque");
    expect(foreign.text).toBe(unknown.text);
  });

  it("AC7 : session et UUID inconnu -> 404 ORGANIZATION_NOT_FOUND, corps sans identifiant", async () => {
    const org = await createOrganizationFixture("AC7 inconnu");
    const missing = randomUUID();

    const result = await getMembers(org.owner, missing);

    expectError(result, 404, "ORGANIZATION_NOT_FOUND", "UUID inconnu");
    expectCleanErrorBody(result, "404", [missing, org.organizationId, org.owner.email]);
  });

  it("AC7 : ordre prouve 401 < 422 < 404 sur une meme requete de chemin malforme ou inconnu", async () => {
    const org = await createOrganizationFixture("AC7 ordre");

    expectError(await getMembers(null, "pas-un-uuid"), 401, "UNAUTHENTICATED", "sans session, malforme");
    expectError(await getMembers(org.owner, "pas-un-uuid"), 422, "VALIDATION_FAILED", "session, malforme");
    expectError(await getMembers(org.owner, randomUUID()), 404, "ORGANIZATION_NOT_FOUND", "session, UUID inconnu");
  });
});

describe("AC9 — invitation en attente", () => {
  it("AC9 : une invitation emise et non acceptee (compte inscrit ou non) n'ajoute aucun element ; apres acceptation, l'invite apparait en dernier avec role member", async () => {
    const org = await createOrganizationFixture("AC9 invitations");
    const registered = await signUp();
    const pendingRegistered = await issueInvitation(fakes, { org, email: registered.email, label: "AC9 compte inscrit" });
    const unregisteredEmail = inviteeEmail();
    const pendingUnregistered = await issueInvitation(fakes, { org, email: unregisteredEmail, label: "AC9 compte non inscrit" });
    expect(pendingRegistered.row.accepted_at, "precondition : invitation en attente").toBeNull();
    expect(pendingUnregistered.row.accepted_at, "precondition : invitation en attente").toBeNull();

    const pending = recordsOf(await getMembers(org.owner, org.organizationId), "avec invitations en attente");

    expect(pending).toEqual([{ userId: org.owner.userId, email: org.owner.email, role: "owner" }]);
    expect(JSON.stringify(pending)).not.toContain(unregisteredEmail);

    expectStatus(await postAccept(registered, { token: pendingRegistered.token }), 200, "acceptation du compte inscrit");
    const lateComer = await signUpWithEmail(unregisteredEmail);
    expectStatus(await postAccept(lateComer, { token: pendingUnregistered.token }), 200, "acceptation du compte inscrit apres coup");

    const accepted = recordsOf(await getMembers(org.owner, org.organizationId), "apres acceptations");
    expect(accepted).toEqual([
      { userId: org.owner.userId, email: org.owner.email, role: "owner" },
      { userId: registered.userId, email: registered.email, role: "member" },
      { userId: lateComer.userId, email: lateComer.email, role: "member" },
    ]);
  });
});
