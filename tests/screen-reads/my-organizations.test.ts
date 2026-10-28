/**
 * Tranche 013 — `GET /api/organizations` (contrat `listMyOrganizations`) :
 * AC1 (session), AC2 (aucune organisation), AC3 (creees et rejointes, ordre),
 * AC4 (isolation, US-09).
 *
 * Les organisations et les utilisateurs viennent des vraies routes ; le member
 * d'AC3 est obtenu par le parcours d'invitation reel (003 puis 006). Seul
 * l'horodatage egal est force en base (administration, une seule transaction).
 * Valeurs inventees visiblement fausses (domaines `.test`/`.invalid`).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { listMyOrganizations } from "../../docs/02-architecture/api-contracts/organizations";
import { signUp } from "../helpers/auth";
import { expectError } from "../helpers/billing";
import { asTenant, closeAllPools } from "../helpers/db";
import { createOrganizationFixture } from "../helpers/fixtures";
import { createOrganization } from "../helpers/organizationsApi";
import { resetInvitationFakes, startInvitationFakes, stopInvitationFakes, type InvitationFakes } from "../helpers/invitations";
import { expectExactKeys, getCollections } from "../helpers/consultation";
import { expectCleanErrorBody } from "../helpers/links";
import {
  expectTiedPrecondition,
  fieldOf,
  getMyOrganizations,
  getMyOrganizationsWithCookie,
  INVALID_COOKIE,
  insertTiedOrganizations,
  isIsoUtc,
  joinByInvitation,
  readOrganizationRow,
  recordsOf,
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

describe("AC1 — session (GET /api/organizations)", () => {
  it("AC1 : sans cookie -> 401 UNAUTHENTICATED, corps { code, message } identique au 401 commun", async () => {
    const result = await getMyOrganizations(null);

    expectError(result, 401, "UNAUTHENTICATED", "sans session");
    expect(Object.keys(result.body as object).sort()).toEqual(["code", "message"]);
    const common = await getCollections(null, randomUUID());
    expectError(common, 401, "UNAUTHENTICATED", "401 commun (collections)");
    expect(result.text, "meme corps que le 401 des autres routes").toBe(common.text);
  });

  it("AC1 : cookie invalide -> 401 UNAUTHENTICATED, meme corps que sans cookie", async () => {
    const withoutCookie = await getMyOrganizations(null);
    const invalid = await getMyOrganizationsWithCookie(INVALID_COOKIE);

    expectError(invalid, 401, "UNAUTHENTICATED", "cookie invalide");
    expect(invalid.text).toBe(withoutCookie.text);
  });

  it("AC1 : la chaine de requete n'ouvre rien sans session (?userId=...) -> 401", async () => {
    const owner = await createOrganizationFixture("AC1 requete sans session");

    const result = await getMyOrganizations(null, { query: `?userId=${owner.owner.userId}` });

    expectError(result, 401, "UNAUTHENTICATED", "sans session, avec ?userId");
    expectCleanErrorBody(result, "401", [owner.owner.userId, owner.organizationId, owner.name]);
  });
});

describe("AC2 — aucune organisation", () => {
  it("AC2 : un utilisateur inscrit qui n'a cree ni rejoint aucune organisation -> 200 []", async () => {
    const lonely = await signUp();
    // Des organisations existent ailleurs : la liste vide n'est pas un effet d'une base vide.
    await createOrganizationFixture("AC2 organisation d'un autre");

    const result = await getMyOrganizations(lonely);

    expect(recordsOf(result, "GET /api/organizations")).toEqual([]);
    expect(result.text).toBe("[]");
  });
});

describe("AC3 — organisations creees et rejointes, ordre (D-138 point 2)", () => {
  it("AC3 : owner d'une organisation creee et member d'une organisation rejointe par invitation acceptee -> exactement ces deux, de la plus recente a la plus ancienne (created_at de l'organisation, pas date d'arrivee)", async () => {
    const joined = await createOrganizationFixture("AC3 organisation rejointe <B&B>");
    const me = await signUp();
    const created = await createOrganization(me, { name: "AC3 Équipe \"Veille\" <i>1</i> & co" });
    const ownId = (created.body as { id: string }).id;
    expect(created.status, "arrangement : creation de ma propre organisation").toBe(201);
    await joinByInvitation(fakes, joined, me);

    const ownRow = await readOrganizationRow(ownId);
    const joinedRow = await readOrganizationRow(joined.organizationId);
    expect(ownRow.created_at.getTime(), "precondition : mon organisation est plus recente que celle rejointe").toBeGreaterThan(joinedRow.created_at.getTime());

    const result = await getMyOrganizations(me);
    const items = recordsOf(result, "GET /api/organizations");

    expect(fieldOf(items, "id"), "plus recente d'abord, exactement deux organisations").toEqual([ownId, joined.organizationId]);
    expectExactKeys(items, ["id", "name", "createdAt"], "AC3");
    expect(listMyOrganizations.output.safeParse(items).success, `conforme a listMyOrganizations.output : ${result.text}`).toBe(true);
    for (const [item, row] of [
      [items[0], ownRow],
      [items[1], joinedRow],
    ] as const) {
      expect(isIsoUtc(item?.createdAt), `createdAt ISO UTC suffixe Z : ${String(item?.createdAt)}`).toBe(true);
      expect(item?.createdAt).toBe(row.created_at.toISOString());
      expect(item?.name, "nom tel qu'enregistre").toBe(row.name);
    }
    expect(items[0]?.name).toBe("AC3 Équipe \"Veille\" <i>1</i> & co");
    expect(items[1]?.name).toBe("AC3 organisation rejointe <B&B>");
  });

  it("AC3 : organisations a horodatage egal (meme transaction) -> identifiants decroissants, quel que soit l'ordre d'insertion", async () => {
    const user = await signUp();
    const tied = await insertTiedOrganizations(user.userId);
    expectTiedPrecondition(tied, "organisations");

    const items = recordsOf(await getMyOrganizations(user), "GET /api/organizations");

    expect(fieldOf(items, "id")).toEqual([...tied.insertionOrder].sort().reverse());
    expectExactKeys(items, ["id", "name", "createdAt"], "AC3 egalite");
  });

  it("AC3 : plusieurs organisations creees a des instants differents -> de la plus recente a la plus ancienne", async () => {
    const user = await signUp();
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const created = await createOrganization(user, { name: `AC3 ordre ${index}` });
      expect(created.status, `arrangement : creation ${index}`).toBe(201);
      ids.push((created.body as { id: string }).id);
    }

    const items = recordsOf(await getMyOrganizations(user), "GET /api/organizations");

    expect(fieldOf(items, "id")).toEqual([...ids].reverse());
  });
});

describe("AC4 — isolation (US-09)", () => {
  it("AC4 : une organisation d'un autre utilisateur, creee avant et apres la mienne, n'apparait jamais", async () => {
    const other = await signUp();
    const before = await createOrganization(other, { name: "AC4 autre avant" });
    const me = await signUp();
    const mine = await createOrganization(me, { name: "AC4 la mienne" });
    const after = await createOrganization(other, { name: "AC4 autre apres" });
    const beforeId = (before.body as { id: string }).id;
    const afterId = (after.body as { id: string }).id;
    const mineId = (mine.body as { id: string }).id;

    const mineList = recordsOf(await getMyOrganizations(me), "ma liste");
    const otherList = recordsOf(await getMyOrganizations(other), "liste de l'autre");

    expect(fieldOf(mineList, "id")).toEqual([mineId]);
    expect(fieldOf(otherList, "id")).toEqual([afterId, beforeId]);
  });

  it("AC4 : ?userId=<autre>, ?organizationId=<autre> et en-tetes d'identite sont ignores -> reponse identique a celle sans parametre", async () => {
    const other = await signUp();
    const otherOrg = await createOrganization(other, { name: "AC4 organisation de l'autre" });
    const otherOrgId = (otherOrg.body as { id: string }).id;
    const me = await signUp();
    await createOrganization(me, { name: "AC4 ma seule organisation" });
    const plain = await getMyOrganizations(me);
    expect(recordsOf(plain, "sans parametre"), "precondition : une seule organisation, la mienne").toHaveLength(1);

    const variants: { query?: string; extraHeaders?: Record<string, string> }[] = [
      { query: `?userId=${other.userId}` },
      { query: `?organizationId=${otherOrgId}` },
      { query: `?userId=${other.userId}&organizationId=${otherOrgId}&user_id=${other.userId}&limit=100&sort=asc` },
      { extraHeaders: { "x-user-id": other.userId, "x-organization-id": otherOrgId } },
      { query: `?userId=${other.userId}`, extraHeaders: { "x-user-id": other.userId, authorization: `Bearer ${other.userId}` } },
    ];
    for (const variant of variants) {
      const result = await getMyOrganizations(me, variant);

      expect(result.status, JSON.stringify(variant)).toBe(200);
      expect(result.text, `identique a la reponse sans parametre : ${JSON.stringify(variant)}`).toBe(plain.text);
      expect(result.text).not.toContain(otherOrgId);
    }
  });

  it("AC4 : sous signet_app, signet.organizations_for_user(<moi>) avec mon contexte ne rend que mes organisations", async () => {
    const other = await createOrganizationFixture("AC4 base : autre");
    const mine = await createOrganizationFixture("AC4 base : la mienne");

    const rows = await asTenant({ userId: mine.owner.userId }, async (client) => {
      const { rows: read } = await client.query<{ id: string }>("SELECT id FROM signet.organizations_for_user($1)", [mine.owner.userId]);
      return read;
    });

    expect(rows.map((r) => r.id)).toEqual([mine.organizationId]);
    expect(rows.map((r) => r.id)).not.toContain(other.organizationId);
  });
});
