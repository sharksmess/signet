/**
 * Tranche 012 — page de collection : AC10 (liens : `<a>`, href normalise,
 * target, rel, hote a part en punycode, aucune valeur libre hors href), ordre
 * des liens (celui de listLinks), auteur (adresse lue dans listMembers, « ancien
 * membre » sinon, L-4), date UTC au format fixe (L-5), etat vide, titre de page
 * fixe.
 *
 * Les liens sont inseres sous `signet_app` (declencheur de compteur) pour
 * maitriser l'URL exacte ; les auteurs sont l'owner et un member reel
 * (invitation 003 puis acceptation 006).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insertCollectionDirect } from "../helpers/collections";
import { expectList, getLinks } from "../helpers/consultation";
import { closeAllPools } from "../helpers/db";
import { createOrganizationFixture, type OrganizationFixture } from "../helpers/fixtures";
import { resetInvitationFakes, startInvitationFakes, stopInvitationFakes, type InvitationFakes } from "../helpers/invitations";
import { readLinkById } from "../helpers/links";
import { signUpAndJoin } from "../helpers/screen-reads";
import {
  addLinkDirect,
  allTags,
  expectFullStatus,
  formatUtc,
  getFullPage,
  hrefsOf,
  rowsOf,
  tagsNamed,
  testIdText,
  textOf,
  removeMemberDirect,
  uniqueOrgName,
  type FullPage,
} from "../helpers/screens";
import type { AuthenticatedSession } from "../helpers/auth";

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

interface Scenario {
  org: OrganizationFixture;
  member: AuthenticatedSession;
  collectionId: string;
  collectionName: string;
  /** Dans l'ordre d'insertion. */
  links: { id: string; url: string; title: string; authorEmail: string }[];
}

async function scenario(): Promise<Scenario> {
  const org = await createOrganizationFixture(uniqueOrgName("collection"));
  const member = await signUpAndJoin(fakes, org);
  const collectionName = `Collection-Test-${Date.now()}`;
  const collection = await insertCollectionDirect({ organizationId: org.organizationId, name: collectionName, createdByUserId: org.owner.userId });
  const specs: { url: string; title: string; by: AuthenticatedSession }[] = [
    { url: "https://exemple.invalid/chemin/é?q=1&r=2#ancre", title: "Titre-Test-accent", by: org.owner },
    { url: "https://bücher.invalid/page", title: "Titre-Test-idn", by: member },
    { url: "http://exemple.invalid/simple", title: "Titre-Test-http", by: org.owner },
  ];
  const links: Scenario["links"] = [];
  for (const spec of specs) {
    const id = await addLinkDirect({ organizationId: org.organizationId, collectionId: collection.id, userId: spec.by.userId, url: spec.url, title: spec.title });
    links.push({ id, url: spec.url, title: spec.title, authorEmail: spec.by.email });
  }
  return { org, member, collectionId: collection.id, collectionName, links };
}

function collectionPath(s: Scenario): string {
  return `/organisations/${s.org.organizationId}/collections/${s.collectionId}`;
}

async function openCollection(s: Scenario, session: AuthenticatedSession): Promise<FullPage> {
  const full = await getFullPage(collectionPath(s), session);
  expectFullStatus(full, 200, "page de collection de l'arrangement");
  return full;
}

function rowFor(html: string, title: string): string {
  const row = rowsOf(html, "link-row").find((candidate) => textOf(candidate).includes(title));
  if (row === undefined) throw new Error(`aucune ligne link-row pour le titre ${JSON.stringify(title)}. Corps brut : ${html}`);
  return row;
}

