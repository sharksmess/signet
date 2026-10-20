/**
 * Tranche 003 — AC10 : concurrence. Deux POST simultanes pour le meme couple
 * (organisation, adresse) arrivent par deux requetes HTTP distinctes, donc deux
 * connexions a la base : exactement un 201 et un 409 INVITATION_ALREADY_PENDING.
 * Chaque cas est rejoue sur plusieurs adresses pour donner une chance reelle a la
 * course ; une seule execution chanceuse ne prouverait rien.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { closeAllPools } from "../helpers/db";
import { createOrganizationFixture } from "../helpers/fixtures";
import { codeOf } from "../helpers/billing";
import {
  eventsForEmail,
  inviteeEmail,
  postInvitation,
  resetInvitationFakes,
  startInvitationFakes,
  stopInvitationFakes,
  type InvitationFakes,
} from "../helpers/invitations";
import { insertInvitationDirect, readInvitations } from "../helpers/invitations-db";
import type { OrganizationFixture } from "../helpers/fixtures";

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

const ROUNDS = 5;

async function race(org: OrganizationFixture, email: string): Promise<void> {
  const results = await Promise.all([
    postInvitation(org.owner, org.organizationId, { email }),
    postInvitation(org.owner, org.organizationId, { email }),
  ]);

  const summary = results.map((r) => `${r.status} ${codeOf(r) ?? ""}`.trim()).sort();
  expect(summary, `statuts des deux appels simultanes pour ${email} ; corps bruts : ${results.map((r) => r.text).join(" | ")}`).toEqual([
    "201",
    "409 INVITATION_ALREADY_PENDING",
  ]);
  expect(await readInvitations(org.organizationId, email), `une seule ligne pour ${email}`).toHaveLength(1);
  expect(eventsForEmail(fakes.inngest, email), `un seul evenement pour ${email}`).toHaveLength(1);
}

describe("AC10 — concurrence", () => {
  it("AC10 : deux POST simultanes pour (A, e-mail) -> un 201 et un 409 INVITATION_ALREADY_PENDING, une ligne, un evenement", async () => {
    const org = await createOrganizationFixture("AC10 course");

    for (let round = 0; round < ROUNDS; round += 1) await race(org, inviteeEmail());
  }, 60_000);

  it("AC10 : meme resultat lorsqu'une invitation expiree du couple existe avant les deux appels (les purges se serialisent)", async () => {
    const org = await createOrganizationFixture("AC10 course apres expiration");

    for (let round = 0; round < ROUNDS; round += 1) {
      const email = inviteeEmail();
      const expired = await insertInvitationDirect({
        organizationId: org.organizationId,
        email,
        invitedByUserId: org.owner.userId,
        createdAtOffset: "-8 days",
        expiresAtOffset: "-1 day",
      });
      const results = await Promise.all([
        postInvitation(org.owner, org.organizationId, { email }),
        postInvitation(org.owner, org.organizationId, { email }),
      ]);

      const summary = results.map((r) => `${r.status} ${codeOf(r) ?? ""}`.trim()).sort();
      expect(summary, `statuts pour ${email} ; corps bruts : ${results.map((r) => r.text).join(" | ")}`).toEqual([
        "201",
        "409 INVITATION_ALREADY_PENDING",
      ]);
      const rows = await readInvitations(org.organizationId, email);
      expect(rows, "une seule ligne : l'expiree est purgee, la nouvelle inseree").toHaveLength(1);
      expect(rows[0]?.id).not.toBe(expired.id);
      expect(eventsForEmail(fakes.inngest, email)).toHaveLength(1);
    }
  }, 60_000);
});
