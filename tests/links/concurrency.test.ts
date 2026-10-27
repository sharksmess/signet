/**
 * Tranche 005 — AC7 (a), (b) et AC8 (a) : concurrence par l'API (risque #3 du
 * PRD, ADR-0002). Les requetes partent ensemble (Promise.all) depuis des
 * connexions HTTP distinctes ; la garantie vient du verrou de ligne du compteur
 * pris par le trigger, jamais d'une lecture prealable.
 *
 * Remplissage a 49 liens sous `signet_app` avec le contexte de l'organisation
 * (donc par le trigger). Apres chaque scenario : link_count = count(*) (AC9 a).
 * Les preuves en base (verrou observe, 10 connexions signet_app) sont dans
 * lock.test.ts.
 */
import { describe, it, expect, afterAll } from "vitest";
import { closeAllPools } from "../helpers/db";
import { createOrganizationFixture } from "../helpers/fixtures";
import { codeOf, createProOrganization, expectStatus, type HttpResult } from "../helpers/billing";
import { createMemberSession } from "../helpers/collections";
import {
  closeLinkPools,
  createCollectionsViaApi,
  expectCleanErrorBody,
  expectCounterAligned,
  postLink,
  readLinks,
  seedLinks,
  uniqueUrl,
} from "../helpers/links";

afterAll(async () => {
  await closeLinkPools();
  await closeAllPools();
});

const SIMULTANEOUS = 10;
const LONG_TEST = 90_000;

function summary(results: HttpResult[]): string {
  return results.map((r) => `${r.status} ${r.text}`).join(" | ");
}

function statusesOf(results: HttpResult[]): number[] {
  return results.map((r) => r.status).sort((a, b) => a - b);
}

