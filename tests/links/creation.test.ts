/**
 * Tranche 005 — ajout d'un lien (US-06.1, US-06.3) : AC1, AC2 et AC11, par la
 * route reelle `POST /api/organizations/:organizationId/collections/:collectionId/links`.
 *
 * Utilisateurs et organisations crees par les vraies routes ; collections par la
 * route de la tranche 004 ; un `member` est obtenu par une ligne forcee en base.
 * Chaque test cree sa propre organisation : aucune assertion ne porte sur un
 * total global, et apres chaque scenario qui ecrit `link_count = count(*)` (AC9 a).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { addLink } from "../../docs/02-architecture/api-contracts/links";
import { signUp } from "../helpers/auth";
import { closeAllPools } from "../helpers/db";
import { createOrganizationFixture } from "../helpers/fixtures";
import { expectError, expectStatus, type HttpResult } from "../helpers/billing";
import { readLinkCount } from "../helpers/billing-db";
import { createMemberSession } from "../helpers/collections";
import {
  closeLinkPools,
  countLinks,
  createCollectionViaApi,
  databaseNow,
  expectCounterAligned,
  expectUnchanged,
  linkState,
  postLink,
  postLinkWithCookie,
  readLinkById,
  readLinks,
  uniqueUrl,
} from "../helpers/links";

afterAll(async () => {
  await closeLinkPools();
  await closeAllPools();
});

interface Created {
  id: string;
  collectionId: string;
  url: string;
  title: string;
  addedBy: string;
  createdAt: string;
}

/** Valide le corps d'un 201 contre le schema de sortie du contrat ; echoue avec le corps brut sinon. */
function parseCreated(result: HttpResult, label: string): Created {
  expectStatus(result, 201, label);
  const parsed = addLink.output.safeParse(result.body);
  if (!parsed.success) {
    throw new Error(`${label} : le corps ne respecte pas addLink.output. Corps brut : ${result.text}`);
  }
  return parsed.data;
}

describe("AC1 — ajout nominal par l'owner (US-06.1, US-06.3)", () => {
  it("AC1 : l'owner ajoute un lien -> 201, corps conforme a addLink.output, ligne en base avec organization_id et added_by_user_id, compteur +1", async () => {
    const org = await createOrganizationFixture("AC1 nominal");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    const before = await linkState(org.organizationId);
    const url = "https://exemple.invalid/article";
    const title = "Article de test";
    const clockBefore = await databaseNow();

    const result = await postLink(org.owner, org.organizationId, collectionId, { url, title });
    const created = parseCreated(result, "ajout par l'owner");
    const clockAfter = await databaseNow();

    expect(created.collectionId).toBe(collectionId);
    expect(created.url).toBe(url);
    expect(created.title).toBe(title);
    expect(created.addedBy).toBe(org.owner.userId);
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    const createdAtMs = Date.parse(created.createdAt);
    expect(createdAtMs, "createdAt est l'instant de l'ajout, lu sur l'horloge de la base").toBeGreaterThanOrEqual(clockBefore.getTime());
    expect(createdAtMs).toBeLessThanOrEqual(clockAfter.getTime());

    const rows = await readLinks(org.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: created.id,
      organization_id: org.organizationId,
      collection_id: collectionId,
      added_by_user_id: org.owner.userId,
      url,
      title,
    });
    expect(Math.abs((rows[0]?.created_at.getTime() ?? 0) - createdAtMs), "la reponse rend la date enregistree (a la milliseconde pres)").toBeLessThanOrEqual(1);
    expect(before).toEqual({ rows: 0, counter: 0 });
    expect(await expectCounterAligned(org.organizationId, "apres l'ajout")).toEqual({ rows: 1, counter: 1 });
  });

  it("AC1 : le meme ajout rejoue -> 201, une deuxieme ligne distincte, compteur +2 (aucune deduplication)", async () => {
    const org = await createOrganizationFixture("AC1 rejeu");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    const payload = { url: uniqueUrl(), title: "Meme lien" };

    const first = parseCreated(await postLink(org.owner, org.organizationId, collectionId, payload), "premier ajout");
    const second = parseCreated(await postLink(org.owner, org.organizationId, collectionId, payload), "ajout rejoue");

    expect(second.id).not.toBe(first.id);
    expect((await readLinks(org.organizationId, collectionId)).map((r) => r.id).sort()).toEqual([first.id, second.id].sort());
    expect(await expectCounterAligned(org.organizationId, "apres le rejeu")).toEqual({ rows: 2, counter: 2 });
  });

  it("AC1 : des identifiants en majuscules dans le chemin designent les memes ressources", async () => {
    const org = await createOrganizationFixture("AC1 majuscules");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");

    const result = await postLink(org.owner, org.organizationId.toUpperCase(), collectionId.toUpperCase(), {
      url: uniqueUrl(),
      title: "Chemin en majuscules",
    });
    const created = parseCreated(result, "identifiants en majuscules");

    expect(created.collectionId).toBe(collectionId.toLowerCase());
    const rows = await readLinks(org.organizationId);
    expect(rows.map((r) => r.id)).toEqual([created.id]);
    expect(rows[0]?.organization_id).toBe(org.organizationId.toLowerCase());
    expect(rows[0]?.collection_id).toBe(collectionId.toLowerCase());
    await expectCounterAligned(org.organizationId, "apres le chemin en majuscules");
  });

  it("AC1 : des liens dans deux collections de la meme organisation comptent ensemble", async () => {
    const org = await createOrganizationFixture("AC1 deux collections");
    const first = await createCollectionViaApi(org.owner, org.organizationId, "Premiere");
    const second = await createCollectionViaApi(org.owner, org.organizationId, "Seconde");

    parseCreated(await postLink(org.owner, org.organizationId, first, { url: uniqueUrl(), title: "Un" }), "dans la premiere");
    parseCreated(await postLink(org.owner, org.organizationId, second, { url: uniqueUrl(), title: "Deux" }), "dans la seconde");

    expect(await countLinks(org.organizationId)).toBe(2);
    expect(await readLinkCount(org.organizationId), "un seul compteur par organisation").toBe(2);
    await expectCounterAligned(org.organizationId, "apres deux collections");
  });
});

