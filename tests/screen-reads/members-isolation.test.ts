/**
 * Tranche 013 — AC8 : isolation tenant de `GET .../members` (US-07.1, US-09).
 *  (a) non membre -> 404 strictement identique a l'organisation inexistante ;
 *  (b) membre de A et de B : le chemin fait autorite, aucune adresse de l'autre ;
 *  (c) en base, sous signet_app avec contexte etranger force, zero ligne.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { signUp } from "../helpers/auth";
import { expectError } from "../helpers/billing";
import { asTenant, closeAllPools } from "../helpers/db";
import { addMemberDirect, createOrganizationFixture } from "../helpers/fixtures";
import { resetInvitationFakes, startInvitationFakes, stopInvitationFakes, type InvitationFakes } from "../helpers/invitations";
import { expectCleanErrorBody } from "../helpers/links";
import { fieldOf, getMembers, joinByInvitation, readMembersWithEmail, recordsOf } from "../helpers/screen-reads";

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

describe("AC8 (a) — non membre", () => {
  it("AC8 (a) : l'owner de B lit les membres de A -> 404 ORGANIZATION_NOT_FOUND, corps strictement identique a celui d'un UUID inexistant", async () => {
    const a = await createOrganizationFixture("AC8a A");
    const b = await createOrganizationFixture("AC8a B");
    const stranger = await signUp();
    expect(recordsOf(await getMembers(a.owner, a.organizationId), "precondition : l'owner de A lit A"), "precondition : A a un membre").toHaveLength(1);

    const foreign = await getMembers(b.owner, a.organizationId);
    const unknown = await getMembers(b.owner, randomUUID());
    const withoutOrganization = await getMembers(stranger, a.organizationId);

    expectError(foreign, 404, "ORGANIZATION_NOT_FOUND", "owner de B vers A");
    expectError(unknown, 404, "ORGANIZATION_NOT_FOUND", "UUID inexistant");
    expectError(withoutOrganization, 404, "ORGANIZATION_NOT_FOUND", "utilisateur sans organisation vers A");
    expect(foreign.text, "corps strictement identique").toBe(unknown.text);
    expect(withoutOrganization.text).toBe(unknown.text);
    expectCleanErrorBody(foreign, "404 d'autrui", [a.organizationId, a.owner.email, a.owner.userId]);
  });

  it("AC8 (a) : un member de B (non owner) lit les membres de A -> le meme 404", async () => {
    const a = await createOrganizationFixture("AC8a member A");
    const b = await createOrganizationFixture("AC8a member B");
    const memberOfB = await signUp();
    await joinByInvitation(fakes, b, memberOfB);

    const result = await getMembers(memberOfB, a.organizationId);

    expectError(result, 404, "ORGANIZATION_NOT_FOUND", "member de B vers A");
    expect(result.text).toBe((await getMembers(memberOfB, randomUUID())).text);
  });
});

describe("AC8 (b) — membre de A et de B : le chemin fait autorite (D-132 point 5)", () => {
  it("AC8 (b) : sous le chemin de A, aucune adresse d'un membre de B non membre de A, et inversement", async () => {
    const a = await createOrganizationFixture("AC8b A");
    const b = await createOrganizationFixture("AC8b B");
    const both = await signUp();
    await joinByInvitation(fakes, a, both);
    await joinByInvitation(fakes, b, both);
    const onlyA = await signUp();
    const onlyB = await signUp();
    await addMemberDirect({ organizationId: a.organizationId, userId: onlyA.userId, role: "member" });
    await addMemberDirect({ organizationId: b.organizationId, userId: onlyB.userId, role: "member" });

    for (const caller of [both, a.owner, onlyA]) {
      const listA = recordsOf(await getMembers(caller, a.organizationId), "chemin de A");
      expect(fieldOf(listA, "email").sort(), "exactement les adresses de A").toEqual([a.owner.email, both.email, onlyA.email].sort());
      for (const foreign of [b.owner.email, onlyB.email]) {
        expect(JSON.stringify(listA), `${foreign} n'est pas membre de A`).not.toContain(foreign);
      }
    }
    for (const caller of [both, b.owner, onlyB]) {
      const listB = recordsOf(await getMembers(caller, b.organizationId), "chemin de B");
      expect(fieldOf(listB, "email").sort(), "exactement les adresses de B").toEqual([b.owner.email, both.email, onlyB.email].sort());
      for (const foreign of [a.owner.email, onlyA.email]) {
        expect(JSON.stringify(listB), `${foreign} n'est pas membre de B`).not.toContain(foreign);
      }
    }
    // Le membre d'une seule organisation ne lit pas l'autre.
    expectError(await getMembers(onlyA, b.organizationId), 404, "ORGANIZATION_NOT_FOUND", "membre de A seul vers B");
    expectError(await getMembers(onlyB, a.organizationId), 404, "ORGANIZATION_NOT_FOUND", "membre de B seul vers A");
  });
});

describe("AC8 (c) — contexte etranger force en base (signet_app)", () => {
  it("AC8 (c) : app.user_id = owner de B, app.organization_id = A -> member de A et app_user des membres de A : zero ligne", async () => {
    const a = await createOrganizationFixture("AC8c A");
    const b = await createOrganizationFixture("AC8c B");
    const memberOfA = await signUp();
    await addMemberDirect({ organizationId: a.organizationId, userId: memberOfA.userId, role: "member" });
    const membersOfA = await readMembersWithEmail(a.organizationId);
    const userIdsOfA = membersOfA.map((row) => row.user_id);
    expect(userIdsOfA.sort(), "precondition : A a deux membres").toEqual([a.owner.userId, memberOfA.userId].sort());

    const own = await asTenant({ userId: a.owner.userId, organizationId: a.organizationId }, async (client) => {
      const members = await client.query("SELECT user_id FROM member WHERE organization_id = $1", [a.organizationId]);
      const users = await client.query("SELECT id FROM app_user WHERE id = ANY($1::uuid[])", [userIdsOfA]);
      return { members: members.rowCount, users: users.rowCount };
    });
    expect(own, "controle : le contexte legitime voit les lignes (le test n'est pas vide)").toEqual({ members: 2, users: 2 });

    const foreign = await asTenant({ userId: b.owner.userId, organizationId: a.organizationId }, async (client) => {
      const members = await client.query("SELECT user_id FROM member WHERE organization_id = $1", [a.organizationId]);
      const users = await client.query("SELECT id, email FROM app_user WHERE id = ANY($1::uuid[])", [userIdsOfA]);
      const joined = await client.query(
        "SELECT m.user_id, u.email FROM member m JOIN app_user u ON u.id = m.user_id WHERE m.organization_id = $1",
        [a.organizationId],
      );
      return { members: members.rowCount, users: users.rowCount, joined: joined.rowCount };
    });

    expect(foreign).toEqual({ members: 0, users: 0, joined: 0 });
  });
});
