/**
 * Tranche 012 — AC8 (valeurs piegees), AC9 (marqueurs, liste fermee), AC10
 * (liens : attributs, hote a part, aucune valeur libre hors href), parties lues
 * par le serveur. Les fonctions pures sont dans visible-text.test.ts ; les
 * verifications de source dans sources.test.ts.
 *
 * Les valeurs sont enregistrees telles quelles (organisation par la vraie route ;
 * collections et liens inseres directement, pour des valeurs que les routes
 * refuseraient ou normaliseraient) puis relues en base apres affichage : la valeur
 * enregistree ne change pas.
 *
 * Lecture de « non echappee » : dans le HTML, aucune suite piegee brute ; dans la
 * charge RSC (text/x-component, pas du HTML), les valeurs restent des chaines JSON
 * (donc a echapper cote navigateur par React) : on exige qu'elle ne porte aucune
 * cle `__html` (aucun HTML brut injecte) et qu'elle soit servie exactement comme
 * text/x-component (type de media egal, D-146 point 2).
 * Les caracteres invisibles, eux, ne doivent apparaitre sous AUCUNE forme brute,
 * dans le HTML comme dans la charge RSC.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertCollectionDirect, readCollectionById } from "../helpers/collections";
import { closeAllPools } from "../helpers/db";
import { createOrganizationFixture, readOrganizationNameDirect, type OrganizationFixture } from "../helpers/fixtures";
import { readLinkById } from "../helpers/links";
import {
  addLinkDirect,
  allTags,
  bothOf,
  expectFullStatus,
  getFullPage,
  IMG_TRAP,
  JS_TRAP,
  MARKED_CODE_POINTS,
  markerOf,
  rowsOf,
  SCRIPT_TRAP,
  textOf,
  type FullPage,
} from "../helpers/screens";

const RLO = "‮";
const ZWSP = "​";

interface Trapped {
  org: OrganizationFixture;
  collectionId: string;
  collectionName: string;
  linkIds: string[];
  linkTitles: string[];
  trapUrl: string;
  pages: Record<"list" | "organization" | "collection", FullPage>;
}

let trapped: Trapped;

beforeAll(async () => {
  const org = await createOrganizationFixture(`Org-Test-${SCRIPT_TRAP}-${RLO}-${ZWSP}-fin`);
  const collectionName = `Collection-Test-${IMG_TRAP}-${RLO}-${Date.now()}`;
  const collection = await insertCollectionDirect({ organizationId: org.organizationId, name: collectionName, createdByUserId: org.owner.userId });
  const trapUrl = `https://exemple.invalid/${SCRIPT_TRAP}/chemin-${RLO}-fin`;
  const linkTitles = [JS_TRAP, `Titre-Test-${IMG_TRAP}`, `Titre-Test-${RLO}-fin`, ZWSP, `Titre-Test-${ZWSP}-milieu`];
  const linkIds: string[] = [];
  for (const [index, title] of linkTitles.entries()) {
    linkIds.push(
      await addLinkDirect({
        organizationId: org.organizationId,
        collectionId: collection.id,
        userId: org.owner.userId,
        url: index === 0 ? trapUrl : `https://exemple.invalid/ok-${index}`,
        title,
      }),
    );
  }
  trapped = {
    org,
    collectionId: collection.id,
    collectionName,
    linkIds,
    linkTitles,
    trapUrl,
    pages: {
      list: await getFullPage("/organisations", org.owner),
      organization: await getFullPage(`/organisations/${org.organizationId}`, org.owner),
      collection: await getFullPage(`/organisations/${org.organizationId}/collections/${collection.id}`, org.owner),
    },
  };
});

afterAll(async () => {
  await closeAllPools();
});

const TRAP_NAMES = ["list", "organization", "collection"] as const;

describe("AC8 : valeurs piegees", () => {
  it.each(TRAP_NAMES)("AC8 : la page %s repond 200 (la precondition : les valeurs sont affichees, pas absentes)", (name) => {
    expectFullStatus(trapped.pages[name], 200, `AC8 : page ${name}`);
  });

  it.each(TRAP_NAMES)("AC8 : %s : aucune suite piegee brute dans le HTML (<script>, \"><img onerror, href javascript:)", (name) => {
    expectFullStatus(trapped.pages[name], 200, `AC8 : page ${name} (precondition : la page est servie)`);
    const html = trapped.pages[name].html.text;

    expect(html, "script").not.toContain(SCRIPT_TRAP);
    expect(html, "script ouvrant").not.toContain("<script>alert(1)");
    expect(html, "img").not.toContain(IMG_TRAP);
    expect(html, "img ouvrante").not.toContain("<img src=x");
    expect(html, "href javascript:").not.toMatch(/href\s*=\s*["']?\s*javascript:/i);
    for (const tag of allTags(html)) {
      for (const [attribute, value] of Object.entries(tag.attributes)) {
        expect(value, `attribut ${attribute} de <${tag.name}>`).not.toMatch(/^\s*javascript:/i);
        expect(attribute, `<${tag.name}> : aucun gestionnaire d'evenement`).not.toMatch(/^on[a-z]+$/);
      }
    }
  });

  it.each(TRAP_NAMES)("AC8 : %s : la charge RSC n'injecte aucun HTML brut (pas de __html) et est servie exactement comme text/x-component", (name) => {
    expectFullStatus(trapped.pages[name], 200, `AC8 : page ${name} (precondition : la page est servie)`);
    const rsc = trapped.pages[name].rsc;

    expect(rsc.text, "cle __html").not.toContain("__html");
    const mediaType = (rsc.contentType ?? "").split(";")[0]?.trim().toLowerCase();
    expect(mediaType, `type de contenu de la charge RSC (en-tete brut : ${rsc.contentType})`).toBe("text/x-component");
    expect(rsc.text.length, "la charge RSC n'est pas vide").toBeGreaterThan(0);
  });

  it("AC8 : le nom d'organisation piege est affiche echappe (texte visible), jamais interprete", () => {
    for (const name of ["list", "organization", "collection"] as const) {
      const page = trapped.pages[name];
      expect(page.html.text, `HTML ${name}`).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(textOf(page.html.text), `texte visible ${name}`).toContain(`Org-Test-${SCRIPT_TRAP}-[U+202E]-[U+200B]-fin`);
    }
  });

  it("AC8 : le nom de collection piege est affiche echappe sur la page d'organisation et sur celle de la collection", () => {
    for (const name of ["organization", "collection"] as const) {
      expect(trapped.pages[name].html.text).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
      expect(textOf(trapped.pages[name].html.text), `texte visible ${name}`).toContain(`Collection-Test-${IMG_TRAP}-[U+202E]-`);
    }
  });

  it("AC8 : titres et chemin d'URL pieges affiches echappes sur la page de la collection ; le titre javascript: est du texte, pas un lien", () => {
    const html = trapped.pages.collection.html.text;
    const text = textOf(html);

    expect(text).toContain(JS_TRAP);
    expect(text).toContain(`Titre-Test-${IMG_TRAP}`);
    expect(text).toContain("Titre-Test-[U+202E]-fin");
    expect(text).toContain("Titre-Test-[U+200B]-milieu");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    const rows = rowsOf(html, "link-row");
    expect(rows).toHaveLength(trapped.linkTitles.length);
    for (const tag of allTags(html)) {
      if (tag.name === "a") expect(tag.attributes.href ?? "", "href d'un lien").not.toMatch(/^\s*javascript:/i);
    }
  });

  it("AC8 : un titre fait du seul U+200B s'affiche comme [U+200B] (jamais vide, jamais brut)", () => {
    expectFullStatus(trapped.pages.collection, 200, "AC8 : precondition");
    const rows = rowsOf(trapped.pages.collection.html.text, "link-row").map(textOf);

    expect(rows.some((row) => row.includes("[U+200B]"))).toBe(true);
    for (const { label, text } of bothOf(trapped.pages.collection)) expect(text, `${label} : U+200B brut`).not.toContain(ZWSP);
  });

  it.each(TRAP_NAMES)("AC8 : %s : ni U+202E ni U+200B bruts dans le HTML ni dans la charge RSC", (name) => {
    expectFullStatus(trapped.pages[name], 200, `AC8 : page ${name} (precondition : la page est servie)`);
    for (const { label, text } of bothOf(trapped.pages[name])) {
      expect(text, `${label} : U+202E brut`).not.toContain(RLO);
      expect(text, `${label} : U+200B brut`).not.toContain(ZWSP);
    }
  });

  it("AC8 : les valeurs enregistrees sont inchangees apres affichage", async () => {
    expectFullStatus(trapped.pages.collection, 200, "AC8 : precondition, la collection a ete affichee");
    expect(await readOrganizationNameDirect(trapped.org.organizationId)).toBe(trapped.org.name);
    expect((await readCollectionById(trapped.collectionId))?.name).toBe(trapped.collectionName);
    for (const [index, id] of trapped.linkIds.entries()) expect((await readLinkById(id))?.title).toBe(trapped.linkTitles[index]);
    expect((await readLinkById(trapped.linkIds[0] ?? ""))?.url).toBe(trapped.trapUrl);
  });
});

describe("AC9 : marqueurs de la liste fermee dans les noms et titres enregistres", () => {
  const ALL = MARKED_CODE_POINTS.map((codePoint) => `a${String.fromCodePoint(codePoint)}b`).join("");
  const ALL_MARKED = MARKED_CODE_POINTS.map((codePoint) => `a${markerOf(codePoint)}b`).join("");
  const EMOJI = "\u{1F469}‍\u{1F4BB}";
  let org: OrganizationFixture;
  let collectionId: string;
  let linkId: string;
  let names: { org: string; collection: string; title: string };
  let pages: Record<"list" | "organization" | "collection", FullPage>;

  beforeAll(async () => {
    names = {
      org: `Org-Test-M-${ALL}-${EMOJI}-fin`,
      collection: `Collection-Test-M-${ALL}-${EMOJI}-fin`,
      title: `Titre-Test-M-${ALL}-${EMOJI}-fin`,
    };
    org = await createOrganizationFixture(names.org);
    const collection = await insertCollectionDirect({ organizationId: org.organizationId, name: names.collection, createdByUserId: org.owner.userId });
    collectionId = collection.id;
    linkId = await addLinkDirect({
      organizationId: org.organizationId,
      collectionId,
      userId: org.owner.userId,
      url: "https://exemple.invalid/marqueurs",
      title: names.title,
    });
    pages = {
      list: await getFullPage("/organisations", org.owner),
      organization: await getFullPage(`/organisations/${org.organizationId}`, org.owner),
      collection: await getFullPage(`/organisations/${org.organizationId}/collections/${collectionId}`, org.owner),
    };
  });

  it("AC9 : precondition : la valeur de test contient bien les 15 caracteres de la liste, et l'organisation a garde son nom (la route ne l'a pas altere)", async () => {
    expectFullStatus(pages.organization, 200, "AC9 : precondition");
    expect(MARKED_CODE_POINTS).toHaveLength(15);
    expect(await readOrganizationNameDirect(org.organizationId)).toBe(names.org);
  });

  it.each(TRAP_NAMES)("AC9 : %s : chaque caractere de la liste est rendu par son marqueur [U+XXXX] dans le texte visible", (name) => {
    expectFullStatus(pages[name], 200, `AC9 : page ${name}`);
    const text = textOf(pages[name].html.text);

    expect(text).toContain(`Org-Test-M-${ALL_MARKED}-${EMOJI}-fin`);
    if (name !== "list") expect(text).toContain(`Collection-Test-M-${ALL_MARKED}-${EMOJI}-fin`);
    if (name === "collection") expect(text).toContain(`Titre-Test-M-${ALL_MARKED}-${EMOJI}-fin`);
  });

  it.each(TRAP_NAMES)("AC9 : %s : aucun des 15 caracteres n'apparait sous une forme brute, ni dans le HTML ni dans la charge RSC", (name) => {
    expectFullStatus(pages[name], 200, `AC9 : page ${name} (precondition : la page est servie)`);
    for (const { label, text } of bothOf(pages[name])) {
      for (const codePoint of MARKED_CODE_POINTS) {
        expect(text.includes(String.fromCodePoint(codePoint)), `${label} : U+${codePoint.toString(16).toUpperCase()} brut dans ${name}`).toBe(false);
      }
    }
  });

  it.each(TRAP_NAMES)("AC9 : %s : l'emoji compose (U+1F469 U+200D U+1F4BB) s'affiche intact, sans marqueur, dans le HTML et dans la charge RSC", (name) => {
    expectFullStatus(pages[name], 200, `AC9 : page ${name} (precondition : la page est servie)`);
    for (const { label, text } of bothOf(pages[name])) {
      expect(text, `${label} : emoji compose intact`).toContain(EMOJI);
      expect(text, `${label} : pas de marqueur pour U+200D`).not.toContain("[U+200D]");
    }
  });

  it("AC9 : les marqueurs sont aussi dans la charge RSC (la transformation est faite cote serveur, avant les composants)", () => {
    expect(pages.collection.rsc.text).toContain(markerOf(0x202e));
    expect(pages.collection.rsc.text).toContain(markerOf(0xfeff));
  });

  it("AC9 : la valeur enregistree est inchangee apres affichage (organisation, collection, titre)", async () => {
    expectFullStatus(pages.collection, 200, "AC9 : precondition, la collection a ete affichee");
    expect(await readOrganizationNameDirect(org.organizationId)).toBe(names.org);
    expect((await readCollectionById(collectionId))?.name).toBe(names.collection);
    expect((await readLinkById(linkId))?.title).toBe(names.title);
  });
});
