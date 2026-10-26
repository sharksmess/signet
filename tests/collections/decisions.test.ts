/**
 * Tranche 004 — preuve de D-114 point 4 (review-004, A CORRIGER 1) : les
 * reponses d'erreur de `POST /api/organizations/:organizationId/collections`
 * portent des messages FIXES, compares par egalite a la liste exacte ci-dessous,
 * jamais le message de Zod ni la valeur soumise.
 *
 * Chaque test echoue si l'on retire la decision qu'il protege : la mutation
 * `validationFailed(parsed.error.message)` dans la route fait echouer les cas
 * « chemin invalide » et « nom invalide » (journal de tranche, section
 * Decisions).
 */
import { describe, it, expect, afterAll } from "vitest";
import { closeAllPools } from "../helpers/db";
import { createOrganizationFixture } from "../helpers/fixtures";
import { expectError, type HttpResult } from "../helpers/billing";
import { nameOfLength, postCollection, uniqueCollectionName } from "../helpers/collections";

afterAll(async () => {
  await closeAllPools();
});

/** Liste exacte des textes fixes de la route (D-114 point 4). */
const BODY_EXPECTED = "Corps JSON attendu.";
const INVALID_ORGANIZATION_ID = "Identifiant d'organisation invalide.";
const INVALID_NAME = "Nom de collection invalide : 1 a 100 caracteres, espaces de bord exclus.";
const NAME_TAKEN = "Une collection de cette organisation porte deja ce nom.";

/** Fragments propres aux messages de Zod 4 (`parsed.error.message`), jamais dans un texte fixe. */
const ZOD_FRAGMENTS = ["Too big", "Too small", "too_big", "too_small", "expected", "received", "Invalid", "invalid_type", "invalid_format", "\"path\"", "\"code\": \""];

function messageOf(result: HttpResult): unknown {
  const body = result.body;
  return typeof body === "object" && body !== null && "message" in body ? body.message : undefined;
}

function expectNoZodFragment(result: HttpResult, label: string): void {
  for (const fragment of ZOD_FRAGMENTS) {
    expect(result.text, `${label} : fragment de Zod ${JSON.stringify(fragment)} dans le corps`).not.toContain(fragment);
  }
}

describe("D-114 point 4 — 422 : corps non JSON ou non objet", () => {
  const cases: Array<[string, string]> = [
    ["corps non JSON", "ceci-n'est-pas-du-json{"],
    ["corps tableau JSON", JSON.stringify(["Veille"])],
    ["corps nombre JSON", JSON.stringify(42)],
    ["corps null JSON", JSON.stringify(null)],
  ];

  it.each(cases)("%s -> message exact « Corps JSON attendu. »", async (label, payload) => {
    const org = await createOrganizationFixture("D-114 corps");

    const result = await postCollection(org.owner, org.organizationId, payload);

    expectError(result, 422, "VALIDATION_FAILED", label);
    expect(messageOf(result), label).toBe(BODY_EXPECTED);
    expectNoZodFragment(result, label);
  });
});

describe("D-114 point 4 — 422 : organizationId du chemin invalide", () => {
  it.each([["pas-un-uuid"], ["12345678-1234-1234-1234-12345678901Z"]])(
    "chemin %s -> message exact « Identifiant d'organisation invalide. »",
    async (badId) => {
      const org = await createOrganizationFixture("D-114 chemin");

      const result = await postCollection(org.owner, badId, { name: uniqueCollectionName() });

      expectError(result, 422, "VALIDATION_FAILED", `chemin ${badId}`);
      expect(messageOf(result)).toBe(INVALID_ORGANIZATION_ID);
      expectNoZodFragment(result, `chemin ${badId}`);
    },
  );

  it("chemin invalide ET nom invalide -> le texte du chemin (le chemin prime)", async () => {
    const org = await createOrganizationFixture("D-114 chemin et nom");

    const result = await postCollection(org.owner, "pas-un-uuid", { name: "" });

    expectError(result, 422, "VALIDATION_FAILED", "chemin et nom invalides");
    expect(messageOf(result)).toBe(INVALID_ORGANIZATION_ID);
  });
});

describe("D-114 point 4 — 422 : nom invalide", () => {
  const cases: Array<[string, unknown]> = [
    ["nom absent", {}],
    ["nom vide", { name: "" }],
    ["nom fait d'espaces", { name: "    " }],
    ["nom de 101 caracteres", { name: nameOfLength(101) }],
    ["nom nombre", { name: 7 }],
    ["nom null", { name: null }],
    ["nom tableau", { name: ["Veille"] }],
  ];

  it.each(cases)("%s -> message exact du nom invalide, sans fragment de Zod", async (label, payload) => {
    const org = await createOrganizationFixture("D-114 nom");

    const result = await postCollection(org.owner, org.organizationId, payload);

    expectError(result, 422, "VALIDATION_FAILED", label);
    expect(messageOf(result), label).toBe(INVALID_NAME);
    expectNoZodFragment(result, label);
  });
});

describe("D-114 point 4 — 409 : texte unique", () => {
  it("nom deja pris -> message exact « Une collection de cette organisation porte deja ce nom. »", async () => {
    const org = await createOrganizationFixture("D-114 409");
    const name = uniqueCollectionName();
    expect((await postCollection(org.owner, org.organizationId, { name })).status).toBe(201);

    const result = await postCollection(org.owner, org.organizationId, { name: ` ${name.toUpperCase()} ` });

    expectError(result, 409, "COLLECTION_NAME_TAKEN", "nom pris");
    expect(messageOf(result)).toBe(NAME_TAKEN);
  });
});
