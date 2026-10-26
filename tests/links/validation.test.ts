/**
 * Tranche 005 — validation de l'URL (AC3, US-06.2, securite) et du titre (AC4).
 *
 * Chaque refus est un `422 VALIDATION_FAILED` au message fixe : ni la valeur
 * soumise, ni le message de Zod, ni aucun code SQL ou nom de contrainte
 * (precedent D-114 point 4). Le texte exact du message n'est pas fige : le
 * contrat ne le fixe pas. Aucune entree ne doit produire de 500, et un refus
 * n'ecrit aucune ligne et ne touche pas le compteur.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closeAllPools } from "../helpers/db";
import { createOrganizationFixture, type OrganizationFixture } from "../helpers/fixtures";
import { expectError, expectStatus } from "../helpers/billing";
import {
  closeLinkPools,
  createCollectionViaApi,
  expectCleanErrorBody,
  expectCounterAligned,
  expectUnchanged,
  linkState,
  messageOf,
  postLink,
  readLinks,
  uniqueUrl,
  urlOfLength,
} from "../helpers/links";

afterAll(async () => {
  await closeLinkPools();
  await closeAllPools();
});

let org: OrganizationFixture;
let collectionId: string;

beforeAll(async () => {
  org = await createOrganizationFixture("Validation des liens");
  collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
});

interface UrlCase {
  label: string;
  payload: Record<string, unknown>;
  /** Fragment distinctif de la valeur soumise, qui ne doit jamais revenir dans le corps. */
  leak?: string;
}

const TITLE = "Titre de test";
const withUrl = (url: unknown): Record<string, unknown> => ({ url, title: TITLE });

const REFUSED_URLS: UrlCase[] = [
  { label: "url absente", payload: { title: TITLE } },
  { label: "url null", payload: withUrl(null) },
  { label: "url nombre", payload: withUrl(12345678), leak: "12345678" },
  { label: "url vide", payload: withUrl("") },
  { label: "javascript:", payload: withUrl("javascript:alert(1)"), leak: "alert(1)" },
  { label: "data:", payload: withUrl("data:text/html,x"), leak: "text/html" },
  { label: "file:", payload: withUrl("file:///etc/passwd"), leak: "passwd" },
  { label: "ftp:", payload: withUrl("ftp://exemple.invalid/x"), leak: "exemple.invalid" },
  { label: "sans schema", payload: withUrl("exemple.invalid/x"), leak: "exemple.invalid" },
  { label: "schema relatif //", payload: withUrl("//exemple.invalid/x"), leak: "exemple.invalid" },
  { label: "http:// sans hote", payload: withUrl("http://") },
  { label: "https:// sans hote", payload: withUrl("https://") },
  { label: "http:///chemin sans hote", payload: withUrl("http:///chemin"), leak: "///chemin" },
  { label: "https://?q=1 sans hote", payload: withUrl("https://?q=1"), leak: "q=1" },
  { label: "https://#x sans hote", payload: withUrl("https://#x") },
  { label: "espace interne", payload: withUrl("https://exemple.invalid/a b"), leak: "exemple.invalid" },
  { label: "2049 caracteres", payload: withUrl(urlOfLength(2049)), leak: "aaaaaaaaaaaaaaaaaaaa" },
  { label: "schema en majuscules (D-119 lecture 3)", payload: withUrl("HTTPS://exemple.invalid/"), leak: "exemple.invalid" },
  { label: "caractere de controle \\u0000", payload: withUrl("https://exemple.invalid/a\u0000b"), leak: "exemple.invalid" },
  { label: "caractere de controle \\u0001", payload: withUrl("https://exemple.invalid/a\u0001b"), leak: "exemple.invalid" },
  { label: "identifiants dans l'URL (utilisateur:secret@)", payload: withUrl("https://utilisateur:secret@exemple.invalid/"), leak: "secret" },
  { label: "identifiants piege (site@piege)", payload: withUrl("https://exemple.invalid@piege.invalid/"), leak: "piege.invalid" },
];

