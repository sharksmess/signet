/**
 * Tranche 006 — AC11 (le jeton ne fuit nulle part, ADR-0003, ADR-0017) et AC14
 * (aucune variable d'environnement nouvelle : la route ne lit pas la cle de
 * scellement des jetons).
 *
 * Limite assumee : le journal du serveur de test n'est pas lisible depuis la suite
 * (le globalSetup n'en conserve que la fin en memoire pour ses propres messages
 * d'echec) ; les journaux verifies ici sont ceux du processus de test.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../_factory/env";
import { signUp } from "../helpers/auth";
import { captureLogs, expectError, expectStatus, type HttpResult } from "../helpers/billing";
import { closeAllPools } from "../helpers/db";
import { addMemberDirect } from "../helpers/fixtures";
import {
  inviteeEmail,
  resetInvitationFakes,
  startInvitationFakes,
  stopInvitationFakes,
  tokenForms,
  type InvitationFakes,
} from "../helpers/invitations";
import {
  forgeInvitation,
  forgeInvitationWindow,
  issueInvitation,
  postAccept,
  readMembersOfOrganization,
  readMembersOfUser,
} from "../helpers/invitations-accept";
import { columnTexts, readInvitationById, readInvitations } from "../helpers/invitations-db";

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

const ACCEPT_DIR = path.join(ROOT, "apps/web/src/app/api/invitations/accept");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

function directoriesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? [full, ...directoriesUnder(full)] : [];
  });
}

describe("AC11 — le jeton ne fuit nulle part", () => {
  it("AC11 : sur les scenarios d'AC1 a AC9 (succes, 401, 403, 409 rejeu, 409 deja membre, 410, 404 malforme), le jeton et ses formes hexadecimale et base64 standard sont absents des reponses, des journaux du processus de test, des colonnes invitation et member", async () => {
    const logs = captureLogs();
    const responses: Array<[string, HttpResult]> = [];
    const tokens: string[] = [];
    const invitationIds: string[] = [];
    const orgIds: string[] = [];
    try {
      // Nominal, anonyme, autre adresse, jeton malforme derive du vrai, succes, rejeu.
      const email = inviteeEmail();
      const issued = await issueInvitation(fakes, { email, label: "AC11 nominal" });
      tokens.push(issued.token);
      invitationIds.push(issued.invitationId);
      orgIds.push(issued.org.organizationId);
      const invitee = await signUp({ email });
      const intruder = await signUp();
      responses.push(["anonyme", await postAccept(null, { token: issued.token })]);
      responses.push(["autre adresse", await postAccept(intruder, { token: issued.token })]);
      responses.push(["malforme (jeton suivi de =)", await postAccept(invitee, { token: `${issued.token}=` })]);
      responses.push(["succes", await postAccept(invitee, { token: issued.token })]);
      responses.push(["rejeu", await postAccept(invitee, { token: issued.token })]);

      // Deja membre.
      const memberEmail = inviteeEmail();
      const forgedMember = await forgeInvitation({ email: memberEmail, label: "AC11 membre" });
      tokens.push(forgedMember.token);
      invitationIds.push(forgedMember.row.id);
      orgIds.push(forgedMember.org.organizationId);
      const member = await signUp({ email: memberEmail });
      await addMemberDirect({ organizationId: forgedMember.org.organizationId, userId: member.userId, role: "member" });
      responses.push(["deja membre", await postAccept(member, { token: forgedMember.token })]);

      // Expiree.
      const expiredEmail = inviteeEmail();
      const forgedExpired = await forgeInvitationWindow({
        email: expiredEmail,
        agoSeconds: 2 * 24 * 3600,
        lifetimeSeconds: 2 * 24 * 3600 - 1,
        label: "AC11 expiree",
      });
      tokens.push(forgedExpired.token);
      invitationIds.push(forgedExpired.row.id);
      orgIds.push(forgedExpired.org.organizationId);
      const late = await signUp({ email: expiredEmail });
      responses.push(["expiree", await postAccept(late, { token: forgedExpired.token })]);
    } finally {
      logs.restore();
    }

    const success = responses.find(([label]) => label === "succes")?.[1];
    if (!success) throw new Error("scenario de succes absent");
    expectStatus(success, 200, "AC11 succes");
    const rows = (await Promise.all(invitationIds.map((id) => readInvitationById(id)))).filter((row) => row !== undefined);
    const members = (await Promise.all(orgIds.map((id) => readMembersOfOrganization(id)))).flat();
    const haystacks: Array<[string, string]> = [
      ...responses.map(([label, result]): [string, string] => [`reponse ${label}`, result.text]),
      ["journaux du processus de test", logs.text()],
      ["colonnes des lignes invitation", rows.flatMap((row) => columnTexts(row)).join("\n")],
      ["colonnes des lignes member", members.map((m) => `${m.organization_id} ${m.user_id} ${m.role}`).join("\n")],
    ];
    expect(responses.length, "scenarios executes").toBe(7);
    for (const token of tokens) {
      for (const form of tokenForms(token)) {
        for (const [where, text] of haystacks) {
          expect(text, `le jeton (forme de ${form.length} caracteres) ne doit pas figurer dans : ${where}`).not.toContain(form);
        }
      }
    }
  }, 120_000);

  it("AC11 : un jeton passe en ?token= est ignore (422, corps sans le jeton) et ne consomme rien", async () => {
    const email = inviteeEmail();
    const forged = await forgeInvitation({ email, label: "AC11 query" });
    const invitee = await signUp({ email });

    const noBody = await postAccept(invitee, {}, { query: `?token=${forged.token}` });
    const otherBody = await postAccept(invitee, { autre: "champ" }, { query: `?token=${forged.token}` });

    for (const response of [noBody, otherBody]) {
      expectError(response, 422, "VALIDATION_FAILED", "AC11 jeton en query string");
      for (const form of tokenForms(forged.token)) expect(response.text, "le corps du 422 ne reprend pas le jeton").not.toContain(form);
    }
    expect((await readInvitationById(forged.row.id))?.accepted_at, "rien n'est consomme").toBeNull();
    expect(await readMembersOfUser(invitee.userId)).toEqual([]);
    expect(await readInvitations(forged.org.organizationId, email)).toHaveLength(1);
  });

  it("AC11 : la route n'a aucun segment dynamique (aucun dossier [...] sous api/invitations/accept)", () => {
    expect(statSync(ACCEPT_DIR).isDirectory(), "apps/web/src/app/api/invitations/accept existe").toBe(true);
    expect(filesUnder(ACCEPT_DIR).map((f) => path.basename(f)), "route.ts present").toContain("route.ts");
    expect(directoriesUnder(ACCEPT_DIR).filter((d) => /[[\]]/.test(path.relative(ACCEPT_DIR, d))), "dossiers dynamiques").toEqual([]);
  });
});

describe("AC14 — environnement", () => {
  it("AC14 : la route d'acceptation ne lit pas la cle de scellement (le jeton n'est jamais descelle a l'acceptation) et ne lit aucune variable d'environnement", () => {
    const sealingKeyName = ["INVITATION", "TOKEN", "KEY"].join("_");
    const envAccess = new RegExp(["process", "env"].join("\\."));
    expect(statSync(ACCEPT_DIR).isDirectory(), "apps/web/src/app/api/invitations/accept existe").toBe(true);
    const files = filesUnder(ACCEPT_DIR).filter((f) => /\.(ts|tsx)$/.test(f));

    expect(files.length, "fichiers de la route").toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, `${path.relative(ROOT, file)} ne cite pas la cle de scellement`).not.toContain(sealingKeyName);
      expect(source, `${path.relative(ROOT, file)} ne lit pas l'environnement directement`).not.toMatch(envAccess);
    }
  });
});
