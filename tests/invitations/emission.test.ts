/**
 * Tranche 003 — emission d'une invitation par la route
 * `POST /api/organizations/:organizationId/invitations` :
 * AC1, AC5 (a), AC6 (API), AC7, AC8, AC9, AC12, AC13.
 *
 * Chaine exercee de bout en bout : session reelle, serveur de test, base de
 * test reelle sous `signet_app`, faux point d'evenements Inngest (002). Les
 * verifications en base (boite blanche) passent par la connexion
 * d'administration et sont filtrees par organisation ou adresse uniques.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { closeAllPools } from "../helpers/db";
import { signUp } from "../helpers/auth";
import { addMemberDirect, createOrganizationFixture, createTwoOrganizationsFixture } from "../helpers/fixtures";
import { bodyField, expectError, expectStatus, codeOf, uniqueId } from "../helpers/billing";
import {
  INVITATION_EVENT,
  eventsForEmail,
  eventsOfInvitation,
  inviteeEmail,
  postInvitation,
  resetInvitationFakes,
  startInvitationFakes,
  stopInvitationFakes,
  type InvitationFakes,
} from "../helpers/invitations";
import {
  SEVEN_DAYS_SECONDS,
  expireInvitationDirect,
  insertInvitationDirect,
  readInvitationById,
  readInvitations,
  readSingleInvitation,
} from "../helpers/invitations-db";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function idOf(result: { body: unknown; text: string }): string {
  const id = (result.body as { id?: unknown } | undefined)?.id;
  if (typeof id !== "string") throw new Error(`reponse sans champ "id". Corps brut : ${result.text}`);
  return id;
}

describe("AC1 — emission nominale (US-02.1)", () => {
  it("AC1 : POST { email } par l'owner -> 201, une ligne conforme (member, 7 jours exactement, jeton hache), un seul evenement dont l'id est celui de l'invitation", async () => {
    const org = await createOrganizationFixture("AC1 emission");
    const email = inviteeEmail();

    const result = await postInvitation(org.owner, org.organizationId, { email });

    expectStatus(result, 201, "POST invitation nominal");
    expect(Object.keys(result.body as object).sort()).toEqual(["email", "expiresAt", "id", "organizationId"]);
    expect(result.body).toMatchObject({ organizationId: org.organizationId, email });
    const id = idOf(result);
    expect(id).toMatch(UUID);

    const row = await readSingleInvitation(org.organizationId, email);
    expect(row).toMatchObject({
      id,
      organization_id: org.organizationId,
      role: "member",
      invited_by_user_id: org.owner.userId,
      accepted_at: null,
      accepted_by_user_id: null,
    });
    expect(row.token_hash.length, "empreinte SHA-256 : 32 octets").toBe(32);
    expect(row.lifetime_seconds, "expires_at - created_at = 7 jours exactement").toBe(SEVEN_DAYS_SECONDS);
    expect(new Date(String(bodyField(result, "expiresAt"))).getTime(), "expiresAt de la reponse = expires_at en base").toBe(
      row.expires_at.getTime(),
    );

    const events = eventsOfInvitation(fakes.inngest, id);
    expect(events, `un seul evenement ${INVITATION_EVENT} ; corps recus : ${JSON.stringify(fakes.inngest.rawBodies)}`).toHaveLength(1);
    expect(events[0]?.id, "id de l'evenement = id de l'invitation (deduplication)").toBe(id);
    expect(events[0]?.name).toBe(INVITATION_EVENT);
    expect(Object.keys(events[0]?.data ?? {}).sort()).toEqual([
      "email",
      "invitationId",
      "organizationId",
      "organizationName",
      "sealedToken",
    ]);
    expect(events[0]?.data).toMatchObject({
      invitationId: id,
      organizationId: org.organizationId,
      email,
      organizationName: org.name,
    });
    const sealed = events[0]?.data.sealedToken;
    expect(typeof sealed).toBe("string");
    expect(sealed, "base64url").toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(String(sealed), "base64url").length, "iv 12 + chiffre >= 32 + etiquette 16").toBeGreaterThanOrEqual(60);
  });
});

describe("AC5 (a) — isolation tenant par l'API (US-09)", () => {
  it("AC5 (a) : l'owner de A invite sur l'organisation B -> 404 ORGANIZATION_NOT_FOUND, corps identique a celui d'un UUID inexistant, aucune ligne, aucun evenement", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const email = inviteeEmail();

    const foreign = await postInvitation(orgA.owner, orgB.organizationId, { email });
    const unknown = await postInvitation(orgA.owner, randomUUID(), { email });

    expectError(foreign, 404, "ORGANIZATION_NOT_FOUND", "POST sur l'organisation d'un autre tenant");
    expectError(unknown, 404, "ORGANIZATION_NOT_FOUND", "POST sur un UUID inexistant");
    expect(foreign.body, "reponses indistinguables").toEqual(unknown.body);
    expect(await readInvitations(orgB.organizationId, email)).toEqual([]);
    expect(eventsForEmail(fakes.inngest, email)).toEqual([]);

    const witness = await postInvitation(orgB.owner, orgB.organizationId, { email });
    expectStatus(witness, 201, "temoin : l'owner de B peut inviter chez lui");
  });

  it("AC5 (a) : un utilisateur sans aucune organisation recoit le meme 404", async () => {
    const org = await createOrganizationFixture("AC5 a etranger");
    const stranger = await signUp();
    const email = inviteeEmail();

    const result = await postInvitation(stranger, org.organizationId, { email });

    expectError(result, 404, "ORGANIZATION_NOT_FOUND", "POST par un non-membre");
    expect(await readInvitations(org.organizationId, email)).toEqual([]);
    expect(eventsForEmail(fakes.inngest, email)).toEqual([]);
  });
});

describe("AC6 (API) — permission insuffisante (US-02.2)", () => {
  it("AC6 : un member recoit 403 INSUFFICIENT_ROLE, aucune ligne, aucun evenement", async () => {
    const org = await createOrganizationFixture("AC6 member");
    const member = await signUp();
    await addMemberDirect({ organizationId: org.organizationId, userId: member.userId, role: "member" });
    const email = inviteeEmail();

    const result = await postInvitation(member, org.organizationId, { email });

    expectError(result, 403, "INSUFFICIENT_ROLE", "POST par un member");
    expect(await readInvitations(org.organizationId, email)).toEqual([]);
    expect(eventsForEmail(fakes.inngest, email)).toEqual([]);

    const witness = await postInvitation(org.owner, org.organizationId, { email });
    expectStatus(witness, 201, "temoin : l'owner de la meme organisation peut inviter");
  });

  it("AC6 : sans session -> 401 UNAUTHENTICATED, aucune ligne, aucun evenement", async () => {
    const org = await createOrganizationFixture("AC6 sans session");
    const email = inviteeEmail();

    const result = await postInvitation(null, org.organizationId, { email });

    expectError(result, 401, "UNAUTHENTICATED", "POST sans session");
    expect(await readInvitations(org.organizationId, email)).toEqual([]);
    expect(eventsForEmail(fakes.inngest, email)).toEqual([]);
  });
});

describe("AC7 — validation et normalisation", () => {
  const invalidBodies: Array<{ label: string; payload: Record<string, unknown> | string }> = [
    { label: "email absent", payload: {} },
    { label: "email vide", payload: { email: "" } },
    { label: "email seulement des espaces", payload: { email: "   " } },
    { label: "email non textuel (nombre)", payload: { email: 123 } },
    { label: "email non textuel (null)", payload: { email: null } },
    { label: "email non textuel (tableau)", payload: { email: ["a@example.test"] } },
    { label: "email sans arobase", payload: { email: "pas-un-email" } },
    { label: "email sans domaine", payload: { email: "alice@" } },
    { label: "email de plus de 254 caracteres", payload: { email: `${"a".repeat(250)}@example.test` } },
    { label: "corps non JSON", payload: "ceci { n'est pas du JSON" },
    { label: "corps vide", payload: "" },
  ];

  it("AC7 : chaque entree invalide -> 422 VALIDATION_FAILED, rien n'est cree ; l'owner invite ensuite normalement", async () => {
    const org = await createOrganizationFixture("AC7 invalides");

    for (const { label, payload } of invalidBodies) {
      const result = await postInvitation(org.owner, org.organizationId, payload);
      expectError(result, 422, "VALIDATION_FAILED", `POST avec ${label}`);
    }
    expect(await readInvitations(org.organizationId), "aucune ligne creee").toEqual([]);
    expect(fakes.inngest.events.filter((e) => e.data.organizationId === org.organizationId), "aucun evenement").toEqual([]);

    const witness = await postInvitation(org.owner, org.organizationId, { email: inviteeEmail() });
    expectStatus(witness, 201, "temoin : une adresse valide est acceptee");
  });

  it("AC7 : organizationId non UUID dans le chemin -> 422 VALIDATION_FAILED", async () => {
    const org = await createOrganizationFixture("AC7 chemin");
    const email = inviteeEmail();

    const result = await postInvitation(org.owner, "pas-un-uuid", { email });

    expectError(result, 422, "VALIDATION_FAILED", "POST avec organizationId non UUID");
    expect(eventsForEmail(fakes.inngest, email)).toEqual([]);
  });

  it("AC7 : \"  Alice@Example.COM  \" est enregistre et renvoye en minuscules, sans espaces ; la comparaison porte sur la forme normalisee", async () => {
    const org = await createOrganizationFixture("AC7 normalisation");
    const local = `Alice${uniqueId("n").replace(/_/g, "")}`;
    const normalized = `${local.toLowerCase()}@example.com`;

    const result = await postInvitation(org.owner, org.organizationId, { email: `  ${local}@Example.COM  ` });

    expectStatus(result, 201, "POST avec casse et espaces");
    expect(bodyField(result, "email")).toBe(normalized);
    const row = await readSingleInvitation(org.organizationId, normalized);
    expect(row.email).toBe(normalized);
    expect(eventsOfInvitation(fakes.inngest, idOf(result))[0]?.data.email, "l'evenement porte la forme normalisee").toBe(normalized);
  });

  it("AC7 : un champ inconnu du corps (expiresAt, role, organizationId contradictoire) n'a aucun effet", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const email = inviteeEmail();

    const result = await postInvitation(orgA.owner, orgA.organizationId, {
      email,
      expiresAt: "2099-01-01T00:00:00.000Z",
      role: "owner",
      organizationId: orgB.organizationId,
      invitedByUserId: orgB.owner.userId,
    });

    expectStatus(result, 201, "POST avec champs inconnus");
    const row = await readSingleInvitation(orgA.organizationId, email);
    expect(row).toMatchObject({ role: "member", organization_id: orgA.organizationId, invited_by_user_id: orgA.owner.userId });
    expect(row.lifetime_seconds).toBe(SEVEN_DAYS_SECONDS);
    expect(row.expires_at.getFullYear(), "expiresAt du corps ignore").toBeLessThan(2090);
    expect(await readInvitations(orgB.organizationId, email), "rien chez l'organisation designee par le corps").toEqual([]);
  });
});

describe("AC8 — doublon en attente", () => {
  it("AC8 : une invitation en attente existe -> 409 INVITATION_ALREADY_PENDING (meme casse ou espaces differents), ligne inchangee, aucun second evenement", async () => {
    const org = await createOrganizationFixture("AC8 doublon");
    const local = `Dup${uniqueId("d").replace(/_/g, "")}`;
    const email = `${local.toLowerCase()}@example.test`;
    const first = await postInvitation(org.owner, org.organizationId, { email });
    expectStatus(first, 201, "premiere invitation");
    const before = await readSingleInvitation(org.organizationId, email);

    for (const variant of [email, `  ${local}@EXAMPLE.test `, email.toUpperCase()]) {
      const again = await postInvitation(org.owner, org.organizationId, { email: variant });
      expectError(again, 409, "INVITATION_ALREADY_PENDING", `rejeu avec ${JSON.stringify(variant)}`);
    }

    const after = await readSingleInvitation(org.organizationId, email);
    expect(after.id).toBe(before.id);
    expect(after.token_hash.equals(before.token_hash), "meme empreinte").toBe(true);
    expect(after.expires_at.getTime(), "meme expiration").toBe(before.expires_at.getTime());
    expect(eventsForEmail(fakes.inngest, email), "un seul evenement, celui de la premiere").toHaveLength(1);
  });

  it("AC8 : la meme adresse invitee par l'organisation B -> 201 (l'unicite est par organisation)", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const email = inviteeEmail();
    expectStatus(await postInvitation(orgA.owner, orgA.organizationId, { email }), 201, "invitation par A");

    const result = await postInvitation(orgB.owner, orgB.organizationId, { email });

    expectStatus(result, 201, "meme adresse invitee par B");
    expect(await readInvitations(orgA.organizationId, email)).toHaveLength(1);
    expect(await readInvitations(orgB.organizationId, email)).toHaveLength(1);
  });
});

describe("AC9 — expiration puis reinvitation", () => {
  it("AC9 : invitation expiree (dates forcees) -> nouveau POST 201, ancienne ligne supprimee, nouvel id, nouvelle empreinte, 7 jours", async () => {
    const org = await createOrganizationFixture("AC9 reinvitation");
    const email = inviteeEmail();
    const first = await postInvitation(org.owner, org.organizationId, { email });
    expectStatus(first, 201, "premiere invitation");
    const oldRow = await readSingleInvitation(org.organizationId, email);
    await expireInvitationDirect(oldRow.id);

    const second = await postInvitation(org.owner, org.organizationId, { email });

    expectStatus(second, 201, "reinvitation apres expiration");
    expect(await readInvitationById(oldRow.id), "l'ancienne ligne est supprimee").toBeUndefined();
    const rows = await readInvitations(org.organizationId, email);
    expect(rows, "une seule ligne pour le couple").toHaveLength(1);
    expect(rows[0]?.id).not.toBe(oldRow.id);
    expect(rows[0]?.id).toBe(idOf(second));
    expect(rows[0]?.token_hash.equals(oldRow.token_hash), "autre empreinte").toBe(false);
    expect(rows[0]?.lifetime_seconds).toBe(SEVEN_DAYS_SECONDS);
    expect(rows[0]?.expires_at.getTime(), "expiration a 7 jours a partir de maintenant").toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);
    expect(eventsForEmail(fakes.inngest, email), "un evenement par emission reussie").toHaveLength(2);
  });

  it("AC9 : une invitation deja acceptee pour cette adresse n'empeche pas l'emission (index partiel)", async () => {
    const org = await createOrganizationFixture("AC9 acceptee");
    const someoneElse = await signUp();
    const email = inviteeEmail();
    const accepted = await insertInvitationDirect({
      organizationId: org.organizationId,
      email,
      invitedByUserId: org.owner.userId,
      accepted: { byUserId: someoneElse.userId },
    });

    const result = await postInvitation(org.owner, org.organizationId, { email });

    expectStatus(result, 201, "emission malgre une invitation acceptee");
    const rows = await readInvitations(org.organizationId, email);
    expect(rows.map((r) => r.id).sort()).toEqual([accepted.id, idOf(result)].sort());
    expect((await readInvitationById(accepted.id))?.accepted_at, "la ligne acceptee est conservee").not.toBeNull();
  });
});

describe("AC12 — adresse deja membre (D-086 Q-2)", () => {
  it("AC12 : l'adresse d'un member de A, quelle que soit la casse -> 409 ALREADY_MEMBER, aucune ligne, aucun evenement", async () => {
    const org = await createOrganizationFixture("AC12 member");
    const member = await signUp();
    await addMemberDirect({ organizationId: org.organizationId, userId: member.userId, role: "member" });

    for (const variant of [member.email, member.email.toUpperCase(), `  ${member.email}  `]) {
      const result = await postInvitation(org.owner, org.organizationId, { email: variant });
      expectError(result, 409, "ALREADY_MEMBER", `invitation de ${JSON.stringify(variant)}`);
    }

    expect(await readInvitations(org.organizationId, member.email)).toEqual([]);
    expect(eventsForEmail(fakes.inngest, member.email)).toEqual([]);
  });

  it("AC12 : l'owner qui s'invite lui-meme -> 409 ALREADY_MEMBER, aucune ligne, aucun evenement", async () => {
    const org = await createOrganizationFixture("AC12 owner");

    const result = await postInvitation(org.owner, org.organizationId, { email: org.owner.email.toUpperCase() });

    expectError(result, 409, "ALREADY_MEMBER", "l'owner s'invite lui-meme");
    expect(await readInvitations(org.organizationId, org.owner.email)).toEqual([]);
    expect(eventsForEmail(fakes.inngest, org.owner.email)).toEqual([]);
  });

  it("AC12 : l'adresse d'un utilisateur membre de B seulement, invitee par A -> 201, la reponse ne revele rien de B", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();

    const result = await postInvitation(orgA.owner, orgA.organizationId, { email: orgB.owner.email });

    expectStatus(result, 201, "invitation d'un membre d'une autre organisation");
    expect(Object.keys(result.body as object).sort()).toEqual(["email", "expiresAt", "id", "organizationId"]);
    expect(result.text).not.toContain(orgB.organizationId);
    expect(result.text).not.toContain(orgB.name);
    expect(result.text).not.toContain(orgB.owner.userId);
  });
});

describe("AC13 — file indisponible a la creation (D-086 Q-3)", () => {
  const MARKER = "detail-interne-file-ne-doit-jamais-fuiter";

  function expectNoInternalDetail(text: string): void {
    expect(text, "aucun detail interne dans la reponse").not.toContain(MARKER);
    expect(text).not.toMatch(/inngest/i);
    expect(text).not.toMatch(/\bat \S+ \(/);
  }

  it("AC13 : la file repond 500 -> 503 SERVICE_UNAVAILABLE sans detail interne, aucune ligne ; l'appel suivant, file revenue, donne 201 (pas de 409 fantome)", async () => {
    const org = await createOrganizationFixture("AC13 file en echec");
    const email = inviteeEmail();
    fakes.inngest.failWith(500, { error: MARKER });

    const failed = await postInvitation(org.owner, org.organizationId, { email });

    expectError(failed, 503, "SERVICE_UNAVAILABLE", "POST avec la file en echec");
    expectNoInternalDetail(failed.text);
    expect(await readInvitations(org.organizationId, email), "transaction annulee : aucune ligne").toEqual([]);

    fakes.inngest.succeed();
    const retried = await postInvitation(org.owner, org.organizationId, { email });

    expectStatus(retried, 201, "nouvel appel apres retour de la file");
    expect(await readInvitations(org.organizationId, email)).toHaveLength(1);
    expect(eventsForEmail(fakes.inngest, email)).toHaveLength(1);
  });

  it("AC13 : la file ne repond pas -> 503 SERVICE_UNAVAILABLE dans un delai raisonnable, aucune ligne ; l'appel suivant donne 201", async () => {
    const org = await createOrganizationFixture("AC13 file muette");
    const email = inviteeEmail();
    fakes.inngest.hang();

    const failed = await postInvitation(org.owner, org.organizationId, { email }, { signal: AbortSignal.timeout(50_000) });

    expectError(failed, 503, "SERVICE_UNAVAILABLE", "POST avec la file muette");
    expectNoInternalDetail(failed.text);
    expect(await readInvitations(org.organizationId, email)).toEqual([]);

    fakes.inngest.succeed();
    const retried = await postInvitation(org.owner, org.organizationId, { email });
    expectStatus(retried, 201, "nouvel appel apres retour de la file");
    expect(codeOf(retried), "pas de code d'erreur sur un succes").toBeUndefined();
  }, 70_000);
});
