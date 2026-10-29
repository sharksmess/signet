/**
 * Tranche 012 — le helper `maskAddressDerivedKeys` (D-149) ne masque que les cles React d'en-tete que Next derive de
 * l'adresse, a leur seul emplacement (position de cle d'un element de la charge RSC). Il ne touche jamais un attribut
 * HTML ni une valeur de page : D-149 affirmait a tort qu'aucune valeur de test ne pouvait correspondre
 * (`data-testid="create-collection-form"` comptait 22 caracteres finissant par « m »).
 */
import { describe, expect, it } from "vitest";
import { maskAddressDerivedKeys } from "../helpers/screens";

const BS = String.fromCharCode(92);
const MASK = "CLE_ENTETE_FIXE";
const MARKERS = [
  "empty-organizations",
  "organization-row",
  "link-row",
  "link-title",
  "link-hostname",
  "link-author",
  "link-date",
  "add-link-form",
  "empty-collections",
  "collection-row",
  "member-row",
  "subscription-block",
  "empty-links",
  "create-collection-form",
  "create-organization-form",
  "invite-form",
  "sign-in-form",
  "sign-up-form",
];

describe("D-149 : maskAddressDerivedKeys", () => {
  it("masque les cles d'en-tete de la charge RSC brute, a leur position de cle d'element", () => {
    const raw = '[["$","$L12","WnSWjvHEfVQg_MSUWxg49v",{"children":"$L13"}],["$","$L15","WnSWjvHEfVQg_MSUWxg49m",{"children":[]}]]';

    expect(maskAddressDerivedKeys(raw)).toBe(`[["$","$L12","${MASK}",{"children":"$L13"}],["$","$L15","${MASK}",{"children":[]}]]`);
  });

  it("masque les memes cles dans la forme echappee du script du HTML", () => {
    const escaped = `[${BS}"$${BS}",${BS}"$L12${BS}",${BS}"RVpi__zNqOAqsllFLRRDkv${BS}",{${BS}"children${BS}":${BS}"$L12${BS}"}]`;

    const masked = maskAddressDerivedKeys(escaped);

    expect(masked).toContain(`${BS}"$L12${BS}",${BS}"${MASK}${BS}",{`);
    expect(masked).not.toContain("RVpi__zNqOAqsllFLRRDkv");
  });

  it("deux adresses donnent des charges differentes seulement par ces cles : apres masque, elles sont egales", () => {
    const of = (key: string): string => `["$","$L12","${key}v",{"children":"$L13"}],["$","$L15","${key}m",{"children":[]}]`;

    expect(maskAddressDerivedKeys(of("AAAAAAAAAAAAAAAAAAAAA"))).toBe(maskAddressDerivedKeys(of("BBBBBBBBBBBBBBBBBBBBB")));
  });

  it.each(MARKERS)("le marqueur data-testid=%s n'est jamais masque (HTML, JSON brut et echappe)", (marker) => {
    const html = `<form data-testid="${marker}"><h2>Titre</h2></form>`;
    const rscRaw = `["$","form",null,{"data-testid":"${marker}","children":"x"}]`;
    const rscEscaped = `[${BS}"$${BS}",${BS}"form${BS}",null,{${BS}"data-testid${BS}":${BS}"${marker}${BS}"}]`;

    expect(maskAddressDerivedKeys(html)).toBe(html);
    expect(maskAddressDerivedKeys(rscRaw)).toBe(rscRaw);
    expect(maskAddressDerivedKeys(rscEscaped)).toBe(rscEscaped);
  });

  it("une valeur de page de 21 caracteres suivie de « v » ou « m », hors position de cle d'element, n'est pas masquee", () => {
    const text = '<p>"WnSWjvHEfVQg_MSUWxg49v"</p>{"children":"WnSWjvHEfVQg_MSUWxg49m"},["$","div","WnSWjvHEfVQg_MSUWxg49m",{}]';

    expect(maskAddressDerivedKeys(text)).toBe(text);
  });
});
