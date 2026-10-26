/**
 * Tranche 004 — creation d'une collection (US-05.1, US-05.3) : AC1 a AC4 et AC7,
 * par la route reelle `POST /api/organizations/:organizationId/collections`.
 *
 * Utilisateurs et organisations crees par les vraies routes (inscription
 * better-auth, POST /api/organizations) ; un `member` est obtenu par une ligne
 * forcee en base (tests/helpers/collections.ts). Chaque test cree sa propre
 * organisation : aucune assertion ne porte sur un total global.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { createCollection } from "../../docs/02-architecture/api-contracts/collections";
import { closeAllPools } from "../helpers/db";
import { createOrganizationFixture } from "../helpers/fixtures";
import { expectError, expectStatus, type HttpResult } from "../helpers/billing";
import {
  createMemberSession,
  insertCollectionDirect,
  nameOfLength,
  postCollection,
  postCollectionWithCookie,
  readCollections,
  uniqueCollectionName,
} from "../helpers/collections";
import { signUp } from "../helpers/auth";

afterAll(async () => {
  await closeAllPools();
});

/** Valide le corps d'un 201 contre le schema de sortie du contrat ; echoue avec le corps brut sinon. */
function parseCreated(result: HttpResult, label: string): { id: string; organizationId: string; name: string; createdAt: string } {
  expectStatus(result, 201, label);
  const parsed = createCollection.output.safeParse(result.body);
  if (!parsed.success) {
    throw new Error(`${label} : le corps ne respecte pas createCollection.output. Corps brut : ${result.text}`);
  }
  return parsed.data;
}

describe("AC1 — creation nominale par l'owner (US-05.1)", () => {
  it("AC1 : l'owner cree une collection -> 201, corps conforme a createCollection.output, ligne en base avec organization_id et created_by_user_id", async () => {
    const org = await createOrganizationFixture("AC1 nominal");
    const name = uniqueCollectionName();
    const before = Date.now();

    const result = await postCollection(org.owner, org.organizationId, { name });
    const created = parseCreated(result, "creation par l'owner");
    const after = Date.now();

    expect(created.organizationId).toBe(org.organizationId);
    expect(created.name).toBe(name);
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    const createdAtMs = Date.parse(created.createdAt);
    expect(createdAtMs, "createdAt est l'instant de la creation").toBeGreaterThanOrEqual(before - 60_000);
    expect(createdAtMs).toBeLessThanOrEqual(after + 60_000);

    const rows = await readCollections(org.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: created.id,
      organization_id: org.organizationId,
      created_by_user_id: org.owner.userId,
      name,
    });
  });

  it("AC1 : un organizationId en majuscules dans le chemin designe la meme organisation (forme canonique en minuscules en reponse et en base)", async () => {
    const org = await createOrganizationFixture("AC1 majuscules");
    const name = uniqueCollectionName();

    const result = await postCollection(org.owner, org.organizationId.toUpperCase(), { name });
    const created = parseCreated(result, "organizationId en majuscules dans le chemin");

    expect(created.organizationId).toBe(org.organizationId.toLowerCase());
    const rows = await readCollections(org.organizationId);
    expect(rows.map((r) => r.id)).toEqual([created.id]);
    expect(rows[0]?.organization_id).toBe(org.organizationId.toLowerCase());
  });
});

describe("AC2 — creation par un member (US-05.1)", () => {
  it("AC2 : un member de l'organisation cree une collection -> 201 (aucun 403), created_by_user_id = ce member", async () => {
    const org = await createOrganizationFixture("AC2 member");
    const member = await createMemberSession(org.organizationId);
    const name = uniqueCollectionName();

    const result = await postCollection(member, org.organizationId, { name });
    const created = parseCreated(result, "creation par un member");

    expect(created.organizationId).toBe(org.organizationId);
    const rows = await readCollections(org.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: created.id, created_by_user_id: member.userId, name });
    expect(rows[0]?.created_by_user_id).not.toBe(org.owner.userId);
  });

  it("AC2 : les deux roles sont acceptes dans la meme organisation, chacun est l'auteur de sa collection", async () => {
    const org = await createOrganizationFixture("AC2 deux roles");
    const member = await createMemberSession(org.organizationId);
    const ownerName = uniqueCollectionName("Owner");
    const memberName = uniqueCollectionName("Member");

    const byOwner = parseCreated(await postCollection(org.owner, org.organizationId, { name: ownerName }), "owner");
    const byMember = parseCreated(await postCollection(member, org.organizationId, { name: memberName }), "member");

    const rows = await readCollections(org.organizationId);
    expect(rows.find((r) => r.id === byOwner.id)?.created_by_user_id).toBe(org.owner.userId);
    expect(rows.find((r) => r.id === byMember.id)?.created_by_user_id).toBe(member.userId);
    expect(rows).toHaveLength(2);
  });
});

