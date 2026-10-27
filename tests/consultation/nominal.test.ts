/**
 * Tranche 009 — AC1 (lecture nominale, owner et member), AC3 (listes vides),
 * AC7 (fraicheur), AC9 (valeurs telles qu'enregistrees). Les deux routes GET
 * sont couvertes dans chaque critere.
 */
import { describe, it, expect, afterAll } from "vitest";
import { listCollections } from "../../docs/02-architecture/api-contracts/collections";
import { listLinks } from "../../docs/02-architecture/api-contracts/links";
import { closeAllPools } from "../helpers/db";
import { createOrganizationFixture } from "../helpers/fixtures";
import { expectStatus } from "../helpers/billing";
import { createMemberSession, postCollection, readCollections, readCollectionById, uniqueCollectionName } from "../helpers/collections";
import { createCollectionViaApi, postLink, readLinkById, readLinks, uniqueUrl } from "../helpers/links";
import { expectExactKeys, expectList, getCollections, getLinks, idsOf, RLO, ZWSP } from "../helpers/consultation";

afterAll(async () => {
  await closeAllPools();
});

describe("AC1 — lecture nominale par l'owner et par un member (US-07.1)", () => {
  it("AC1 : l'owner et un member obtiennent 200 et la meme liste de collections, conforme au contrat, cles exactes {id, name, createdAt}", async () => {
    const org = await createOrganizationFixture("AC1 collections");
    const member = await createMemberSession(org.organizationId);
    const first = await createCollectionViaApi(org.owner, org.organizationId, uniqueCollectionName("Premiere"));
    const second = await createCollectionViaApi(member, org.organizationId, uniqueCollectionName("Seconde"));

    const asOwner = await getCollections(org.owner, org.organizationId);
    const asMember = await getCollections(member, org.organizationId);

    const ownerItems = expectList(asOwner, "owner : GET collections");
    const memberItems = expectList(asMember, "member : GET collections");
    expect(memberItems, "meme liste pour l'owner et le member").toEqual(ownerItems);
    expect(idsOf(ownerItems)).toEqual([second, first]);
    expectExactKeys(ownerItems, ["id", "name", "createdAt"], "collections");
    const parsed = listCollections.output.parse(asOwner.body);
    expect(parsed).toHaveLength(2);
    const rows = await readCollections(org.organizationId);
    for (const item of parsed) {
      const row = rows.find((r) => r.id === item.id);
      expect(row, `ligne en base de la collection ${item.id}`).toBeDefined();
      expect(item.name).toBe(row?.name);
      expect(item.createdAt.endsWith("Z"), `createdAt ${item.createdAt} en UTC (suffixe Z)`).toBe(true);
      expect(item.createdAt).toBe(row?.created_at.toISOString());
    }
  });

  it("AC1 : l'owner et un member obtiennent 200 et la meme liste de liens, conforme au contrat, cles exactes {id, url, title, addedBy, createdAt}, addedBy = auteur reel", async () => {
    const org = await createOrganizationFixture("AC1 liens");
    const member = await createMemberSession(org.organizationId);
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    const byOwner = await postLink(org.owner, org.organizationId, collectionId, { url: uniqueUrl(), title: "Lien de l'owner" });
    const byMember = await postLink(member, org.organizationId, collectionId, { url: uniqueUrl(), title: "Lien du member" });
    expectStatus(byOwner, 201, "arrangement : lien de l'owner");
    expectStatus(byMember, 201, "arrangement : lien du member");

    const asOwner = await getLinks(org.owner, org.organizationId, collectionId);
    const asMember = await getLinks(member, org.organizationId, collectionId);

    const ownerItems = expectList(asOwner, "owner : GET liens");
    const memberItems = expectList(asMember, "member : GET liens");
    expect(memberItems, "meme liste pour l'owner et le member").toEqual(ownerItems);
    expectExactKeys(ownerItems, ["id", "url", "title", "addedBy", "createdAt"], "liens");
    const parsed = listLinks.output.parse(asOwner.body);
    expect(parsed).toHaveLength(2);
    const rows = await readLinks(org.organizationId, collectionId);
    for (const item of parsed) {
      const row = rows.find((r) => r.id === item.id);
      expect(row, `ligne en base du lien ${item.id}`).toBeDefined();
      expect(item.url).toBe(row?.url);
      expect(item.title).toBe(row?.title);
      expect(item.addedBy, "auteur reel du lien").toBe(row?.added_by_user_id);
      expect(item.createdAt.endsWith("Z"), `createdAt ${item.createdAt} en UTC (suffixe Z)`).toBe(true);
      expect(item.createdAt).toBe(row?.created_at.toISOString());
    }
    expect(parsed.find((i) => i.title === "Lien de l'owner")?.addedBy).toBe(org.owner.userId);
    expect(parsed.find((i) => i.title === "Lien du member")?.addedBy).toBe(member.userId);
  });

  it("AC1 : la liste des liens ne contient que ceux de la collection demandee", async () => {
    const org = await createOrganizationFixture("AC1 filtre collection");
    const one = await createCollectionViaApi(org.owner, org.organizationId, "Une");
    const two = await createCollectionViaApi(org.owner, org.organizationId, "Deux");
    const inOne = await postLink(org.owner, org.organizationId, one, { url: uniqueUrl(), title: "Dans Une" });
    const inTwo = await postLink(org.owner, org.organizationId, two, { url: uniqueUrl(), title: "Dans Deux" });
    expectStatus(inOne, 201, "arrangement : lien dans Une");
    expectStatus(inTwo, 201, "arrangement : lien dans Deux");

    const listOne = expectList(await getLinks(org.owner, org.organizationId, one), "GET liens de Une");
    const listTwo = expectList(await getLinks(org.owner, org.organizationId, two), "GET liens de Deux");

    expect((await readLinks(org.organizationId, one)).map((r) => r.id).sort()).toEqual(idsOf(listOne).sort());
    expect((await readLinks(org.organizationId, two)).map((r) => r.id).sort()).toEqual(idsOf(listTwo).sort());
    expect(idsOf(listOne)).toHaveLength(1);
    expect(idsOf(listTwo)).toHaveLength(1);
    expect(idsOf(listOne)).not.toEqual(idsOf(listTwo));
  });

  it("AC1 : organizationId et collectionId en majuscules dans le chemin designent la meme ressource", async () => {
    const org = await createOrganizationFixture("AC1 majuscules");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    expectStatus(await postLink(org.owner, org.organizationId, collectionId, { url: uniqueUrl(), title: "Un lien" }), 201, "arrangement : lien");

    const lowerCollections = expectList(await getCollections(org.owner, org.organizationId), "collections, minuscules");
    const upperCollections = expectList(await getCollections(org.owner, org.organizationId.toUpperCase()), "collections, majuscules");
    const lowerLinks = expectList(await getLinks(org.owner, org.organizationId, collectionId), "liens, minuscules");
    const upperLinks = expectList(await getLinks(org.owner, org.organizationId.toUpperCase(), collectionId.toUpperCase()), "liens, majuscules");

    expect(upperCollections).toEqual(lowerCollections);
    expect(upperLinks).toEqual(lowerLinks);
    expect(lowerLinks).toHaveLength(1);
  });
});

