/**
 * Tranche 006 — acceptation d'une invitation, par l'API (`POST /api/invitations/accept`).
 *
 * AC1, AC2, AC3, AC4 (API), AC5 (a), AC6 (rejeu), AC7, AC8, AC9, AC10.
 *
 * Les invitations des scenarios nominaux (AC1, AC2, AC5, AC6, AC7) sont emises par la
 * vraie route de 003 ; la fonction d'envoi est executee par @inngest/test et le jeton
 * est relu dans la fausse messagerie. Les etats que l'API ne produit pas (expire,
 * deja accepte, deja membre) sont forces en base sous la connexion d'administration.
 * Valeurs inventees, visiblement fausses.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../_factory/env";
import { baseUrl, signUp } from "../helpers/auth";
import { expectError, expectStatus, type HttpResult } from "../helpers/billing";
import { asTenant, closeAllPools } from "../helpers/db";
import { addMemberDirect, createOrganizationFixture } from "../helpers/fixtures";
import { inviteeEmail, resetInvitationFakes, startInvitationFakes, stopInvitationFakes, type InvitationFakes } from "../helpers/invitations";
import {
  accountCountForEmail,
  deleteAccountDirect,
  errorBodyKeys,
  expectApiError,
  forgeInvitation,
  forgeInvitationWindow,
  issueInvitation,
  lockInvitationTable,
  mixedCase,
  newTestToken,
  postAccept,
  readMembersOfOrganization,
  readMembersOfUser,
  settledWithin,
  snapshotOf,
} from "../helpers/invitations-accept";
import { readInvitationById, sha256 } from "../helpers/invitations-db";
import { renameOrganization } from "../helpers/organizationsApi";

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

describe("AC1 — acceptation nominale de bout en bout (US-03.1, D-090)", () => {
  it("AC1 : emission, e-mail, inscription (casse differente), acceptation -> 200 { organizationId, role: member }, member cree, invitation consommee, droits de membre", async () => {
    const org = await createOrganizationFixture("Org AC1 nominal");
    const email = inviteeEmail();
    const issued = await issueInvitation(fakes, { org, email, label: "AC1" });
    const invitee = await signUp({ email: mixedCase(email) });

    const before = await renameOrganization(invitee, org.organizationId, { name: "Nom propose par un non-membre" });
    expectApiError(before, 404, "ORGANIZATION_NOT_FOUND", "AC1 : avant acceptation, l'invite n'est pas membre (PATCH)");

    const response = await postAccept(invitee, { token: issued.token });

    expectStatus(response, 200, "AC1 acceptation");
    expect(response.body).toEqual({ organizationId: org.organizationId, role: "member" });
    expect(await readMembersOfUser(invitee.userId)).toEqual([
      { organization_id: org.organizationId, user_id: invitee.userId, role: "member" },
    ]);
    const row = await readInvitationById(issued.invitationId);
    expect(row?.accepted_at, "accepted_at renseigne").toBeInstanceOf(Date);
    expect(row?.accepted_by_user_id).toBe(invitee.userId);
    const after = await renameOrganization(invitee, org.organizationId, { name: "Nom propose par un membre" });
    expectApiError(after, 403, "INSUFFICIENT_ROLE", "AC1 : apres acceptation, l'invite est membre sans le role owner (PATCH)");
    // D-090 : l'empreinte stockee est celle des 32 octets decodes, pas celle du texte base64url.
    expect(row?.token_hash.equals(sha256(Buffer.from(issued.token, "base64url"))), "empreinte des octets").toBe(true);
    expect(row?.token_hash.equals(sha256(issued.token)), "l'empreinte n'est pas celle du texte du jeton").toBe(false);
  });
});

describe("AC2 — compte existant (US-03.1 « lie un compte existant »)", () => {
  it("AC2 : owner de sa propre organisation B, invite a A a son adresse -> 200, member de A et toujours owner de B", async () => {
    const orgA = await createOrganizationFixture("Org AC2 A");
    const orgB = await createOrganizationFixture("Org AC2 B");
    const existing = orgB.owner;
    const issued = await issueInvitation(fakes, { org: orgA, email: existing.email, label: "AC2" });

    const response = await postAccept(existing, { token: issued.token });

    expectStatus(response, 200, "AC2 acceptation par un compte existant");
    expect(response.body).toEqual({ organizationId: orgA.organizationId, role: "member" });
    const memberships = await readMembersOfUser(existing.userId);
    expect(memberships.map((m) => `${m.organization_id}:${m.role}`).sort()).toEqual(
      [`${orgA.organizationId}:member`, `${orgB.organizationId}:owner`].sort(),
    );
    expect((await readMembersOfOrganization(orgB.organizationId)).filter((m) => m.role === "owner"), "un seul owner dans B").toHaveLength(1);
    const listed = await asTenant({ userId: existing.userId }, async (client) =>
      (await client.query<{ listed: string }>("SELECT to_jsonb(o)::text AS listed FROM signet.organizations_for_user($1) AS o", [existing.userId])).rows.map(
        (r) => r.listed,
      ),
    );
    const text = listed.join("\n");
    expect(text, "organizations_for_user renvoie A").toContain(orgA.organizationId);
    expect(text, "organizations_for_user renvoie B").toContain(orgB.organizationId);
  });
});

describe("AC3 — jeton inconnu ou malforme : 404 identique, rien n'est revele", () => {
  it("AC3 : tous les jetons inconnus ou malformes donnent 404 INVITATION_NOT_FOUND au corps strictement identique, aucune ligne modifiee, le vrai jeton reste utilisable", async () => {
    const org = await createOrganizationFixture("Org AC3");
    const email = inviteeEmail();
    const issued = await issueInvitation(fakes, { org, email, label: "AC3" });
    const invitee = await signUp({ email });
    const snapshotBefore = snapshotOf(await readInvitationById(issued.invitationId));
    const t = issued.token;
    const replaceAt = (index: number, char: string): string => `${t.slice(0, index)}${char}${t.slice(index + 1)}`;
    const cases: Array<[string, string]> = [
      ["bien forme, jamais emis", newTestToken().token],
      ["chaine vide", ""],
      ["espaces seulement (vide apres trim)", "   "],
      ["42 caracteres (31 octets)", randomBytes(31).toString("base64url")],
      ["44 caracteres (33 octets)", randomBytes(33).toString("base64url")],
      ["43 caracteres dont un +", replaceAt(5, "+")],
      ["43 caracteres dont un /", replaceAt(5, "/")],
      ["43 caracteres dont un =", replaceAt(42, "=")],
      ["43 caracteres dont une espace", replaceAt(5, " ")],
      ["jeton vrai suivi du remplissage =", `${t}=`],
      ["l'empreinte stockee presentee comme jeton", issued.tokenHash.toString("base64url")],
    ];

    const results: Array<{ label: string; result: HttpResult }> = [];
    for (const [label, token] of cases) results.push({ label, result: await postAccept(invitee, { token }) });

    const [reference] = results;
    for (const { label, result } of results) {
      expectError(result, 404, "INVITATION_NOT_FOUND", `AC3 : ${label}`);
      expect(result.text, `AC3 : ${label} : corps identique octet pour octet`).toBe(reference?.result.text);
    }
    expect(snapshotOf(await readInvitationById(issued.invitationId)), "aucune ligne modifiee").toBe(snapshotBefore);
    expect(await readMembersOfUser(invitee.userId), "aucune appartenance").toEqual([]);
    expectStatus(await postAccept(invitee, { token: t }), 200, "AC3 : le vrai jeton n'a rien perdu");
  });

  it("AC3 : un jeton malforme ne touche jamais la table invitation (verrou exclusif tenu : la reponse arrive quand meme), un jeton bien forme y accede (temoin)", async () => {
    const invitee = await signUp();
    const lock = await lockInvitationTable();
    let control: Promise<HttpResult> | undefined;
    try {
      for (const malformed of ["", "   ", randomBytes(33).toString("base64url"), `${newTestToken().token.slice(0, 20)}+${newTestToken().token.slice(21)}`]) {
        const outcome = await settledWithin(postAccept(invitee, { token: malformed }), 5_000);
        expect(outcome, `jeton malforme ${JSON.stringify(malformed)} : la route repond sans attendre la table`).not.toBe("pending");
        if (outcome !== "pending") expectError(outcome, 404, "INVITATION_NOT_FOUND", "AC3 jeton malforme sous verrou");
      }
      control = postAccept(invitee, { token: newTestToken().token });
      expect(await settledWithin(control, 1_500), "temoin : un jeton bien forme interroge la table et attend le verrou").toBe("pending");
    } finally {
      await lock.release();
    }
    if (!control) throw new Error("temoin non lance");
    expectError(await control, 404, "INVITATION_NOT_FOUND", "AC3 temoin apres liberation du verrou");
  });
});

describe("AC4 — expiration (US-03.2, D-091)", () => {
  it("AC4 : expires_at une seconde dans le passe -> 410 INVITATION_EXPIRED, aucune appartenance, accepted_at reste NULL", async () => {
    const email = inviteeEmail();
    const forged = await forgeInvitationWindow({ agoSeconds: 2 * 24 * 3600, lifetimeSeconds: 2 * 24 * 3600 - 1, email, label: "AC4 expire" });
    const invitee = await signUp({ email });

    const response = await postAccept(invitee, { token: forged.token });

    expectError(response, 410, "INVITATION_EXPIRED", "AC4 expiree");
    expect(await readMembersOfUser(invitee.userId)).toEqual([]);
    const row = await readInvitationById(forged.row.id);
    expect(row?.accepted_at).toBeNull();
    expect(row?.accepted_by_user_id).toBeNull();
  });

  it("AC4 : expires_at encore dans le futur (marge de 30 s pour la latence HTTP) -> 200", async () => {
    const email = inviteeEmail();
    const forged = await forgeInvitationWindow({ agoSeconds: 2 * 24 * 3600, lifetimeSeconds: 2 * 24 * 3600 + 30, email, label: "AC4 valide" });
    const invitee = await signUp({ email });

    const response = await postAccept(invitee, { token: forged.token });

    expectStatus(response, 200, "AC4 valide");
    expect(response.body).toEqual({ organizationId: forged.org.organizationId, role: "member" });
  });
});

describe("AC5 (a) — isolation tenant par l'API (US-09)", () => {
  it("AC5 (a) : l'invitation de A fait de l'invite un membre de A seulement ; rien dans B ; la reponse ne contient que organizationId et role", async () => {
    const orgA = await createOrganizationFixture("Org AC5 A");
    const orgB = await createOrganizationFixture("Org AC5 B");
    const email = inviteeEmail();
    const issued = await issueInvitation(fakes, { org: orgA, email, label: "AC5a" });
    const invitee = await signUp({ email });
    const membersOfBBefore = await readMembersOfOrganization(orgB.organizationId);

    const response = await postAccept(invitee, { token: issued.token });

    expectStatus(response, 200, "AC5 (a)");
    expect(Object.keys(response.body as object).sort()).toEqual(["organizationId", "role"]);
    for (const foreign of [orgA.name, orgA.owner.userId, orgA.owner.email, orgB.organizationId, orgB.name]) {
      expect(response.text, "aucune donnee de A hormis organizationId").not.toContain(foreign);
    }
    expect((await readMembersOfUser(invitee.userId)).map((m) => m.organization_id)).toEqual([orgA.organizationId]);
    expect(await readMembersOfOrganization(orgB.organizationId), "B inchangee").toEqual(membersOfBBefore);
    const probe = await renameOrganization(invitee, orgB.organizationId, { name: "Nom propose par l'invite de A" });
    expectApiError(probe, 404, "ORGANIZATION_NOT_FOUND", "AC5 (a) : l'invite de A ne voit pas B");
  });
});

describe("AC6 — consommation a usage unique (rejeu)", () => {
  it("AC6 : rejeu sequentiel du jeton apres succes -> 409 INVITATION_ALREADY_USED, aucune ligne de plus", async () => {
    const org = await createOrganizationFixture("Org AC6 rejeu");
    const email = inviteeEmail();
    const issued = await issueInvitation(fakes, { org, email, label: "AC6" });
    const invitee = await signUp({ email });
    expectStatus(await postAccept(invitee, { token: issued.token }), 200, "AC6 premiere acceptation");
    const acceptedAt = (await readInvitationById(issued.invitationId))?.accepted_at;

    const replay = await postAccept(invitee, { token: issued.token });

    expectError(replay, 409, "INVITATION_ALREADY_USED", "AC6 rejeu par le meme invite");
    expect(await readMembersOfUser(invitee.userId), "une seule ligne member").toHaveLength(1);
    expect((await readInvitationById(issued.invitationId))?.accepted_at?.getTime(), "accepted_at inchange").toBe(acceptedAt?.getTime());
  });

  it("AC6 : jeton deja consomme presente par un autre compte -> 409 INVITATION_ALREADY_USED (et non 403)", async () => {
    const org = await createOrganizationFixture("Org AC6 autre compte");
    const email = inviteeEmail();
    const issued = await issueInvitation(fakes, { org, email, label: "AC6 autre" });
    const invitee = await signUp({ email });
    const stranger = await signUp();
    expectStatus(await postAccept(invitee, { token: issued.token }), 200, "AC6 premiere acceptation");

    expectError(await postAccept(stranger, { token: issued.token }), 409, "INVITATION_ALREADY_USED", "AC6 presente par un autre compte");
    expect(await readMembersOfUser(stranger.userId)).toEqual([]);
  });
});

describe("AC7 — identite de l'invite (D-102 Q-1, Q-2)", () => {
  it("AC7 : sans session -> 401 UNAUTHENTICATED, l'invitation reste en attente", async () => {
    const forged = await forgeInvitation({ label: "AC7 anonyme" });

    const response = await postAccept(null, { token: forged.token });

    expectError(response, 401, "UNAUTHENTICATED", "AC7 sans session");
    const row = await readInvitationById(forged.row.id);
    expect(row?.accepted_at).toBeNull();
  });

  it("AC7 : compte d'une autre adresse -> 403 INVITATION_EMAIL_MISMATCH, message fixe sans adresse, rien n'est consomme, le bon compte accepte ensuite", async () => {
    const email = inviteeEmail();
    const forged = await forgeInvitation({ email, label: "AC7 autre adresse" });
    const intruder = await signUp();
    const invitee = await signUp({ email });

    const response = await postAccept(intruder, { token: forged.token });

    expectError(response, 403, "INVITATION_EMAIL_MISMATCH", "AC7 autre adresse");
    expect(response.text, "ni l'adresse invitee").not.toContain(email);
    expect(response.text, "ni celle du compte connecte").not.toContain(intruder.email);
    expect(await readMembersOfUser(intruder.userId)).toEqual([]);
    expect((await readInvitationById(forged.row.id))?.accepted_at, "invitation toujours en attente").toBeNull();
    expectStatus(await postAccept(invitee, { token: forged.token }), 200, "AC7 le bon compte accepte ensuite");
  });

  it("AC7 : comparaison insensible a la casse (Alice@Example.TEST accepte une invitation alice@example.test)", async () => {
    const email = inviteeEmail();
    const forged = await forgeInvitation({ email, label: "AC7 casse" });
    const invitee = await signUp({ email: mixedCase(email) });

    const response = await postAccept(invitee, { token: forged.token });

    expectStatus(response, 200, "AC7 casse");
    expect((await readInvitationById(forged.row.id))?.accepted_by_user_id).toBe(invitee.userId);
  });

  it("AC7 : un password fourni n'a aucun effet (aucun compte cree, aucune connexion, 401 sans session)", async () => {
    const email = inviteeEmail();
    const forged = await forgeInvitation({ email, label: "AC7 password" });

    const response = await fetch(`${baseUrl()}/api/invitations/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl() },
      body: JSON.stringify({ token: forged.token, password: "Mot-de-passe-de-test-1" }),
    });
    const text = await response.text();

    expect(response.status, `corps brut : ${text}`).toBe(401);
    expect(response.headers.get("set-cookie"), "aucune session ouverte").toBeNull();
    expect(await accountCountForEmail(email), "aucun compte cree").toBe(0);
    expect((await readInvitationById(forged.row.id))?.accepted_at).toBeNull();
  });
});

describe("AC8 — deja membre (P-5)", () => {
  it("AC8 : un compte deja membre de A accepte -> 409 ALREADY_MEMBER, invitation non consommee, aucune ligne member de plus", async () => {
    const email = inviteeEmail();
    const forged = await forgeInvitation({ email, label: "AC8 membre" });
    const invitee = await signUp({ email });
    await addMemberDirect({ organizationId: forged.org.organizationId, userId: invitee.userId, role: "member" });

    const response = await postAccept(invitee, { token: forged.token });

    expectError(response, 409, "ALREADY_MEMBER", "AC8 deja membre");
    expect((await readInvitationById(forged.row.id))?.accepted_at, "non consommee").toBeNull();
    expect(await readMembersOfUser(invitee.userId), "aucune ligne de plus").toHaveLength(1);
  });

  it("AC8 : l'owner de A qui presente une invitation de A a sa propre adresse (forcee en base) -> 409 ALREADY_MEMBER", async () => {
    const org = await createOrganizationFixture("Org AC8 owner");
    const forged = await forgeInvitation({ org, email: org.owner.email, label: "AC8 owner" });

    const response = await postAccept(org.owner, { token: forged.token });

    expectError(response, 409, "ALREADY_MEMBER", "AC8 owner");
    expect((await readInvitationById(forged.row.id))?.accepted_at).toBeNull();
    expect((await readMembersOfOrganization(org.organizationId)).filter((m) => m.user_id === org.owner.userId)).toEqual([
      { organization_id: org.organizationId, user_id: org.owner.userId, role: "owner" },
    ]);
  });
});

describe("AC9 — compte disparu", () => {
  it("AC9 : compte supprime entre la connexion et l'appel -> 401 UNAUTHENTICATED, invitation intacte", async () => {
    const email = inviteeEmail();
    const forged = await forgeInvitation({ email, label: "AC9" });
    const invitee = await signUp({ email });
    await deleteAccountDirect(invitee.userId);
    const snapshotBefore = snapshotOf(await readInvitationById(forged.row.id));

    const response = await postAccept(invitee, { token: forged.token });

    expectError(response, 401, "UNAUTHENTICATED", "AC9 compte disparu");
    expect(snapshotOf(await readInvitationById(forged.row.id))).toBe(snapshotBefore);
    expect(await readMembersOfUser(invitee.userId)).toEqual([]);
  });
});

describe("AC10 — pas d'enumeration, messages fixes", () => {
  interface Observed {
    result: HttpResult;
    secrets: string[];
  }

  async function expired(label: string): Promise<Observed> {
    const email = inviteeEmail();
    const forged = await forgeInvitationWindow({ agoSeconds: 2 * 24 * 3600, lifetimeSeconds: 2 * 24 * 3600 - 1, email, label });
    const invitee = await signUp({ email });
    const result = await postAccept(invitee, { token: forged.token });
    return { result, secrets: [email, forged.org.name, forged.org.organizationId, forged.row.id, forged.org.owner.email] };
  }

  async function used(label: string): Promise<Observed> {
    const other = await signUp();
    const email = inviteeEmail();
    const forged = await forgeInvitation({ email, acceptedBy: other.userId, label });
    const invitee = await signUp({ email });
    const result = await postAccept(invitee, { token: forged.token });
    return { result, secrets: [email, forged.org.name, forged.org.organizationId, forged.row.id, other.email] };
  }

  async function mismatch(label: string): Promise<Observed> {
    const email = inviteeEmail();
    const forged = await forgeInvitation({ email, label });
    const intruder = await signUp();
    const result = await postAccept(intruder, { token: forged.token });
    return { result, secrets: [email, intruder.email, forged.org.name, forged.org.organizationId, forged.row.id] };
  }

  async function alreadyMember(label: string): Promise<Observed> {
    const email = inviteeEmail();
    const forged = await forgeInvitation({ email, label });
    const invitee = await signUp({ email });
    await addMemberDirect({ organizationId: forged.org.organizationId, userId: invitee.userId, role: "member" });
    const result = await postAccept(invitee, { token: forged.token });
    return { result, secrets: [email, forged.org.name, forged.org.organizationId, forged.row.id] };
  }

  async function unknown(): Promise<Observed> {
    const invitee = await signUp();
    return { result: await postAccept(invitee, { token: newTestToken().token }), secrets: [invitee.email, invitee.userId] };
  }

  async function anonymous(): Promise<Observed> {
    return { result: await postAccept(null, { token: newTestToken().token }), secrets: [] };
  }

  const SQL_CODE = /SG0\d\d|\b23[0-9]{3}\b|\b42[0-9A-Z]{3}\b|P0001|violates|constraint|signet\.|invitation_[a-z_]+_idx/;
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  it.each([
    ["404 INVITATION_NOT_FOUND", 404, "INVITATION_NOT_FOUND", unknown],
    ["410 INVITATION_EXPIRED", 410, "INVITATION_EXPIRED", () => expired("AC10 expire")],
    ["409 INVITATION_ALREADY_USED", 409, "INVITATION_ALREADY_USED", () => used("AC10 utilisee")],
    ["403 INVITATION_EMAIL_MISMATCH", 403, "INVITATION_EMAIL_MISMATCH", () => mismatch("AC10 autre adresse")],
    ["409 ALREADY_MEMBER", 409, "ALREADY_MEMBER", () => alreadyMember("AC10 deja membre")],
    ["401 UNAUTHENTICATED", 401, "UNAUTHENTICATED", anonymous],
  ] as const)(
    "AC10 : %s a un corps fixe (code et message seulement, identique pour deux invitations differentes) sans adresse, nom d'organisation, identifiant ni code SQL",
    async (_label, status, code, scenario) => {
      const first = await scenario();
      const second = await scenario();

      for (const observed of [first, second]) {
        expectError(observed.result, status, code, `AC10 ${code}`);
        expect(errorBodyKeys(observed.result), "corps : code et message seulement").toEqual(["code", "message"]);
        for (const secret of observed.secrets) expect(observed.result.text, `${code} ne contient pas ${JSON.stringify(secret)}`).not.toContain(secret);
        expect(observed.result.text, "aucun code SQL ni nom de contrainte").not.toMatch(SQL_CODE);
        expect(observed.result.text, "aucun identifiant interne").not.toMatch(UUID);
      }
      expect(second.result.text, `${code} : message fixe, identique d'une invitation a l'autre`).toBe(first.result.text);
    },
    60_000,
  );

  it("AC10 : 422 VALIDATION_FAILED pour un corps non JSON, un token absent, non textuel, ou de plus de 256 caracteres (rien ne touche l'invitation)", async () => {
    const forged = await forgeInvitation({ label: "AC10 422" });
    const invitee = await signUp();
    const bodies: Array<[string, Record<string, unknown> | string]> = [
      ["corps non JSON", "ceci n'est pas du JSON"],
      ["token absent", {}],
      ["token numerique", { token: 12345 }],
      ["token nul", { token: null }],
      ["token de 257 caracteres", { token: "A".repeat(257) }],
    ];

    for (const [label, body] of bodies) {
      const response = await postAccept(invitee, body);
      expectError(response, 422, "VALIDATION_FAILED", `AC10 : ${label}`);
    }
    expect((await readInvitationById(forged.row.id))?.accepted_at).toBeNull();
  });

  it("AC10 : lookup_invitation n'est exposee par aucune route (aucun fichier de route hors /api/invitations/accept ne la mentionne)", () => {
    const apiDir = path.join(ROOT, "apps/web/src/app/api");
    const acceptDir = path.join(apiDir, "invitations", "accept");
    const mentioning: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (full === acceptDir) continue;
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && readFileSync(full, "utf8").includes("lookup_invitation")) mentioning.push(path.relative(ROOT, full));
      }
    };
    walk(apiDir);
    expect(mentioning, "routes qui mentionnent lookup_invitation").toEqual([]);
    expect(statSync(acceptDir).isDirectory(), "la route d'acceptation existe (apps/web/src/app/api/invitations/accept)").toBe(true);
  });

  it("AC10 : aucune route de lecture d'invitation par jeton (GET /api/invitations/lookup et /api/invitations/accept ne renvoient pas l'invitation)", async () => {
    const forged = await forgeInvitation({ label: "AC10 lecture" });
    const invitee = await signUp();
    const headers = { Cookie: invitee.cookie, Origin: baseUrl() };

    const viaAccept = await fetch(`${baseUrl()}/api/invitations/accept?token=${forged.token}`, { method: "GET", headers });
    const viaLookup = await fetch(`${baseUrl()}/api/invitations/lookup?token=${forged.token}`, { method: "GET", headers });

    for (const response of [viaAccept, viaLookup]) {
      const text = await response.text();
      expect([404, 405], `GET : ${response.status} ${text}`).toContain(response.status);
      expect(text).not.toContain(forged.email);
      expect(text).not.toContain(forged.org.name);
    }
  });
});