describe("AC7 (a) — 10 POST simultanes dans une meme collection, 49 liens", () => {
  it.each([1, 2, 3])(
    "AC7 (a) : rejeu %i sur une organisation neuve -> exactement un 201 et neuf 409 FREE_TIER_QUOTA_EXCEEDED, compteur = nombre reel = 50",
    async (replay) => {
      const org = await createOrganizationFixture(`AC7 a rejeu ${replay}`);
      const [collectionId] = await createCollectionsViaApi(org.owner, org.organizationId, 1);
      if (!collectionId) throw new Error("collection manquante");
      await seedLinks({ organizationId: org.organizationId, userId: org.owner.userId, collectionIds: [collectionId], count: 49 });

      const results = await Promise.all(
        Array.from({ length: SIMULTANEOUS }, (_, index) =>
          postLink(org.owner, org.organizationId, collectionId, { url: uniqueUrl(), title: `Simultane ${index}` }),
        ),
      );

      expect(statusesOf(results), `statuts recus. Corps : ${summary(results)}`).toEqual([201, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
      for (const refused of results.filter((r) => r.status === 409)) {
        expect(codeOf(refused), `corps : ${refused.text}`).toBe("FREE_TIER_QUOTA_EXCEEDED");
        expectCleanErrorBody(refused, "409 simultane");
      }
      expect(await expectCounterAligned(org.organizationId, "apres la rafale")).toEqual({ rows: 50, counter: 50 });
    },
    LONG_TEST,
  );

  it(
    "AC7 (a) : owner et member en meme temps -> toujours un seul 201, quel que soit l'auteur",
    async () => {
      const org = await createOrganizationFixture("AC7 a deux auteurs");
      const member = await createMemberSession(org.organizationId);
      const [collectionId] = await createCollectionsViaApi(org.owner, org.organizationId, 1);
      if (!collectionId) throw new Error("collection manquante");
      await seedLinks({ organizationId: org.organizationId, userId: org.owner.userId, collectionIds: [collectionId], count: 49 });

      const results = await Promise.all(
        Array.from({ length: SIMULTANEOUS }, (_, index) =>
          postLink(index % 2 === 0 ? org.owner : member, org.organizationId, collectionId, { url: uniqueUrl(), title: `Auteur ${index}` }),
        ),
      );

      expect(statusesOf(results), `Corps : ${summary(results)}`).toEqual([201, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
      const winnerIndex = results.findIndex((r) => r.status === 201);
      const winner = results[winnerIndex];
      expect(winner && (winner.body as { addedBy?: string }).addedBy).toBe(winnerIndex % 2 === 0 ? org.owner.userId : member.userId);
      expect(await expectCounterAligned(org.organizationId, "apres la rafale")).toEqual({ rows: 50, counter: 50 });
    },
    LONG_TEST,
  );
});

describe("AC7 (b) — la meme preuve repartie sur plusieurs collections (tous collections confondues)", () => {
  it(
    "AC7 (b) : 49 liens, 10 POST simultanes repartis sur 5 collections de la meme organisation -> un seul 201",
    async () => {
      const org = await createOrganizationFixture("AC7 b cinq collections");
      const collections = await createCollectionsViaApi(org.owner, org.organizationId, 5);
      await seedLinks({ organizationId: org.organizationId, userId: org.owner.userId, collectionIds: collections, count: 49 });

      const results = await Promise.all(
        Array.from({ length: SIMULTANEOUS }, (_, index) => {
          const collectionId = collections[index % collections.length];
          if (!collectionId) throw new Error("collection manquante");
          return postLink(org.owner, org.organizationId, collectionId, { url: uniqueUrl(), title: `Repartie ${index}` });
        }),
      );

      expect(statusesOf(results), `statuts recus. Corps : ${summary(results)}`).toEqual([201, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
      for (const refused of results.filter((r) => r.status === 409)) {
        expect(codeOf(refused), `corps : ${refused.text}`).toBe("FREE_TIER_QUOTA_EXCEEDED");
      }
      expect(await expectCounterAligned(org.organizationId, "apres la rafale repartie")).toEqual({ rows: 50, counter: 50 });
      expect((await readLinks(org.organizationId)).filter((r) => r.title.startsWith("Repartie ")), "un seul lien de la rafale").toHaveLength(1);
    },
    LONG_TEST,
  );

  it(
    "AC7 (b) : a 40 liens, 20 POST simultanes sur 5 collections -> exactement 10 reussissent, compteur = nombre reel = 50",
    async () => {
      const org = await createOrganizationFixture("AC7 b dix places");
      const collections = await createCollectionsViaApi(org.owner, org.organizationId, 5);
      await seedLinks({ organizationId: org.organizationId, userId: org.owner.userId, collectionIds: collections, count: 40 });

      const results = await Promise.all(
        Array.from({ length: 20 }, (_, index) => {
          const collectionId = collections[index % collections.length];
          if (!collectionId) throw new Error("collection manquante");
          return postLink(org.owner, org.organizationId, collectionId, { url: uniqueUrl(), title: `Dix places ${index}` });
        }),
      );

      const created = results.filter((r) => r.status === 201).length;
      const refused = results.filter((r) => r.status === 409 && codeOf(r) === "FREE_TIER_QUOTA_EXCEEDED").length;
      expect({ created, refused }, `Corps : ${summary(results)}`).toEqual({ created: 10, refused: 10 });
      expect(await expectCounterAligned(org.organizationId, "apres 20 requetes")).toEqual({ rows: 50, counter: 50 });
    },
    LONG_TEST,
  );
});

describe("AC8 (a) — Pro : aucun refus, meme sous concurrence", () => {
  it(
    "AC8 (a) : organisation Pro a 50 liens, 10 POST simultanes -> 10 x 201, compteur = nombre reel",
    async () => {
      const pro = await createProOrganization({ name: "AC8 a concurrence Pro" });
      const { org } = pro;
      const collections = await createCollectionsViaApi(org.owner, org.organizationId, 2);
      await seedLinks({ organizationId: org.organizationId, userId: org.owner.userId, collectionIds: collections, count: 50 });

      const results = await Promise.all(
        Array.from({ length: SIMULTANEOUS }, (_, index) => {
          const collectionId = collections[index % collections.length];
          if (!collectionId) throw new Error("collection manquante");
          return postLink(org.owner, org.organizationId, collectionId, { url: uniqueUrl(), title: `Pro simultane ${index}` });
        }),
      );

      for (const [index, result] of results.entries()) expectStatus(result, 201, `ajout Pro simultane ${index}`);
      expect(await expectCounterAligned(org.organizationId, "apres la rafale Pro")).toEqual({ rows: 60, counter: 60 });
    },
    LONG_TEST,
  );
});
