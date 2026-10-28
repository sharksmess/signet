/**
 * Tranche 012 — AC9 (partie fonction pure) et AC10 (lien sur, fonction pure).
 *
 * Import attendu (chemins relatifs a apps/web/src/) et signatures fixees :
 *   ui/visible-text.ts : export function visibleText(value: string): string
 *   ui/safe-link.tsx   : export function safeLink(url: string):
 *                          | { kind: "link"; href: string; hostname: string }
 *                          | { kind: "text" }
 * (voir tests/helpers/screens-ui.ts ; chargement dynamique tant que les modules n'existent pas)
 */
import { describe, expect, it } from "vitest";
import { MARKED_CODE_POINTS, markerOf } from "../helpers/screens";
import { loadSafeLink, loadVisibleText } from "../helpers/screens-ui";

describe("AC9 : texte visible (fonction pure, liste fermee)", () => {
  it("AC9 : chacun des 15 caracteres de la liste est remplace par son marqueur [U+XXXX] (hexadecimal majuscule, 4 chiffres)", async () => {
    const visibleText = await loadVisibleText();
    expect(MARKED_CODE_POINTS).toHaveLength(15);
    for (const codePoint of MARKED_CODE_POINTS) {
      const raw = String.fromCodePoint(codePoint);
      expect(visibleText(`a${raw}b`), `U+${codePoint.toString(16)}`).toBe(`a${markerOf(codePoint)}b`);
      expect(visibleText(raw)).toBe(markerOf(codePoint));
    }
  });

  it("AC9 : la liste est FERMEE : sur tout le plan multilingue de base, seuls ces 15 points de code changent", async () => {
    const visibleText = await loadVisibleText();
    const changed: number[] = [];
    for (let codePoint = 0; codePoint <= 0xffff; codePoint += 1) {
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue; // moitiés de paire de substitution
      const raw = String.fromCodePoint(codePoint);
      const probe = `x${raw}y`;
      if (visibleText(probe) !== probe) changed.push(codePoint);
    }
    expect(changed.map((c) => c.toString(16)).sort()).toEqual([...MARKED_CODE_POINTS].map((c) => c.toString(16)).sort());
  });

  it("AC9 : U+200D (liant des emojis), U+200C, l'espace insecable et des caracteres ordinaires ne sont pas marques", async () => {
    const visibleText = await loadVisibleText();
    for (const value of ["a‍b", "a‌b", "a b", "a­b", "é à ç", "日本語", "عربى", "Org-Test-1", "\u{1F600}"]) {
      expect(visibleText(value), JSON.stringify(value)).toBe(value);
    }
  });

  it("AC9 : un emoji compose avec U+200D (U+1F469 U+200D U+1F4BB) reste intact, meme entoure de marqueurs", async () => {
    const visibleText = await loadVisibleText();
    const woman = "\u{1F469}‍\u{1F4BB}";
    expect(visibleText(woman)).toBe(woman);
    expect(visibleText(`${woman}‮${woman}`)).toBe(`${woman}[U+202E]${woman}`);
  });

  it("AC9 : chaine vide inchangee, plusieurs caracteres consecutifs tous marques, texte deja marque non re-transforme", async () => {
    const visibleText = await loadVisibleText();
    expect(visibleText("")).toBe("");
    expect(visibleText("​​﻿")).toBe("[U+200B][U+200B][U+FEFF]");
    expect(visibleText("[U+202E]")).toBe("[U+202E]");
  });
});

describe("AC10 : lien sur (fonction pure)", () => {
  it("AC10 : une URL https devient un lien dont href = new URL(url).href (non ASCII encode en %XX) et dont l'hote est new URL(url).hostname", async () => {
    const safeLink = await loadSafeLink();
    const url = "https://exemple.invalid/chemin/é?q=1#ancre";
    const result = safeLink(url);
    expect(result).toEqual({ kind: "link", href: new URL(url).href, hostname: "exemple.invalid" });
    expect(new URL(url).href).toContain("%C3%A9");
  });

  it("AC10 : un hote IDN est montre en punycode (xn--...), tel quel", async () => {
    const safeLink = await loadSafeLink();
    const result = safeLink("https://bücher.invalid/page");
    expect(result).toEqual({ kind: "link", href: new URL("https://bücher.invalid/page").href, hostname: "xn--bcher-kva.invalid" });
  });

  it("AC10 : http est accepte aussi", async () => {
    const safeLink = await loadSafeLink();
    expect(safeLink("http://exemple.invalid/a")).toEqual({ kind: "link", href: "http://exemple.invalid/a", hostname: "exemple.invalid" });
  });

  it("AC10 : un schema qui n'est pas http: ni https: est affiche en texte, sans href", async () => {
    const safeLink = await loadSafeLink();
    for (const value of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>alert(1)</script>", "ftp://exemple.invalid/x", "file:///etc/passwd", "mailto:a@exemple.invalid", "vbscript:x"]) {
      expect(safeLink(value), JSON.stringify(value)).toEqual({ kind: "text" });
    }
  });

  it("AC10 : une valeur non relisible par URL.canParse est affichee en texte (valeur absente ou malformee)", async () => {
    const safeLink = await loadSafeLink();
    for (const value of ["", "pas une url", "https://", "//exemple.invalid/x", "/chemin/relatif"]) {
      expect(safeLink(value), JSON.stringify(value)).toEqual({ kind: "text" });
    }
  });

  it("AC10 : le schema est relu APRES normalisation (majuscules, espaces de bord) : pas de contournement", async () => {
    const safeLink = await loadSafeLink();
    expect(safeLink("HTTPS://EXEMPLE.INVALID/A")).toEqual({ kind: "link", href: "https://exemple.invalid/A", hostname: "exemple.invalid" });
    expect(safeLink("  javascript:alert(1)")).toEqual({ kind: "text" });
  });
});