describe("AC3 — unicite insensible a la casse et aux espaces de bord (US-05.3, ERD §6.1)", () => {
  it("AC3 : apres Veille, veille, VEILLE, '  Veille  ' et ' vEiLlE' -> 409 COLLECTION_NAME_TAKEN, aucune ligne de plus", async () => {
    const org = await createOrganizationFixture("AC3 variantes");
    const base = `Veille${Date.now()}`;
    parseCreated(await postCollection(org.owner, org.organizationId, { name: base }), "premiere creation");

    const variants = [base.toLowerCase(), base.toUpperCase(), `  ${base}  `, ` ${base.slice(0, 3).toLowerCase()}${base.slice(3).toUpperCase()}`];
    for (const variant of variants) {
      const result = await postCollection(org.owner, org.organizationId, { name: variant });
      expectError(result, 409, "COLLECTION_NAME_TAKEN", `variante ${JSON.stringify(variant)}`);
    }

    expect(await readCollections(org.organizationId)).toHaveLength(1);
  });

  it("AC3 : le rejeu exact du meme nom -> 409 COLLECTION_NAME_TAKEN (non idempotente)", async () => {
    const org = await createOrganizationFixture("AC3 rejeu");
    const name = uniqueCollectionName();
    parseCreated(await postCollection(org.owner, org.organizationId, { name }), "premiere creation");

    const replay = await postCollection(org.owner, org.organizationId, { name });

    expectError(replay, 409, "COLLECTION_NAME_TAKEN", "rejeu exact");
    expect(await readCollections(org.organizationId)).toHaveLength(1);
  });

  it("AC3 : un member se heurte au nom pris par l'owner (unicite par organisation, pas par auteur)", async () => {
    const org = await createOrganizationFixture("AC3 member");
    const member = await createMemberSession(org.organizationId);
    const name = uniqueCollectionName();
    parseCreated(await postCollection(org.owner, org.organizationId, { name }), "creation par l'owner");

    const result = await postCollection(member, org.organizationId, { name: name.toUpperCase() });

    expectError(result, 409, "COLLECTION_NAME_TAKEN", "member, meme nom en majuscules");
  });

  it("AC3 : le message du 409 est fixe et ne reprend pas le nom", async () => {
    const org = await createOrganizationFixture("AC3 message");
    const firstName = `Zorglub${Date.now()}Alpha`;
    const secondName = `Quuxplugh${Date.now()}Beta`;
    parseCreated(await postCollection(org.owner, org.organizationId, { name: firstName }), "creation Alpha");
    parseCreated(await postCollection(org.owner, org.organizationId, { name: secondName }), "creation Beta");

    const first = await postCollection(org.owner, org.organizationId, { name: firstName.toUpperCase() });
    const second = await postCollection(org.owner, org.organizationId, { name: secondName.toUpperCase() });

    expectError(first, 409, "COLLECTION_NAME_TAKEN", "409 Alpha");
    expectError(second, 409, "COLLECTION_NAME_TAKEN", "409 Beta");
    expect(first.text, "message identique d'un nom a l'autre").toBe(second.text);
    expect(first.text.toLowerCase()).not.toContain(firstName.toLowerCase());
    expect(second.text.toLowerCase()).not.toContain(secondName.toLowerCase());
    expect(first.text, "aucun detail SQL").not.toMatch(/collection_org_name_ci_idx|duplicate key|23505/i);
  });

  it("AC3 : un nom deja pris en base (insere hors API) est refuse de la meme facon", async () => {
    const org = await createOrganizationFixture("AC3 insere");
    const name = uniqueCollectionName();
    await insertCollectionDirect({ organizationId: org.organizationId, name, createdByUserId: org.owner.userId });

    const result = await postCollection(org.owner, org.organizationId, { name: ` ${name.toUpperCase()} ` });

    expectError(result, 409, "COLLECTION_NAME_TAKEN", "nom pris en base");
    expect(await readCollections(org.organizationId)).toHaveLength(1);
  });
});