describe("AC2 — ajout par un member, auteur et date poses par le serveur (US-06.1, US-06.3)", () => {
  it("AC2 : un member de A ajoute un lien -> 201, addedBy = ce member (jamais l'owner)", async () => {
    const org = await createOrganizationFixture("AC2 member");
    const member = await createMemberSession(org.organizationId);
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");

    const result = await postLink(member, org.organizationId, collectionId, { url: uniqueUrl(), title: "Par un member" });
    const created = parseCreated(result, "ajout par un member");

    expect(created.addedBy).toBe(member.userId);
    expect(created.addedBy).not.toBe(org.owner.userId);
    const rows = await readLinks(org.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: created.id, added_by_user_id: member.userId, organization_id: org.organizationId });
    await expectCounterAligned(org.organizationId, "apres l'ajout par un member");
  });

  it("AC2 : un corps portant addedBy, createdAt, organizationId, collectionId et id -> tous ignores", async () => {
    const orgs = await Promise.all([createOrganizationFixture("AC2 corps A"), createOrganizationFixture("AC2 corps B")]);
    const [orgA, orgB] = orgs;
    if (!orgA || !orgB) throw new Error("fixtures manquantes");
    const member = await createMemberSession(orgA.organizationId);
    const target = await createCollectionViaApi(orgA.owner, orgA.organizationId, "Cible");
    const other = await createCollectionViaApi(orgA.owner, orgA.organizationId, "Autre");
    const foreignId = randomUUID();
    const clockBefore = await databaseNow();

    const result = await postLink(member, orgA.organizationId, target, {
      url: uniqueUrl(),
      title: "Corps piege",
      addedBy: orgA.owner.userId,
      createdAt: "2001-01-01T00:00:00Z",
      organizationId: orgB.organizationId,
      collectionId: other,
      id: foreignId,
    });
    const created = parseCreated(result, "corps avec champs interdits");
    const clockAfter = await databaseNow();

    expect(created.collectionId, "la collection du chemin fait autorite").toBe(target);
    expect(created.addedBy, "l'auteur est l'utilisateur de session").toBe(member.userId);
    expect(created.id, "l'identifiant est choisi par la base").not.toBe(foreignId);
    const createdAtMs = Date.parse(created.createdAt);
    expect(createdAtMs, "la date est celle de la base, pas 2001").toBeGreaterThanOrEqual(clockBefore.getTime());
    expect(createdAtMs).toBeLessThanOrEqual(clockAfter.getTime());

    const row = await readLinkById(created.id);
    expect(row).toMatchObject({
      organization_id: orgA.organizationId,
      collection_id: target,
      added_by_user_id: member.userId,
    });
    expect(await readLinkById(foreignId), "aucune ligne sous l'identifiant du corps").toBeUndefined();
    expect(await readLinks(orgA.organizationId, other), "rien dans l'autre collection").toEqual([]);
    expect(await readLinks(orgB.organizationId), "rien dans B").toEqual([]);
    await expectCounterAligned(orgA.organizationId, "A apres le corps piege");
    await expectCounterAligned(orgB.organizationId, "B apres le corps piege");
  });
});

