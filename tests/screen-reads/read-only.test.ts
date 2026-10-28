/**
 * Tranche 013 — AC10 (lecture seule prouvee) et AC11 (non-regression du
 * `POST /api/organizations`, ajoute a cote du nouveau `GET` sur la meme route).
 *
 * AC10 : apres une serie de lectures (succes et chaque cas d'erreur d'AC1, AC4,
 * AC7, AC8), les lignes completes de `organization`, `member`, `app_user` et
 * `invitation` sont inchangees. La partie « aucun privilege, aucune politique,
 * aucune fonction SECURITY DEFINER nouveaux » est portee par les tests de
 * catalogue existants et les listes fermees de D-121, qui doivent rester verts
 * sans modification : rien n'est reecrit ici.
 * AC11 : l'assertion de fond est `tests/organizations/**`, inchangee ; le test
 * ci-dessous verifie seulement que POST et GET coexistent sur la route.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { signUp } from "../helpers/auth";
import { expectError } from "../helpers/billing";
import { asBypassRls, closeAllPools } from "../helpers/db";
import { createOrganizationFixture } from "../helpers/fixtures";
import { createOrganization } from "../helpers/organizationsApi";
import { issueInvitation } from "../helpers/invitations-accept";
import { resetInvitationFakes, startInvitationFakes, stopInvitationFakes, type InvitationFakes } from "../helpers/invitations";
import { expectExactKeys } from "../helpers/consultation";
import {
  fieldOf,
  getMembers,
  getMembersWithCookie,
  getMyOrganizations,
  getMyOrganizationsWithCookie,
  INVALID_COOKIE,
  joinByInvitation,
  recordsOf,
  snapshotTables,
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

describe("AC10 — lecture seule", () => {
  it("AC10 : une serie de lectures (succes et erreurs) laisse organization, member, app_user et invitation inchanges, pour l'organisation lue et celle de l'appelant etranger", async () => {
    const a = await createOrganizationFixture("AC10 A");
    const b = await createOrganizationFixture("AC10 B");
    const member = await signUp();
    await joinByInvitation(fakes, a, member);
    // Une invitation en attente dans A : la table invitation n'est pas vide.
    await issueInvitation(fakes, { org: a, label: "AC10 en attente" });
    const organizationIds = [a.organizationId, b.organizationId];
    const userIds = [a.owner.userId, b.owner.userId, member.userId];
    const before = await snapshotTables({ organizationIds, userIds });
    expect(before.organization, "precondition : deux organisations").toHaveLength(2);
    expect(before.member, "precondition : trois lignes member").toHaveLength(3);
    expect(before.app_user, "precondition : trois utilisateurs").toHaveLength(3);
    expect(before.invitation.length, "precondition : les invitations de A existent").toBeGreaterThanOrEqual(2);

    // Succes
    recordsOf(await getMyOrganizations(a.owner), "owner de A : mes organisations");
    recordsOf(await getMyOrganizations(member, { query: `?userId=${b.owner.userId}` }), "member : mes organisations, parametre ignore");
    recordsOf(await getMembers(a.owner, a.organizationId), "owner : membres");
    recordsOf(await getMembers(member, a.organizationId.toUpperCase(), "?sort=desc"), "member : membres");
    // AC1
    expectError(await getMyOrganizations(null), 401, "UNAUTHENTICATED", "organisations sans session");
    expectError(await getMyOrganizationsWithCookie(INVALID_COOKIE), 401, "UNAUTHENTICATED", "organisations, cookie invalide");
    // AC7
    expectError(await getMembers(null, a.organizationId), 401, "UNAUTHENTICATED", "membres sans session");
    expectError(await getMembersWithCookie(a.organizationId, INVALID_COOKIE), 401, "UNAUTHENTICATED", "membres, cookie invalide");
    expectError(await getMembers(null, "pas-un-uuid"), 401, "UNAUTHENTICATED", "membres sans session, malforme");
    expectError(await getMembers(a.owner, "pas-un-uuid"), 422, "VALIDATION_FAILED", "membres, malforme");
    expectError(await getMembers(a.owner, randomUUID()), 404, "ORGANIZATION_NOT_FOUND", "membres, organisation inexistante");
    // AC8
    expectError(await getMembers(b.owner, a.organizationId), 404, "ORGANIZATION_NOT_FOUND", "owner de B vers A");
    expectError(await getMembers(a.owner, b.organizationId), 404, "ORGANIZATION_NOT_FOUND", "owner de A vers B");

    expect(await snapshotTables({ organizationIds, userIds }), "lignes completes inchangees").toEqual(before);
  });

  it("AC10 : lire la liste des organisations d'un utilisateur sans organisation ne cree ni organisation ni member", async () => {
    const lonely = await signUp();
    const before = await snapshotTables({ organizationIds: [], userIds: [lonely.userId] });
    const memberRowsBefore = await memberRowsOf(lonely.userId);

    expect(recordsOf(await getMyOrganizations(lonely), "liste vide")).toEqual([]);

    expect(await snapshotTables({ organizationIds: [], userIds: [lonely.userId] })).toEqual(before);
    expect(await memberRowsOf(lonely.userId), "aucune ligne member creee").toEqual(memberRowsBefore);
    expect(memberRowsBefore).toEqual([]);
  });
});

async function memberRowsOf(userId: string): Promise<unknown[]> {
  return asBypassRls(async (client) => {
    const { rows } = await client.query<{ row: unknown }>("SELECT to_jsonb(m) AS row FROM member m WHERE m.user_id = $1 ORDER BY m.id", [userId]);
    return rows;
  });
}

describe("AC11 — non-regression du POST /api/organizations a cote du GET", () => {
  it("AC11 : POST rend toujours 201 { id, name, slug, createdAt, role: owner }, cree l'organisation et son owner, et la liste GET la rend ensuite", async () => {
    const user = await signUp();

    const created = await createOrganization(user, { name: "AC11 Organisation creee" });

    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expectExactKeys([created.body], ["id", "name", "slug", "createdAt", "role"], "AC11 POST");
    const body = created.body as { id: string; name: string; role: string };
    expect(body.name).toBe("AC11 Organisation creee");
    expect(body.role).toBe("owner");
    const roles = await asBypassRls(async (client) => {
      const { rows } = await client.query<{ role: string; user_id: string }>("SELECT role, user_id FROM member WHERE organization_id = $1", [body.id]);
      return rows;
    });
    expect(roles).toEqual([{ role: "owner", user_id: user.userId }]);
    expect(fieldOf(recordsOf(await getMyOrganizations(user), "GET apres POST"), "id")).toEqual([body.id]);
    const anonymous = await createOrganization(null, { name: "AC11 sans session" });
    expect(anonymous.status, JSON.stringify(anonymous.body)).toBe(401);
    expect(anonymous.body).toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
