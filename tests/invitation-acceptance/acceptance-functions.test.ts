/**
 * Tranche 006 — les fonctions `signet.lookup_invitation(bytea)` et
 * `signet.accept_invitation(bytea)` appelees directement, sous le role applicatif
 * `signet_app` (jamais un superutilisateur : il contournerait la RLS).
 *
 * AC4 (changement d'heure, bornes de 168 h), AC5 (b, c, d), AC6 (deux transactions),
 * AC7 (refus d'adresse porte par la base), AC8, AC9, AC12 (SG002, entrees hors bornes).
 * Les arrangements (invitations forcees, dates, adresse du compte) passent par la
 * connexion d'administration.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { signUp } from "../helpers/auth";
import { asBypassRls, asTenant, closeAllPools, getAppPool } from "../helpers/db";
import { addMemberDirect, createOrganizationFixture } from "../helpers/fixtures";
import { inviteeEmail } from "../helpers/invitations";
import {
  WRONG_REASON_CODES,
  acceptViaDb,
  failureOf,
  forgeInvitation,
  forgeInvitationWindow,
  inAppTransaction,
  lookupViaDb,
  openAppTransaction,
  readMembersOfOrganization,
  readMembersOfUser,
  settledWithin,
  type AppContext,
} from "../helpers/invitations-accept";
import { readInvitationById } from "../helpers/invitations-db";

afterAll(async () => {
  await closeAllPools();
});

const HOUR = 3600;

// ---------------------------------------------------------------------------
// AC4 — changement d'heure et bornes de 168 h (D-091)
// ---------------------------------------------------------------------------

/**
 * Fuseaux POSIX `AAA0BBB,J<debut>,J<fin>` dont l'heure d'ete COMMENCE un jour donne :
 * `now() + interval '7 days'` y fait alors 167 h sur une fenetre qui contient ce jour.
 * Construits par le test a partir de la date du jour (offsets en jours, negatifs =
 * passe) : discriminants quelle que soit la date d'execution, ce que le dernier
 * dimanche d'octobre d'Europe/Paris n'est pas.
 */
function springForwardZones(dayOffsets: number[]): string[] {
  return dayOffsets.map((offset) => {
    const day = new Date(Date.now() + offset * 24 * HOUR * 1000);
    const startOfYear = Date.UTC(day.getUTCFullYear(), 0, 1);
    const dayOfYear = Math.floor((Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) - startOfYear) / (24 * HOUR * 1000)) + 1;
    const start = Math.min(Math.max(dayOfYear, 2), 364);
    return `AAA0BBB,J${start},J${start > 330 ? 30 : start + 30}`;
  });
}

/** Premier fuseau candidat sous lequel `created + interval '7 days'` est 167 h apres `created` (fenetre `agoSeconds`). */
async function pickDiscriminatingZone(client: PoolClient, agoSeconds: number, dayOffsets: number[]): Promise<string> {
  for (const zone of springForwardZones(dayOffsets)) {
    await client.query("SELECT set_config('TimeZone', $1, true)", [zone]);
    const { rows } = await client.query<{ wall: number }>(
      `SELECT extract(epoch FROM ((c + interval '7 days') - c))::float8 AS wall
         FROM (SELECT now() - make_interval(secs => $1::float8) AS c) AS s`,
      [agoSeconds],
    );
    if (rows[0]?.wall === 7 * 24 * HOUR - HOUR) return zone;
  }
  throw new Error("precondition du test : aucun fuseau candidat ne donne 167 h sur la fenetre (revoir springForwardZones)");
}