describe("AC3 — validation de l'URL (US-06.2, securite, D-120)", () => {
  it.each(REFUSED_URLS)("AC3 : $label -> 422 VALIDATION_FAILED, message fixe, aucune ligne, compteur inchange", async ({ label, payload, leak }) => {
    const before = await linkState(org.organizationId);

    const result = await postLink(org.owner, org.organizationId, collectionId, payload);

    expectError(result, 422, "VALIDATION_FAILED", label);
    expect(typeof messageOf(result), `${label} : un message est fourni`).toBe("string");
    expectCleanErrorBody(result, label, leak ? [leak] : []);
    expect(result.text.length, `${label} : le corps ne reprend pas une URL de 2049 caracteres`).toBeLessThan(1000);
    await expectUnchanged(org.organizationId, before, label);
  });

  it("AC3 : un refus d'URL est annonce par un message fixe, le meme pour la meme cause quelle que soit la valeur", async () => {
    const first = await postLink(org.owner, org.organizationId, collectionId, withUrl("ftp://exemple.invalid/premier"));
    const second = await postLink(org.owner, org.organizationId, collectionId, withUrl("ftp://autre.invalid/second-chemin-different"));

    expectError(first, 422, "VALIDATION_FAILED", "premier ftp");
    expectError(second, 422, "VALIDATION_FAILED", "second ftp");
    expect(messageOf(first)).toBe(messageOf(second));
  });

  it("AC3 : url ET titre invalides -> le message du premier champ fautif, l'url (ordre url puis title)", async () => {
    const urlOnly = await postLink(org.owner, org.organizationId, collectionId, { url: "ftp://exemple.invalid/x", title: TITLE });
    const both = await postLink(org.owner, org.organizationId, collectionId, { url: "ftp://exemple.invalid/x", title: "" });

    expectError(urlOnly, 422, "VALIDATION_FAILED", "url seule invalide");
    expectError(both, 422, "VALIDATION_FAILED", "url et titre invalides");
    expect(messageOf(both)).toBe(messageOf(urlOnly));
  });

  it("AC3 : exactement 2048 caracteres -> 201, enregistree telle quelle", async () => {
    const localOrg = await createOrganizationFixture("AC3 2048");
    const localCollection = await createCollectionViaApi(localOrg.owner, localOrg.organizationId, "Veille");
    const url = urlOfLength(2048);
    expect(url).toHaveLength(2048);

    const result = await postLink(localOrg.owner, localOrg.organizationId, localCollection, withUrl(url));

    expectStatus(result, 201, "URL de 2048 caracteres");
    expect((await readLinks(localOrg.organizationId))[0]?.url).toBe(url);
    expect(await expectCounterAligned(localOrg.organizationId, "apres 2048")).toEqual({ rows: 1, counter: 1 });
  });

  it("AC3 : URL entouree d'espaces -> 201, enregistree sans ses espaces de bord (reponse et base)", async () => {
    const localOrg = await createOrganizationFixture("AC3 trim");
    const localCollection = await createCollectionViaApi(localOrg.owner, localOrg.organizationId, "Veille");
    const url = uniqueUrl();

    const result = await postLink(localOrg.owner, localOrg.organizationId, localCollection, withUrl(`   ${url}   `));

    expectStatus(result, 201, "URL entouree d'espaces");
    expect(result.body).toMatchObject({ url });
    expect((await readLinks(localOrg.organizationId))[0]?.url).toBe(url);
    await expectCounterAligned(localOrg.organizationId, "apres trim");
  });

  it("AC3 : l'URL est enregistree telle que soumise apres trim, jamais reecrite (casse de l'hote, port, requete, fragment : D-119 lecture 3)", async () => {
    const localOrg = await createOrganizationFixture("AC3 telle quelle");
    const localCollection = await createCollectionViaApi(localOrg.owner, localOrg.organizationId, "Veille");
    const urls = [
      "https://EXEMPLE.invalid:8443/Chemin/Casse?x=1&y=2#ancre",
      "http://exemple.invalid",
      "https://exemple.invalid/a%20b/%C3%A9",
    ];

    for (const url of urls) {
      const result = await postLink(localOrg.owner, localOrg.organizationId, localCollection, withUrl(url));
      expectStatus(result, 201, `URL ${url}`);
      expect(result.body, `reponse pour ${url}`).toMatchObject({ url });
    }

    expect((await readLinks(localOrg.organizationId)).map((r) => r.url).sort()).toEqual([...urls].sort());
    await expectCounterAligned(localOrg.organizationId, "apres les URL telles que soumises");
  });
});