describe("AC3 — listes vides", () => {
  it("AC3 : une organisation sans collection -> 200 []", async () => {
    const org = await createOrganizationFixture("AC3 sans collection");

    const result = await getCollections(org.owner, org.organizationId);

    expect(expectList(result, "organisation sans collection")).toEqual([]);
  });

  it("AC3 : une collection sans lien -> 200 [] (et l'organisation peut avoir des collections)", async () => {
    const org = await createOrganizationFixture("AC3 sans lien");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Vide");

    const result = await getLinks(org.owner, org.organizationId, collectionId);

    expect(expectList(result, "collection sans lien")).toEqual([]);
  });
});

describe("AC7 — fraicheur", () => {
  it("AC7 : une collection creee par POST apparait en tete a la lecture suivante ; deux lectures encadrant un ajout different", async () => {
    const org = await createOrganizationFixture("AC7 collections");
    const before = expectList(await getCollections(org.owner, org.organizationId), "lecture avant");
    expect(before).toEqual([]);

    const created = await postCollection(org.owner, org.organizationId, { name: uniqueCollectionName("Fraiche") });
    expectStatus(created, 201, "creation de la collection");
    const createdId = idsOf([created.body])[0];
    const afterFirst = expectList(await getCollections(org.owner, org.organizationId), "lecture apres le premier ajout");

    expect(idsOf(afterFirst)).toEqual([createdId]);
    expect(afterFirst).not.toEqual(before);

    const createdSecond = await postCollection(org.owner, org.organizationId, { name: uniqueCollectionName("Plus fraiche") });
    expectStatus(createdSecond, 201, "creation de la seconde collection");
    const secondId = idsOf([createdSecond.body])[0];
    const afterSecond = expectList(await getCollections(org.owner, org.organizationId), "lecture apres le second ajout");

    expect(idsOf(afterSecond)[0], "la plus recente est en tete").toBe(secondId);
    expect(idsOf(afterSecond)).toHaveLength(2);
    expect(afterSecond).not.toEqual(afterFirst);
  });

  it("AC7 : un lien ajoute par POST apparait en tete a la lecture suivante ; deux lectures encadrant un ajout different", async () => {
    const org = await createOrganizationFixture("AC7 liens");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    const before = expectList(await getLinks(org.owner, org.organizationId, collectionId), "lecture avant");
    expect(before).toEqual([]);

    const added = await postLink(org.owner, org.organizationId, collectionId, { url: uniqueUrl(), title: "Premier" });
    expectStatus(added, 201, "ajout du premier lien");
    const afterFirst = expectList(await getLinks(org.owner, org.organizationId, collectionId), "lecture apres le premier ajout");
    expect(idsOf(afterFirst)).toEqual(idsOf([added.body]));
    expect(afterFirst).not.toEqual(before);

    const addedSecond = await postLink(org.owner, org.organizationId, collectionId, { url: uniqueUrl(), title: "Second" });
    expectStatus(addedSecond, 201, "ajout du second lien");
    const afterSecond = expectList(await getLinks(org.owner, org.organizationId, collectionId), "lecture apres le second ajout");

    expect(idsOf(afterSecond)[0], "le plus recent est en tete").toBe(idsOf([addedSecond.body])[0]);
    expect(idsOf(afterSecond)).toHaveLength(2);
    expect(afterSecond).not.toEqual(afterFirst);
  });
});

