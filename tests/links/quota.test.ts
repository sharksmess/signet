/**
 * Tranche 005 — quota Free, scenarios sequentiels : AC6 (US-06.4) et AC8
 * (palier Pro et retrogradation, ADR-0002, D-057). La concurrence est dans
 * concurrency.test.ts et lock.test.ts.
 *
 * Remplissage : jamais en ecrivant le compteur, toujours par INSERT sous
 * `signet_app` avec le contexte de l'organisation (donc par le trigger).
 * L'organisation Pro puis retrogradee s'obtient par les moyens de la tranche 002
 * (ecriture directe de l'abonnement, qui declenche la propagation du plafond).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { closeAllPools } from "../helpers/db";
import { createOrganizationFixture } from "../helpers/fixtures";
import { createProOrganization, expectError, expectStatus } from "../helpers/billing";
import { readLinkQuota, readSubscriptionRow, setSubscriptionDirect } from "../helpers/billing-db";
import { createMemberSession } from "../helpers/collections";
import {
  closeLinkPools,
  createCollectionsViaApi,
  createCollectionViaApi,
  expectCleanErrorBody,
  expectCounterAligned,
  expectUnchanged,
  linkState,
  messageOf,
  postLink,
  readLinks,
  seedLinks,
  uniqueUrl,
} from "../helpers/links";

afterAll(async () => {
  await closeLinkPools();
  await closeAllPools();
});

/** D-119 lecture 2 : message du 409, sans le nombre 50 (valeur unique dans quota_for_tier). */
const QUOTA_MESSAGE = "Le quota de liens du palier Free est atteint : aucun lien n'a ete ajoute. Passer au palier Pro pour en ajouter d'autres.";

describe("AC6 — quota Free, sequentiel (US-06.4)", () => {
  it("AC6 : 49 liens sur trois collections -> le 50e (quatrieme collection) 201, compteur 50 ; le 51e dans chacune des quatre collections -> 409 FREE_TIER_QUOTA_EXCEEDED, aucune ligne, compteur 50 = nombre reel", async () => {
    const org = await createOrganizationFixture("AC6 sequentiel");
    const [c1, c2, c3, c4] = await createCollectionsViaApi(org.owner, org.organizationId, 4);
    if (!c1 || !c2 || !c3 || !c4) throw new Error("collections manquantes");
    expect(await readLinkQuota(org.organizationId), "precondition : palier Free, plafond 50").toBe(50);
    await seedLinks({ organizationId: org.organizationId, userId: org.owner.userId, collectionIds: [c1, c2, c3], count: 49 });
    expect(await linkState(org.organizationId), "precondition : 49 liens, compteur 49").toEqual({ rows: 49, counter: 49 });

    const fiftieth = await postLink(org.owner, org.organizationId, c4, { url: uniqueUrl(), title: "Le cinquantieme" });

    expectStatus(fiftieth, 201, "50e lien dans la quatrieme collection");
    expect(await expectCounterAligned(org.organizationId, "apres le 50e")).toEqual({ rows: 50, counter: 50 });

    for (const [index, collectionId] of [c1, c2, c3, c4].entries()) {
      const result = await postLink(org.owner, org.organizationId, collectionId, { url: uniqueUrl(), title: `Cinquante et unieme ${index}` });

      expectError(result, 409, "FREE_TIER_QUOTA_EXCEEDED", `51e lien dans la collection ${index + 1}`);
      expect(messageOf(result), "message explicite et fixe").toBe(QUOTA_MESSAGE);
      expectCleanErrorBody(result, `51e lien, collection ${index + 1}`, [org.organizationId, collectionId]);
      expect(await expectCounterAligned(org.organizationId, `apres le refus dans la collection ${index + 1}`)).toEqual({ rows: 50, counter: 50 });
    }
    expect(await readLinks(org.organizationId, c4), "seul le 50e est dans la quatrieme collection").toHaveLength(1);
  });

  it("AC6 : le refus s'applique aussi a un member, et aucun lien de la requete refusee n'existe", async () => {
    const org = await createOrganizationFixture("AC6 member refuse");
    const member = await createMemberSession(org.organizationId);
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    await seedLinks({ organizationId: org.organizationId, userId: org.owner.userId, collectionIds: [collectionId], count: 50 });
    const title = `Refuse ${randomUUID()}`;

    const result = await postLink(member, org.organizationId, collectionId, { url: uniqueUrl(), title });

    expectError(result, 409, "FREE_TIER_QUOTA_EXCEEDED", "member a 50 liens");
    expect((await readLinks(org.organizationId)).filter((r) => r.title === title)).toEqual([]);
    expect(await expectCounterAligned(org.organizationId, "apres le refus du member")).toEqual({ rows: 50, counter: 50 });
  });

  it("AC6 : a 50 liens, une collection inexistante donne 404 COLLECTION_NOT_FOUND (pas 409) et une URL invalide donne 422", async () => {
    const org = await createOrganizationFixture("AC6 priorites");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    await seedLinks({ organizationId: org.organizationId, userId: org.owner.userId, collectionIds: [collectionId], count: 50 });
    const before = await linkState(org.organizationId);

    const missing = await postLink(org.owner, org.organizationId, randomUUID(), { url: uniqueUrl(), title: "Collection absente" });
    const invalid = await postLink(org.owner, org.organizationId, collectionId, { url: "ftp://exemple.invalid/x", title: "URL invalide" });
    const blocked = await postLink(org.owner, org.organizationId, collectionId, { url: uniqueUrl(), title: "Temoin du plafond" });

    expectError(missing, 404, "COLLECTION_NOT_FOUND", "collection inexistante a 50 liens");
    expectError(invalid, 422, "VALIDATION_FAILED", "URL invalide a 50 liens");
    expectError(blocked, 409, "FREE_TIER_QUOTA_EXCEEDED", "temoin : le plafond est bien atteint");
    await expectUnchanged(org.organizationId, before, "apres les trois refus");
  });

  it("AC6 : un refus de quota dans une organisation ne bloque pas les ajouts d'une autre", async () => {
    const full = await createOrganizationFixture("AC6 pleine");
    const other = await createOrganizationFixture("AC6 autre");
    const fullCollection = await createCollectionViaApi(full.owner, full.organizationId, "Veille");
    const otherCollection = await createCollectionViaApi(other.owner, other.organizationId, "Veille");
    await seedLinks({ organizationId: full.organizationId, userId: full.owner.userId, collectionIds: [fullCollection], count: 50 });

    expectError(await postLink(full.owner, full.organizationId, fullCollection, { url: uniqueUrl(), title: "Refuse" }), 409, "FREE_TIER_QUOTA_EXCEEDED", "pleine");
    expectStatus(await postLink(other.owner, other.organizationId, otherCollection, { url: uniqueUrl(), title: "Accepte" }), 201, "autre organisation");

    expect(await expectCounterAligned(full.organizationId, "pleine")).toEqual({ rows: 50, counter: 50 });
    expect(await expectCounterAligned(other.organizationId, "autre")).toEqual({ rows: 1, counter: 1 });
  });
});