interface TitleCase {
  label: string;
  payload: Record<string, unknown>;
  leak?: string;
}

const url = (): string => uniqueUrl();

const REFUSED_TITLES: TitleCase[] = [
  { label: "title absent", payload: { url: url() } },
  { label: "title null", payload: { url: url(), title: null } },
  { label: "title nombre", payload: { url: url(), title: 42 } },
  { label: "title vide", payload: { url: url(), title: "" } },
  { label: "title fait d'espaces", payload: { url: url(), title: "     " } },
  { label: "title de 201 caracteres apres trim", payload: { url: url(), title: `  ${"b".repeat(201)}  ` }, leak: "bbbbbbbbbbbbbbbbbbbb" },
  { label: "title contenant \\u0000", payload: { url: url(), title: "zzqx\u0000yywv" }, leak: "zzqx" },
];

describe("AC4 — validation du titre (US-06.1)", () => {
  it.each(REFUSED_TITLES)("AC4 : $label -> 422 VALIDATION_FAILED, message fixe, aucune ligne, compteur inchange (jamais 500)", async ({ label, payload, leak }) => {
    const before = await linkState(org.organizationId);

    const result = await postLink(org.owner, org.organizationId, collectionId, payload);

    expectError(result, 422, "VALIDATION_FAILED", label);
    expectCleanErrorBody(result, label, leak ? [leak] : []);
    expect(result.text.length, `${label} : le corps ne reprend pas un titre de 201 caracteres`).toBeLessThan(1000);
    await expectUnchanged(org.organizationId, before, label);
  });

  it("AC4 : exactement 200 caracteres -> 201", async () => {
    const localOrg = await createOrganizationFixture("AC4 200");
    const localCollection = await createCollectionViaApi(localOrg.owner, localOrg.organizationId, "Veille");
    const title = "t".repeat(200);

    const result = await postLink(localOrg.owner, localOrg.organizationId, localCollection, { url: uniqueUrl(), title });

    expectStatus(result, 201, "titre de 200 caracteres");
    expect((await readLinks(localOrg.organizationId))[0]?.title).toBe(title);
    await expectCounterAligned(localOrg.organizationId, "apres titre de 200");
  });

  it("AC4 : '  Titre de test  ' -> 201, title = 'Titre de test' en reponse et en base", async () => {
    const localOrg = await createOrganizationFixture("AC4 trim");
    const localCollection = await createCollectionViaApi(localOrg.owner, localOrg.organizationId, "Veille");

    const result = await postLink(localOrg.owner, localOrg.organizationId, localCollection, { url: uniqueUrl(), title: "  Titre de test  " });

    expectStatus(result, 201, "titre entoure d'espaces");
    expect(result.body).toMatchObject({ title: "Titre de test" });
    expect((await readLinks(localOrg.organizationId))[0]?.title).toBe("Titre de test");
    await expectCounterAligned(localOrg.organizationId, "apres trim du titre");
  });

  const unparsableBodies: Array<[string, string]> = [
    ["corps non JSON", "ceci-n'est-pas-du-json{"],
    ["corps vide", ""],
    ["corps tableau JSON", JSON.stringify([{ url: "https://exemple.invalid/x", title: "T" }])],
    ["corps nombre JSON", JSON.stringify(42)],
    ["corps chaine JSON", JSON.stringify("https://exemple.invalid/x")],
    ["corps null JSON", JSON.stringify(null)],
  ];

  it.each(unparsableBodies)("AC4 : %s -> 422 VALIDATION_FAILED, aucune ligne", async (label, payload) => {
    const before = await linkState(org.organizationId);

    const result = await postLink(org.owner, org.organizationId, collectionId, payload);

    expectError(result, 422, "VALIDATION_FAILED", label);
    expectCleanErrorBody(result, label);
    await expectUnchanged(org.organizationId, before, label);
  });
});