describe("AC9 — valeurs telles qu'enregistrees (D-131 point 4, D-119)", () => {
  it("AC9 : URL et titre contenant U+202E et U+200B sont rendus a l'identique (reponse GET = reponse POST = base), sans reecriture ni echappement", async () => {
    const org = await createOrganizationFixture("AC9 caracteres de formatage");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    const url = `https://exemple.invalid/chemin${RLO}piege${ZWSP}fin/${Date.now()}`;
    const title = `Titre${RLO} piege${ZWSP} fin`;
    const posted = await postLink(org.owner, org.organizationId, collectionId, { url, title });
    expectStatus(posted, 201, "arrangement : lien aux caracteres de formatage (acceptes, D-119)");
    const postedId = idsOf([posted.body])[0] ?? "";
    const stored = await readLinkById(postedId);
    expect(stored, "ligne enregistree").toBeDefined();
    expect(stored?.url).toBe(url);
    expect(stored?.title).toBe(title);

    const items = expectList(await getLinks(org.owner, org.organizationId, collectionId), "GET du lien aux caracteres de formatage");

    expect(items).toHaveLength(1);
    const [item] = items;
    const read = item as { url: string; title: string };
    const postedBody = posted.body as { url: string; title: string };
    expect(read.url, "URL du GET egale a celle de la base").toBe(stored?.url);
    expect(read.title, "titre du GET egal a celui de la base").toBe(stored?.title);
    expect(read.url, "URL du GET egale a celle du POST").toBe(postedBody.url);
    expect(read.title, "titre du GET egal a celui du POST").toBe(postedBody.title);
    expect(read.url).toBe(url);
    expect(read.title).toBe(title);
    expect(read.url.includes(RLO) && read.url.includes(ZWSP), "les deux caracteres sont encore dans l'URL").toBe(true);
    expect(read.title.includes(RLO) && read.title.includes(ZWSP), "les deux caracteres sont encore dans le titre").toBe(true);
    expect(JSON.stringify(read.url).includes("\\u202e"), "pas d'echappement \\u202e dans la valeur serialisee de l'URL").toBe(false);
  });

  it("AC9 : un nom de collection contenant U+202E et U+200B est rendu a l'identique", async () => {
    const org = await createOrganizationFixture("AC9 nom de collection");
    const name = `Nom${RLO} piege${ZWSP} ${Date.now()}`;
    const posted = await postCollection(org.owner, org.organizationId, { name });
    expectStatus(posted, 201, "arrangement : collection aux caracteres de formatage");
    const stored = await readCollectionById(idsOf([posted.body])[0] ?? "");

    const items = expectList(await getCollections(org.owner, org.organizationId), "GET de la collection aux caracteres de formatage");

    expect(items).toHaveLength(1);
    expect((items[0] as { name: string }).name).toBe(stored?.name);
    expect((items[0] as { name: string }).name).toBe((posted.body as { name: string }).name);
  });
});