describe("AC8 — Pro et retrogradation (ADR-0002, D-057)", () => {
  it("AC8 (a) : organisation Pro (link_quota NULL) a 50 liens -> le 51e est accepte (201)", async () => {
    const pro = await createProOrganization({ name: "AC8 a Pro" });
    const collectionId = await createCollectionViaApi(pro.org.owner, pro.org.organizationId, "Veille");
    await seedLinks({ organizationId: pro.org.organizationId, userId: pro.org.owner.userId, collectionIds: [collectionId], count: 50 });
    expect(await readLinkQuota(pro.org.organizationId), "precondition : Pro, plafond NULL").toBeNull();

    const result = await postLink(pro.org.owner, pro.org.organizationId, collectionId, { url: uniqueUrl(), title: "Le cinquante et unieme" });

    expectStatus(result, 201, "51e lien d'une organisation Pro");
    expect(await expectCounterAligned(pro.org.organizationId, "apres le 51e")).toEqual({ rows: 51, counter: 51 });
  });

  it("AC8 (b) : Pro -> Free avec 75 liens : link_quota = 50, link_count = 75 ; tout ajout -> 409 dans chaque collection ; les 75 liens restent, compteur 75 = nombre reel", async () => {
    const pro = await createProOrganization({ name: "AC8 b retrogradation" });
    const { org } = pro;
    const collections = await createCollectionsViaApi(org.owner, org.organizationId, 3);
    await seedLinks({ organizationId: org.organizationId, userId: org.owner.userId, collectionIds: collections, count: 75 });

    await setSubscriptionDirect(org.organizationId, { tier: "free" });

    expect((await readSubscriptionRow(org.organizationId)).tier).toBe("free");
    expect(await readLinkQuota(org.organizationId), "le plafond redevient 50").toBe(50);
    expect(await linkState(org.organizationId), "aucun lien supprime ni gele par la retrogradation").toEqual({ rows: 75, counter: 75 });

    for (const [index, collectionId] of collections.entries()) {
      const result = await postLink(org.owner, org.organizationId, collectionId, { url: uniqueUrl(), title: `Au-dessus du plafond ${index}` });

      expectError(result, 409, "FREE_TIER_QUOTA_EXCEEDED", `ajout apres retrogradation, collection ${index + 1}`);
      expect(messageOf(result)).toBe(QUOTA_MESSAGE);
      expect(await expectCounterAligned(org.organizationId, `apres le refus ${index + 1}`)).toEqual({ rows: 75, counter: 75 });
    }
  });

  it("AC8 (c) : la meme organisation repassee en Pro -> l'ajout reussit", async () => {
    const pro = await createProOrganization({ name: "AC8 c retour Pro" });
    const { org } = pro;
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    await seedLinks({ organizationId: org.organizationId, userId: org.owner.userId, collectionIds: [collectionId], count: 75 });
    await setSubscriptionDirect(org.organizationId, { tier: "free" });
    expectError(
      await postLink(org.owner, org.organizationId, collectionId, { url: uniqueUrl(), title: "Refuse en Free" }),
      409,
      "FREE_TIER_QUOTA_EXCEEDED",
      "precondition : refus tant que Free",
    );

    await setSubscriptionDirect(org.organizationId, {
      tier: "pro",
      status: "active",
      stripeCustomerId: pro.customerId,
      stripeSubscriptionId: pro.subscriptionId,
      currentPeriodEnd: pro.periodEnd,
    });
    const result = await postLink(org.owner, org.organizationId, collectionId, { url: uniqueUrl(), title: "Accepte en Pro" });

    expect(await readLinkQuota(org.organizationId)).toBeNull();
    expectStatus(result, 201, "ajout apres retour en Pro");
    expect(await expectCounterAligned(org.organizationId, "apres le retour en Pro")).toEqual({ rows: 76, counter: 76 });
  });
});