describe("AC4 — changement d'heure et bornes de 168 h (D-091)", () => {
  it("AC4 : invitation creee juste avant un changement d'heure et acceptee pendant sa validite, session reglee sur un fuseau discriminant (167 h) et sur Europe/Paris -> acceptee, jamais 23514", async () => {
    for (const mode of ["fuseau discriminant", "Europe/Paris"] as const) {
      const email = inviteeEmail();
      const forged = await forgeInvitationWindow({ agoSeconds: 2 * HOUR, lifetimeSeconds: 168 * HOUR, email, label: `AC4 ${mode}` });
      const invitee = await signUp({ email });

      const accepted = await inAppTransaction(
        { userId: invitee.userId, timeZone: "UTC" },
        async (client) => {
          const zone = mode === "Europe/Paris" ? "Europe/Paris" : await pickDiscriminatingZone(client, 2 * HOUR, [2, 3, 4, 5]);
          await client.query("SELECT set_config('TimeZone', $1, true)", [zone]);
          return acceptViaDb(client, forged.tokenHash);
        },
        "commit",
      );

      expect(accepted, `${mode} : accept_invitation retourne l'organisation (sans 23514)`).toEqual([forged.org.organizationId]);
      expect((await readInvitationById(forged.row.id))?.accepted_by_user_id).toBe(invitee.userId);
    }
  });

  it("AC4 : expires_at = created_at + 168 h exactement : encore acceptable a 167 h 59, expiree a 168 h, sous Europe/Paris et sous un fuseau discriminant", async () => {
    for (const mode of ["Europe/Paris", "fuseau discriminant"] as const) {
      const emailOk = inviteeEmail();
      const emailLate = inviteeEmail();
      const org = await createOrganizationFixture(`Org AC4 bornes ${mode}`);
      const justInside = await forgeInvitationWindow({ org, email: emailOk, agoSeconds: 167 * HOUR + 59 * 60, lifetimeSeconds: 168 * HOUR });
      const atLimit = await forgeInvitationWindow({ org, email: emailLate, agoSeconds: 168 * HOUR, lifetimeSeconds: 168 * HOUR });
      const inviteeOk = await signUp({ email: emailOk });
      const inviteeLate = await signUp({ email: emailLate });

      const outcome = await inAppTransaction(
        { userId: inviteeOk.userId, timeZone: "UTC" },
        async (client) => {
          const zone = mode === "Europe/Paris" ? "Europe/Paris" : await pickDiscriminatingZone(client, 167 * HOUR + 59 * 60, [-2, -3, -4, -5]);
          await client.query("SELECT set_config('TimeZone', $1, true)", [zone]);
          return acceptViaDb(client, justInside.tokenHash);
        },
        "commit",
      );
      const late = await inAppTransaction({ userId: inviteeLate.userId, timeZone: mode === "Europe/Paris" ? "Europe/Paris" : "UTC" }, async (client) => ({
        accepted: await acceptViaDb(client, atLimit.tokenHash),
        lookup: (await lookupViaDb(client, atLimit.tokenHash)).rows.map((r) => r.state),
      }));

      expect(outcome, `${mode} : a 167 h 59 l'invitation est acceptable`).toEqual([org.organizationId]);
      expect(late.accepted, `${mode} : a 168 h l'invitation est expiree, rien n'est consomme`).toEqual([]);
      expect(late.lookup, `${mode} : lookup_invitation dit expired`).toEqual(["expired"]);
      expect((await readInvitationById(atLimit.row.id))?.accepted_at).toBeNull();
      expect(await readMembersOfUser(inviteeLate.userId)).toEqual([]);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// AC5 — isolation tenant en base
// ---------------------------------------------------------------------------

describe("AC5 (b) — accept_invitation sous contexte etranger force (signet_app)", () => {
  it("AC5 (b) : contexte B, utilisateur invite, jeton d'une invitation de A -> member cree dans A (contexte ambiant ignore), rien dans B", async () => {
    const orgB = await createOrganizationFixture("Org AC5b B");
    const email = inviteeEmail();
    const forged = await forgeInvitation({ email, label: "AC5b A" });
    const invitee = await signUp({ email });
    const membersOfBBefore = await readMembersOfOrganization(orgB.organizationId);

    const accepted = await inAppTransaction({ organizationId: orgB.organizationId, userId: invitee.userId }, (client) => acceptViaDb(client, forged.tokenHash), "commit");

    expect(accepted).toEqual([forged.org.organizationId]);
    expect(await readMembersOfUser(invitee.userId)).toEqual([
      { organization_id: forged.org.organizationId, user_id: invitee.userId, role: "member" },
    ]);
    expect(await readMembersOfOrganization(orgB.organizationId), "rien dans B").toEqual(membersOfBBefore);
  });

  it("AC5 (b) : contexte B, jeton d'une invitation de B adressee a quelqu'un d'autre -> rien n'est consomme", async () => {
    const orgB = await createOrganizationFixture("Org AC5b B autre");
    const forgedB = await forgeInvitation({ org: orgB, label: "AC5b B" });
    const invitee = await signUp();

    const accepted = await inAppTransaction({ organizationId: orgB.organizationId, userId: invitee.userId }, (client) => acceptViaDb(client, forgedB.tokenHash), "commit");

    expect(accepted).toEqual([]);
    expect((await readInvitationById(forgedB.row.id))?.accepted_at).toBeNull();
    expect(await readMembersOfUser(invitee.userId)).toEqual([]);
  });
});

describe("AC5 (c) — lookup_invitation sous contexte etranger force (signet_app)", () => {
  it("AC5 (c) : ne renvoie que organization_name, email, state de l'invitation designee, jamais de ligne de l'organisation du contexte ; sans empreinte valide, zero ligne", async () => {
    const orgB = await createOrganizationFixture("Org AC5c B");
    const email = inviteeEmail();
    const forged = await forgeInvitation({ email, label: "AC5c A" });
    await forgeInvitation({ org: orgB, label: "AC5c B" });
    const viewer = await signUp();
    const foreign = { organizationId: orgB.organizationId, userId: viewer.userId };

    const designated = await asTenant(foreign, (client) => lookupViaDb(client, forged.tokenHash));
    const unknown = await asTenant(foreign, (client) => lookupViaDb(client, randomBytes(32)));
    const tooShort = await asTenant(foreign, (client) => lookupViaDb(client, randomBytes(31)));
    const missing = await asTenant(foreign, (client) => lookupViaDb(client, null));

    expect(designated.columns, "colonnes de retour exactes").toEqual(["organization_name", "email", "state"]);
    expect(designated.rows).toEqual([{ organization_name: forged.org.name, email, state: "pending" }]);
    expect(unknown.rows, "empreinte inconnue").toEqual([]);
    expect(tooShort.rows, "empreinte de 31 octets").toEqual([]);
    expect(missing.rows, "empreinte NULL").toEqual([]);
  });

  it("AC5 (c) : state derive — pending, expired, accepted", async () => {
    const viewer = await signUp();
    const pending = await forgeInvitation({ label: "AC5c pending" });
    const expired = await forgeInvitationWindow({ agoSeconds: 2 * 24 * HOUR, lifetimeSeconds: 2 * 24 * HOUR - 1, label: "AC5c expired" });
    const accepted = await forgeInvitation({ acceptedBy: viewer.userId, label: "AC5c accepted" });

    const states = await asTenant({ userId: viewer.userId }, async (client) => ({
      pending: (await lookupViaDb(client, pending.tokenHash)).rows.map((r) => r.state),
      expired: (await lookupViaDb(client, expired.tokenHash)).rows.map((r) => r.state),
      accepted: (await lookupViaDb(client, accepted.tokenHash)).rows.map((r) => r.state),
    }));

    expect(states).toEqual({ pending: ["pending"], expired: ["expired"], accepted: ["accepted"] });
  });
});

describe("AC5 (d) — aucune ecriture directe, invitation invisible a l'invite devenu member", () => {
  it("AC5 (d) : UPDATE invitation direct refuse (42501) sous le contexte de l'owner comme sous celui du member ; invitation de A invisible au member (temoin : visible a l'owner)", async () => {
    const email = inviteeEmail();
    const forged = await forgeInvitation({ email, label: "AC5d" });
    const invitee = await signUp({ email });
    await inAppTransaction({ userId: invitee.userId }, (client) => acceptViaDb(client, forged.tokenHash), "commit");
    const owner = { organizationId: forged.org.organizationId, userId: forged.org.owner.userId };
    const member = { organizationId: forged.org.organizationId, userId: invitee.userId };

    const ownerView = await asTenant(owner, async (client) => (await client.query("SELECT id FROM invitation WHERE id = $1", [forged.row.id])).rowCount);
    const memberView = await asTenant(member, async (client) => (await client.query("SELECT id FROM invitation WHERE id = $1", [forged.row.id])).rowCount);
    expect(ownerView, "temoin : l'owner voit l'invitation").toBe(1);
    expect(memberView, "le member ne voit pas l'invitation").toBe(0);

    for (const [who, ctx] of [["owner", owner], ["member", member]] as const) {
      const failure = await asTenant(ctx, (client) =>
        failureOf(() => client.query("UPDATE invitation SET accepted_at = NULL, accepted_by_user_id = NULL WHERE id = $1", [forged.row.id])),
      );
      expect(failure, `UPDATE direct sous ${who} doit etre refuse`).toBeDefined();
      expect(WRONG_REASON_CODES, `refus pour la mauvaise raison : ${failure?.code} ${failure?.message}`).not.toContain(failure?.code);
      expect(failure?.code, `UPDATE direct sous ${who} : pas de privilege`).toBe("42501");
    }
    expect((await readInvitationById(forged.row.id))?.accepted_by_user_id, "l'acceptation est intacte").toBe(invitee.userId);
  });
});

// ---------------------------------------------------------------------------
// AC6 — deux transactions ouvertes
// ---------------------------------------------------------------------------

describe("AC6 — consommation atomique (deux transactions)", () => {
  it("AC6 : deux transactions ouvertes appellent accept_invitation, la seconde attend le COMMIT de la premiere puis ne retourne rien ; une seule ligne member, un seul accepted_at", async () => {
    const email = inviteeEmail();
    const forged = await forgeInvitation({ email, label: "AC6 deux transactions" });
    const invitee = await signUp({ email });
    const ctx: AppContext = { userId: invitee.userId };
    const first = await getAppPool().connect();
    const second = await getAppPool().connect();
    try {
      await openAppTransaction(first, ctx);
      await openAppTransaction(second, ctx);
      const firstResult = await acceptViaDb(first, forged.tokenHash);
      expect(firstResult, "la premiere transaction consomme").toEqual([forged.org.organizationId]);

      const secondCall = acceptViaDb(second, forged.tokenHash);
      expect(await settledWithin(secondCall, 800), "la seconde attend le verrou de ligne tant que la premiere n'a pas valide").toBe("pending");
      await first.query("COMMIT");
      const secondResult = await secondCall;
      await second.query("COMMIT");

      expect(secondResult, "la seconde, re-evaluant le predicat, ne retourne rien").toEqual([]);
    } finally {
      await first.query("ROLLBACK").catch(() => undefined);
      await second.query("ROLLBACK").catch(() => undefined);
      first.release();
      second.release();
    }
    expect(await readMembersOfUser(invitee.userId), "une seule ligne member").toHaveLength(1);
    expect((await readInvitationById(forged.row.id))?.accepted_by_user_id).toBe(invitee.userId);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// AC7 — l'adresse est verifiee par la base
// ---------------------------------------------------------------------------

describe("AC7 — le refus d'adresse est porte par la base", () => {
  it("AC7 : accept_invitation sous un compte d'une autre adresse ne consomme rien et ne cree aucun member ; sous le bon compte, elle consomme", async () => {
    const email = inviteeEmail();
    const forged = await forgeInvitation({ email, label: "AC7 base" });
    const intruder = await signUp();
    const invitee = await signUp({ email });

    const refused = await inAppTransaction({ userId: intruder.userId }, (client) => acceptViaDb(client, forged.tokenHash), "commit");

    expect(refused, "aucune ligne").toEqual([]);
    expect((await readInvitationById(forged.row.id))?.accepted_at, "rien consomme").toBeNull();
    expect(await readMembersOfUser(intruder.userId)).toEqual([]);
    const accepted = await inAppTransaction({ userId: invitee.userId }, (client) => acceptViaDb(client, forged.tokenHash), "commit");
    expect(accepted, "temoin positif : le bon compte consomme").toEqual([forged.org.organizationId]);
  });

  it("AC7 : la comparaison d'adresse est insensible a la casse, en base (adresse du compte en casse mixte)", async () => {
    const email = inviteeEmail();
    const forged = await forgeInvitation({ email, label: "AC7 casse base" });
    const invitee = await signUp({ email });
    await asBypassRls((client) => client.query("UPDATE app_user SET email = $2 WHERE id = $1", [invitee.userId, email.toUpperCase()]));

    const accepted = await inAppTransaction({ userId: invitee.userId }, (client) => acceptViaDb(client, forged.tokenHash), "commit");

    expect(accepted).toEqual([forged.org.organizationId]);
  });
});

// ---------------------------------------------------------------------------
// AC8 — deja membre
// ---------------------------------------------------------------------------

describe("AC8 — deja membre (P-5)", () => {
  it("AC8 : accept_invitation leve SG008 pour un compte deja membre ; toute l'operation est annulee, l'invitation reste non consommee", async () => {
    const email = inviteeEmail();
    const forged = await forgeInvitation({ email, label: "AC8 base" });
    const invitee = await signUp({ email });
    await addMemberDirect({ organizationId: forged.org.organizationId, userId: invitee.userId, role: "member" });

    const failure = await failureOf(() => inAppTransaction({ userId: invitee.userId }, (client) => acceptViaDb(client, forged.tokenHash), "commit"));

    expect(failure?.code, `${failure?.message}`).toBe("SG008");
    expect((await readInvitationById(forged.row.id))?.accepted_at, "non consommee").toBeNull();
    expect(await readMembersOfUser(invitee.userId), "aucune ligne de plus").toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC9 — compte disparu
// ---------------------------------------------------------------------------

describe("AC9 — compte disparu", () => {
  it("AC9 : app.user_id sans ligne app_user -> rien n'est consomme, aucun member cree (zero ligne, ou SG002 / 23503)", async () => {
    const forged = await forgeInvitation({ label: "AC9 base" });
    const ghost = randomUUID();

    const outcome = await inAppTransaction({ userId: ghost }, async (client) => {
      try {
        return { rows: await acceptViaDb(client, forged.tokenHash), code: undefined };
      } catch (error) {
        return { rows: [] as string[], code: (error as { code?: string }).code };
      }
    });

    expect(outcome.rows, "aucune organisation retournee").toEqual([]);
    if (outcome.code !== undefined) expect(["SG002", "23503"], `code SQL inattendu : ${outcome.code}`).toContain(outcome.code);
    expect((await readInvitationById(forged.row.id))?.accepted_at).toBeNull();
    expect(await readMembersOfUser(ghost)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC12 — garde d'identite et entrees hors bornes
// ---------------------------------------------------------------------------

describe("AC12 — garde d'identite SG002 et empreintes hors bornes", () => {
  it("AC12 : lookup_invitation et accept_invitation levent SG002 sans app.user_id (meme avec un contexte d'organisation et une empreinte valide)", async () => {
    const forged = await forgeInvitation({ label: "AC12 SG002" });

    for (const [name, ctx] of [
      ["sans contexte", {}],
      ["organisation seule", { organizationId: forged.org.organizationId }],
    ] as const) {
      const lookup = await asTenant(ctx, (client) => failureOf(() => lookupViaDb(client, forged.tokenHash)));
      const accept = await asTenant(ctx, (client) => failureOf(() => acceptViaDb(client, forged.tokenHash)));
      expect(lookup?.code, `lookup_invitation ${name} : ${lookup?.message}`).toBe("SG002");
      expect(accept?.code, `accept_invitation ${name} : ${accept?.message}`).toBe("SG002");
    }
    expect((await readInvitationById(forged.row.id))?.accepted_at).toBeNull();
  });

  it("AC12 : empreinte NULL, vide, de 31 ou de 33 octets -> zero ligne, sans erreur, pour les deux fonctions", async () => {
    const invitee = await signUp();
    const forged = await forgeInvitation({ label: "AC12 bornes" });

    const outcomes = await asTenant({ userId: invitee.userId }, async (client) => {
      const out: Array<{ lookup: number; accept: number }> = [];
      for (const hash of [null, Buffer.alloc(0), randomBytes(31), randomBytes(33)]) {
        out.push({ lookup: (await lookupViaDb(client, hash)).rows.length, accept: (await acceptViaDb(client, hash)).length });
      }
      return out;
    });

    expect(outcomes).toEqual(Array.from({ length: 4 }, () => ({ lookup: 0, accept: 0 })));
    expect((await readInvitationById(forged.row.id))?.accepted_at).toBeNull();
  });
});
