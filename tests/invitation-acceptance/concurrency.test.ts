/**
 * Tranche 006 — AC6 : deux POST /api/invitations/accept simultanes avec le meme
 * jeton, par le meme invite, arrivent par deux requetes HTTP distinctes donc deux
 * connexions a la base : exactement un 200 et un 409 INVITATION_ALREADY_USED
 * (jamais 409 ALREADY_MEMBER pour le perdant), une seule ligne member, un seul
 * accepted_at. Rejoue plusieurs fois : une execution chanceuse ne prouverait rien.
 * (Le volet « deux transactions ouvertes » est dans acceptance-functions.test.ts.)
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { signUp } from "../helpers/auth";
import { codeOf } from "../helpers/billing";
import { closeAllPools } from "../helpers/db";
import { createOrganizationFixture } from "../helpers/fixtures";
import { inviteeEmail, resetInvitationFakes, startInvitationFakes, stopInvitationFakes, type InvitationFakes } from "../helpers/invitations";
import { issueInvitation, postAccept, readMembersOfUser } from "../helpers/invitations-accept";
import { readInvitationById } from "../helpers/invitations-db";

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

const ROUNDS = 4;

describe("AC6 — concurrence (US-03.3)", () => {
  it("AC6 : deux POST simultanes, meme jeton, meme invite -> un 200 et un 409 INVITATION_ALREADY_USED, une ligne member, un accepted_at", async () => {
    const org = await createOrganizationFixture("Org AC6 course");

    for (let round = 0; round < ROUNDS; round += 1) {
      const email = inviteeEmail();
      const issued = await issueInvitation(fakes, { org, email, label: `AC6 course ${round}` });
      const invitee = await signUp({ email });

      const results = await Promise.all([postAccept(invitee, { token: issued.token }), postAccept(invitee, { token: issued.token })]);

      const summary = results.map((r) => `${r.status} ${r.status === 200 ? "" : (codeOf(r) ?? "")}`.trim()).sort();
      expect(summary, `tour ${round} : statuts ; corps bruts : ${results.map((r) => r.text).join(" | ")}`).toEqual([
        "200",
        "409 INVITATION_ALREADY_USED",
      ]);
      expect(await readMembersOfUser(invitee.userId), `tour ${round} : une seule ligne member`).toHaveLength(1);
      const row = await readInvitationById(issued.invitationId);
      expect(row?.accepted_by_user_id, `tour ${round} : accepte par l'invite`).toBe(invitee.userId);
    }
  }, 120_000);
});