describe("page de collection : contenu et ordre", () => {
  it("les liens sont dans l'ordre de listLinks (created_at DESC, id DESC), avec nom de l'organisation et de la collection", async () => {
    const s = await scenario();
    const expectedTitles = expectList(await getLinks(s.org.owner, s.org.organizationId, s.collectionId), "listLinks").map((item) => String((item as { title: string }).title));

    const full = await openCollection(s, s.org.owner);

    expectFullStatus(full, 200, "page de collection");
    expect(rowsOf(full.html.text, "link-row").map((row) => s.links.find((l) => textOf(row).includes(l.title))?.title)).toEqual(expectedTitles);
    expect(expectedTitles).toEqual([...s.links].reverse().map((l) => l.title));
    const text = textOf(full.html.text);
    expect(text).toContain(s.org.name);
    expect(text).toContain(s.collectionName);
    expect(rowsOf(full.html.text, "link-row")).toHaveLength(3);
  });

  it("le member voit la meme page de collection (mêmes liens, même ordre) et le formulaire d'ajout de lien", async () => {
    const s = await scenario();

    const asOwner = await openCollection(s, s.org.owner);
    const asMember = await openCollection(s, s.member);

    expectFullStatus(asMember, 200, "page de collection (member)");
    expect(rowsOf(asMember.html.text, "link-row").map(textOf)).toEqual(rowsOf(asOwner.html.text, "link-row").map(textOf));
    expect(asMember.html.text).toContain("add-link-form");
  });

  it("auteur : l'adresse lue dans listMembers ; « ancien membre » si l'auteur n'est plus membre (L-4)", async () => {
    const s = await scenario();
    const before = await openCollection(s, s.org.owner);
    expect(textOf(rowFor(before.html.text, "Titre-Test-idn"))).toContain(s.member.email);

    await removeMemberDirect(s.org.organizationId, s.member.userId);
    const after = await openCollection(s, s.org.owner);

    expectFullStatus(after, 200, "page de collection apres retrait de l'auteur");
    const row = textOf(rowFor(after.html.text, "Titre-Test-idn"));
    expect(row).toContain("ancien membre");
    expect(row).not.toContain(s.member.email);
    expect(textOf(rowFor(after.html.text, "Titre-Test-accent"))).toContain(s.org.owner.email);
    expect(after.rsc.text, "l'adresse de l'ancien membre n'est pas dans la charge RSC").not.toContain(s.member.email);
  });

  it("date : UTC, format fixe AAAA-MM-JJ HH:MM UTC, calculee depuis created_at enregistre (L-5)", async () => {
    const s = await scenario();

    const full = await openCollection(s, s.org.owner);

    expectFullStatus(full, 200, "page de collection");
    for (const link of s.links) {
      const stored = await readLinkById(link.id);
      expect(stored, `lien ${link.id} en base`).toBeDefined();
      const expected = formatUtc(stored?.created_at ?? new Date(0));
      expect(expected).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
      expect(textOf(rowFor(full.html.text, link.title)), `date du lien ${link.title}`).toContain(expected);
    }
  });

  it("etat vide : une collection sans lien l'indique explicitement", async () => {
    const org = await createOrganizationFixture(uniqueOrgName("vide"));
    const collection = await insertCollectionDirect({ organizationId: org.organizationId, name: `Collection-Test-vide-${Date.now()}`, createdByUserId: org.owner.userId });

    const full = await getFullPage(`/organisations/${org.organizationId}/collections/${collection.id}`, org.owner);

    expectFullStatus(full, 200, "collection vide");
    expect(rowsOf(full.html.text, "link-row")).toEqual([]);
    expect(allTags(full.html.text).some((tag) => tag.attributes["data-testid"] === "empty-links")).toBe(true);
  });

  it("le titre de la page (<title>) est fixe : aucune valeur libre (nom d'organisation, de collection, titre)", async () => {
    const s = await scenario();

    const full = await openCollection(s, s.org.owner);

    const title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(full.html.text)?.[1] ?? "";
    expect(title.length, `balise <title> presente. Corps brut : ${full.html.text}`).toBeGreaterThan(0);
    for (const free of [s.org.name, s.collectionName, ...s.links.map((l) => l.title), s.org.owner.email]) expect(title).not.toContain(free);
  });
});

describe("AC10 : liens", () => {
  it("AC10 : chaque lien est un <a> avec href = new URL(url).href (non ASCII encode en %XX), target=\"_blank\" et rel=\"noopener noreferrer\"", async () => {
    const s = await scenario();

    const full = await openCollection(s, s.org.owner);

    expectFullStatus(full, 200, "AC10 : page de collection");
    for (const link of s.links) {
      const row = rowFor(full.html.text, link.title);
      const external = tagsNamed(row, "a").filter((tag) => tag.attributes.href === new URL(link.url).href);
      expect(external, `AC10 : un <a href=${new URL(link.url).href}> dans la ligne de ${link.title}. Ligne : ${row}`).toHaveLength(1);
      expect(external[0]?.attributes.target).toBe("_blank");
      expect(external[0]?.attributes.rel?.split(/\s+/).sort()).toEqual(["noopener", "noreferrer"]);
    }
    expect(new URL(s.links[0]?.url ?? "").href).toContain("%C3%A9");
  });

  it("AC10 : le nom d'hote est affiche a part (new URL(url).hostname) ; un hote IDN est montre en punycode xn--...", async () => {
    const s = await scenario();

    const full = await openCollection(s, s.org.owner);

    for (const link of s.links) {
      const hostname = testIdText(rowFor(full.html.text, link.title), "link-hostname");
      expect(hostname, `hote de ${link.title}`).toBe(new URL(link.url).hostname);
    }
    expect(testIdText(rowFor(full.html.text, "Titre-Test-idn"), "link-hostname")).toBe("xn--bcher-kva.invalid");
  });

  it("AC10 : l'URL est aussi affichee en texte (valeur enregistree)", async () => {
    const s = await scenario();

    const full = await openCollection(s, s.org.owner);

    for (const link of s.links) expect(textOf(rowFor(full.html.text, link.title))).toContain(link.url);
  });

  it("AC10 : aucune valeur libre dans un autre attribut que href (titres, noms, adresses, URL absents de tout attribut, charge embarquee exceptee)", async () => {
    const s = await scenario();
    const full = await openCollection(s, s.org.owner);
    const free = [s.org.name, s.collectionName, s.org.owner.email, s.member.email, ...s.links.flatMap((l) => [l.title, l.url, new URL(l.url).hostname])];

    for (const tag of allTags(full.html.text)) {
      for (const [attribute, value] of Object.entries(tag.attributes)) {
        if (attribute === "href") continue;
        for (const value2 of free) {
          expect(value, `attribut ${attribute} de <${tag.name}> ne doit pas contenir ${JSON.stringify(value2)}`).not.toContain(value2);
        }
      }
    }
  });

  it("AC10 : tout href de la page est soit un chemin interne /..., soit l'URL normalisee d'un lien enregistre", async () => {
    const s = await scenario();
    const full = await openCollection(s, s.org.owner);
    const allowedExternal = new Set(s.links.map((l) => new URL(l.url).href));

    for (const href of hrefsOf(full.html.text)) {
      expect(href.startsWith("/") || allowedExternal.has(href), `href inattendu : ${href}`).toBe(true);
    }
  });
});