describe("AC11 — session et forme du chemin", () => {
  it("AC11 : sans session -> 401 UNAUTHENTICATED, aucune ligne", async () => {
    const org = await createOrganizationFixture("AC11 sans session");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    const before = await linkState(org.organizationId);

    const result = await postLink(null, org.organizationId, collectionId, { url: uniqueUrl(), title: "Anonyme" });

    expectError(result, 401, "UNAUTHENTICATED", "sans session");
    await expectUnchanged(org.organizationId, before, "apres la requete anonyme");
  });

  it("AC11 : cookie de session invalide -> 401 UNAUTHENTICATED, aucune ligne", async () => {
    const org = await createOrganizationFixture("AC11 cookie");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    const before = await linkState(org.organizationId);

    const result = await postLinkWithCookie(org.organizationId, collectionId, "better-auth.session_token=invalide.invalide", {
      url: uniqueUrl(),
      title: "Cookie faux",
    });

    expectError(result, 401, "UNAUTHENTICATED", "cookie invalide");
    await expectUnchanged(org.organizationId, before, "apres le cookie invalide");
  });

  it("AC11 : sans session ET corps invalide -> 401 (la session precede la validation)", async () => {
    const org = await createOrganizationFixture("AC11 ordre 401");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");

    const result = await postLink(null, org.organizationId, collectionId, { url: "pas-une-url", title: "" });

    expectError(result, 401, "UNAUTHENTICATED", "sans session et corps invalide");
  });

  const malformedPaths: Array<[string, (organizationId: string, collectionId: string) => [string, string]]> = [
    ["organizationId malforme", (_o, c) => ["pas-un-uuid", c]],
    ["organizationId presque un UUID", (_o, c) => ["12345678-1234-1234-1234-12345678901Z", c]],
    ["collectionId malforme", (o) => [o, "pas-un-uuid"]],
    ["collectionId presque un UUID", (o) => [o, "12345678-1234-1234-1234-12345678901Z"]],
  ];

  it.each(malformedPaths)("AC11 : %s dans le chemin -> 422 VALIDATION_FAILED, aucune ligne", async (label, pick) => {
    const org = await createOrganizationFixture("AC11 chemin");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    const before = await linkState(org.organizationId);
    const [organizationPart, collectionPart] = pick(org.organizationId, collectionId);

    const result = await postLink(org.owner, organizationPart, collectionPart, { url: uniqueUrl(), title: "Chemin malforme" });

    expectError(result, 422, "VALIDATION_FAILED", label);
    await expectUnchanged(org.organizationId, before, `apres ${label}`);
  });

  it("AC11 : un non-membre avec un corps invalide recoit 422, pas 404 (la validation precede l'appartenance)", async () => {
    const org = await createOrganizationFixture("AC11 non-membre");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    const stranger = await signUp();

    const invalid = await postLink(stranger, org.organizationId, collectionId, { url: "javascript:alert(1)", title: "" });
    const valid = await postLink(stranger, org.organizationId, collectionId, { url: uniqueUrl(), title: "Valide" });

    expectError(invalid, 422, "VALIDATION_FAILED", "non-membre, corps invalide");
    expectError(valid, 404, "ORGANIZATION_NOT_FOUND", "temoin : non-membre, corps valide");
    expect(await countLinks(org.organizationId)).toBe(0);
    await expectCounterAligned(org.organizationId, "apres le non-membre");
  });
});