describe("AC4 — validation du nom (contrat, ERD §6.1)", () => {
  const invalidBodies: Array<[string, unknown]> = [
    ["name absent", {}],
    ["name null", { name: null }],
    ["name nombre", { name: 424242 }],
    ["name booleen", { name: true }],
    ["name tableau", { name: ["Veille"] }],
    ["name chaine vide", { name: "" }],
    ["name fait d'espaces", { name: "     " }],
    ["name de 101 caracteres", { name: nameOfLength(101, "Z") }],
    ["name de 101 caracteres apres trim", { name: `  ${nameOfLength(101, "Y")}  ` }],
    ["corps tableau JSON", ["Veille"]],
    ["corps nombre JSON", 42],
    ["corps null JSON", null],
    ["corps non JSON", "ceci-n'est-pas-du-json-qqq{"],
  ];

  it.each(invalidBodies)("AC4 : %s -> 422 VALIDATION_FAILED, aucune ligne, la valeur soumise n'est pas reprise", async (label, payload) => {
    const org = await createOrganizationFixture("AC4 invalide");

    const result = await postCollection(org.owner, org.organizationId, typeof payload === "string" ? payload : JSON.stringify(payload));

    expectError(result, 422, "VALIDATION_FAILED", label);
    expect(await readCollections(org.organizationId), `${label} : aucune ligne creee`).toEqual([]);
    for (const forbidden of ["ZZZZZ", "YYYYY", "424242", "ceci-n'est-pas", "qqq{"]) {
      expect(result.text, `${label} : le 422 ne reprend pas la valeur soumise`).not.toContain(forbidden);
    }
  });

  it("AC4 : exactement 100 caracteres -> 201", async () => {
    const org = await createOrganizationFixture("AC4 cent");
    const name = nameOfLength(100, "a");

    const created = parseCreated(await postCollection(org.owner, org.organizationId, { name }), "100 caracteres");

    expect(created.name).toBe(name);
    expect((await readCollections(org.organizationId)).map((r) => r.name)).toEqual([name]);
  });

  it("AC4 : '  Veille interne  ' -> 201 avec name = 'Veille interne' en reponse et en base", async () => {
    const org = await createOrganizationFixture("AC4 trim");

    const created = parseCreated(await postCollection(org.owner, org.organizationId, { name: "  Veille interne  " }), "nom entoure d'espaces");

    expect(created.name).toBe("Veille interne");
    expect((await readCollections(org.organizationId)).map((r) => r.name)).toEqual(["Veille interne"]);
  });

  it("AC4 : 100 caracteres entoures d'espaces -> 201, enregistres sans les espaces", async () => {
    const org = await createOrganizationFixture("AC4 cent trim");
    const core = nameOfLength(100, "b");

    const created = parseCreated(await postCollection(org.owner, org.organizationId, { name: `   ${core}   ` }), "100 caracteres entoures d'espaces");

    expect(created.name).toBe(core);
    expect((await readCollections(org.organizationId)).map((r) => r.name)).toEqual([core]);
  });

  it("AC4 : organizationId du chemin qui n'est pas un UUID -> 422 VALIDATION_FAILED", async () => {
    const org = await createOrganizationFixture("AC4 chemin");

    const result = await postCollection(org.owner, "pas-un-uuid", { name: uniqueCollectionName() });

    expectError(result, 422, "VALIDATION_FAILED", "organizationId malforme");
  });

  it("AC4 : la validation precede l'appartenance (nom invalide sur une organisation etrangere -> 422, pas 404)", async () => {
    const org = await createOrganizationFixture("AC4 ordre");
    const stranger = await signUp();

    const result = await postCollection(stranger, org.organizationId, { name: "" });

    expectError(result, 422, "VALIDATION_FAILED", "nom invalide par un non-membre");
  });
});

describe("AC7 — session", () => {
  it("AC7 : sans session -> 401 UNAUTHENTICATED, aucune ligne", async () => {
    const org = await createOrganizationFixture("AC7 sans session");

    const result = await postCollection(null, org.organizationId, { name: uniqueCollectionName() });

    expectError(result, 401, "UNAUTHENTICATED", "sans session");
    expect(await readCollections(org.organizationId)).toEqual([]);
  });

  it("AC7 : cookie de session invalide -> 401 UNAUTHENTICATED, aucune ligne", async () => {
    const org = await createOrganizationFixture("AC7 cookie invalide");
    const cookieName = org.owner.cookie.split("=")[0] ?? "";
    expect(cookieName.length, "precondition : nom du cookie de session lisible").toBeGreaterThan(0);

    const result = await postCollectionWithCookie(org.organizationId, `${cookieName}=${randomUUID()}.invalide`, { name: uniqueCollectionName() });

    expectError(result, 401, "UNAUTHENTICATED", "cookie invalide");
    expect(await readCollections(org.organizationId)).toEqual([]);
  });

  it("AC7 : l'authentification precede la validation (sans session et corps invalide -> 401)", async () => {
    const org = await createOrganizationFixture("AC7 ordre");

    const result = await postCollection(null, org.organizationId, { name: "" });

    expectError(result, 401, "UNAUTHENTICATED", "sans session, nom vide");
  });
});
