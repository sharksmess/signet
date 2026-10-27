/**
 * Tranche 005 — schema du contrat `addLink.input`, importe tel quel (unitaire,
 * sans base ni serveur) : D-126 (caracteres de controle C0, U+007F et C1 dans
 * l'URL) et D-125 (U+0000 dans le titre refuse par le contrat, pas par la route).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { addLink } from "../../docs/02-architecture/api-contracts/links";

function parse(fields: { url?: unknown; title?: unknown }): boolean {
  return addLink.input.safeParse({
    organizationId: randomUUID(),
    collectionId: randomUUID(),
    url: "https://exemple.invalid/article",
    title: "Titre de test",
    ...fields,
  }).success;
}

describe("D-126 — url : caracteres de controle", () => {
  it("temoin : une entree valide est acceptee par le schema", () => {
    expect(parse({})).toBe(true);
  });

  it.each([
    ["U+0000", "\u0000"],
    ["U+0001", "\u0001"],
    ["U+001F", "\u001f"],
    ["U+007F", "\u007f"],
    ["U+0080", "\u0080"],
    ["U+0085", "\u0085"],
    ["U+009F", "\u009f"],
  ])("%s au milieu de l'URL -> refuse", (_label, character) => {
    expect(parse({ url: `https://exemple.invalid/a${character}b` })).toBe(false);
  });

  it("toute la plage C1 (U+0080 a U+009F) est refusee, dans le chemin comme dans l'hote", () => {
    const accepted: string[] = [];
    for (let code = 0x80; code <= 0x9f; code += 1) {
      const character = String.fromCharCode(code);
      if (parse({ url: `https://exemple.invalid/a${character}b` })) accepted.push(`chemin U+${code.toString(16)}`);
      if (parse({ url: `https://exemple${character}.invalid/` })) accepted.push(`hote U+${code.toString(16)}`);
    }
    expect(accepted).toEqual([]);
  });

  it("temoin : U+00A0 et U+00E9 ne sont pas des caracteres de controle", () => {
    expect(parse({ url: "https://exemple.invalid/café" })).toBe(true);
  });
});

describe("D-125 — title : U+0000 refuse par le schema du contrat", () => {
  it("un titre contenant U+0000 est refuse", () => {
    expect(parse({ title: "Titre\u0000x" })).toBe(false);
  });

  it("U+0000 en debut ou en fin de titre est refuse aussi", () => {
    expect(parse({ title: "\u0000Titre" })).toBe(false);
    expect(parse({ title: "Titre\u0000" })).toBe(false);
  });

  it("temoin : un titre sans U+0000, accents compris, est accepte", () => {
    expect(parse({ title: "Titre de test été" })).toBe(true);
  });
});
