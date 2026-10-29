/**
 * Verifications de source de la tranche 012 (AC8, AC11) : lecture des fichiers de
 * `apps/web/src` par `fs`, commentaires retires (aucun faux positif sur un
 * commentaire qui cite le motif interdit), motifs precis.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../_factory/env";

export const WEB_SRC = path.join(ROOT, "apps", "web", "src");

export function sourceFiles(directory: string = WEB_SRC): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) files.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) files.push(full);
  }
  return files;
}

/**
 * Retire les commentaires `//` et `/* *\/` en respectant les chaines (`'`, `"`,
 * `` ` ``) : `https://exemple` dans une chaine n'est pas un commentaire. Les
 * chaines sont conservees (un motif interdit ecrit dans une chaine reste detecte).
 * Une chaine `'` ou `"` s'arrete a la fin de la ligne (une apostrophe dans du texte JSX
 * francais n'est pas une chaine). Les retours a la ligne sont conserves.
 */
export function stripComments(source: string): string {
  let out = "";
  let index = 0;
  let quote: string | null = null;
  while (index < source.length) {
    const char = source.charAt(index);
    const next = source.charAt(index + 1);
    if (quote !== null) {
      out += char;
      if (char === "\\") {
        out += next;
        index += 2;
        continue;
      }
      if (char === quote || (char === "\n" && quote !== "`")) quote = null;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < source.length && source.charAt(index) !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end < 0 ? source.length : end + 2;
      out += source.slice(index, stop).replace(/[^\n]/g, "");
      index = stop;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/** Premiere directive du fichier : `"use client"`. */
export function isClientModule(source: string): boolean {
  return /^\s*(?:["']use client["'];?\s*)/.test(stripComments(source));
}

/** Les motifs par lesquels un jeton d'invitation quitterait le fragment (AC11). Un motif par ligne de resultat. */
const TOKEN_LEAK_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: "stockage local (localStorage)", pattern: /\blocalStorage\b/ },
  { name: "stockage de session (sessionStorage)", pattern: /\bsessionStorage\b/ },
  { name: "cookie (document.cookie)", pattern: /\bdocument\s*\.\s*cookie\b/ },
  { name: "journal (console)", pattern: /\bconsole\s*\./ },
  { name: "navigation du routeur avec le jeton", pattern: /\brouter\s*\.\s*(?:push|replace|prefetch)\s*\([^)]*token/i },
  { name: "location.assign/replace avec le jeton", pattern: /\blocation\s*\.\s*(?:assign|replace)\s*\([^)]*token/i },
  { name: "affectation de location avec le jeton", pattern: /\blocation(?:\s*\.\s*(?:href|search|pathname))?\s*=(?!=)[^;\n]*token/i },
  { name: "historique avec le jeton", pattern: /\bhistory\s*\.\s*(?:pushState|replaceState)\s*\([^)]*token/i },
  { name: "attribut href avec le jeton", pattern: /\bhref\s*=\s*(?:\{[^}]*token|"[^"]*token|'[^']*token)/i },
  { name: "parametre d'adresse ?token= ou &token=", pattern: /[?&]token\s*=/i },
  { name: "URL ou parametres construits avec le jeton", pattern: /\b(?:new\s+URL|URLSearchParams|searchParams\s*\.\s*(?:set|append))\s*\([^)]*token/i },
];

/** Noms des motifs de fuite presents dans le code (commentaires retires). Liste vide : conforme. */
export function tokenLeaks(source: string): string[] {
  const code = stripComments(source);
  return TOKEN_LEAK_PATTERNS.filter(({ pattern }) => pattern.test(code)).map(({ name }) => name);
}

export function readSource(file: string): string {
  return readFileSync(file, "utf8");
}
