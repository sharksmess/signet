/**
 * Configuration Dependabot (tranche 011, AC6, D-040).
 *
 * Aucun parseur YAML n'est resolvable en premier niveau depuis la racine (ni
 * `yaml` ni `js-yaml`) et aucune dependance nouvelle n'est permise sans ADR :
 * analyse textuelle bornee au bloc de chaque ecosysteme.
 *
 * Lien avec .nvmrc et D-040 : @types/node suit la version majeure du runtime
 * Node (24, .nvmrc). Une montee majeure de @types/node proposee par Dependabot
 * decrirait des API d'un Node que le projet n'execute pas. Elle est donc
 * ignoree tant que .nvmrc vaut 24 ; si le runtime change, ce test casse et
 * force a reevaluer la regle.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const dependabot = readFileSync(path.join(root, ".github/dependabot.yml"), "utf8");

/** Bloc d'un ecosysteme : du marqueur au `- package-ecosystem` suivant (ou fin). */
function ecosystemBlock(name: string): string {
  const marker = new RegExp(`^\\s*-\\s*package-ecosystem:\\s*${name}\\s*$`, "m");
  const start = marker.exec(dependabot);
  if (!start) throw new Error(`Ecosysteme ${name} absent de dependabot.yml`);
  const rest = dependabot.slice(start.index + start[0].length);
  const next = /^\s*-\s*package-ecosystem:/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** Sans les lignes de commentaire, pour ne pas valider un texte commente. */
function stripComments(block: string): string {
  return block
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

const npmBlock = stripComments(ecosystemBlock("npm"));
const actionsBlock = stripComments(ecosystemBlock("github-actions"));

describe("AC6 : Dependabot", () => {
  it("AC6 : .nvmrc vaut 24 (sinon reevaluer l'ignore de @types/node, D-040)", () => {
    expect(readFileSync(path.join(root, ".nvmrc"), "utf8").trim()).toBe("24");
  });

  it("AC6 : l'ecosysteme npm ignore les montees semver-major de @types/node", () => {
    const ignoreIndex = npmBlock.search(/^\s*ignore:/m);
    expect(ignoreIndex, `pas de section ignore dans le bloc npm :\n${npmBlock}`).toBeGreaterThanOrEqual(0);
    const ignoreSection = npmBlock.slice(ignoreIndex);

    const entries = ignoreSection.split(/-\s*dependency-name:/).slice(1);
    const typesNode = entries.find((entry) => /^\s*["']?@types\/node["']?\s*$/.test(entry.split("\n")[0] ?? ""));
    expect(typesNode, `aucune entree ignore pour @types/node :\n${ignoreSection}`).toBeDefined();
    expect(typesNode).toMatch(/update-types:[\s\S]*version-update:semver-major/);
  });

  it("AC6 : l'ecosysteme npm garde ses groupes et sa limite de PR", () => {
    expect(npmBlock).toMatch(/^\s*mineures-et-correctifs:/m);
    expect(npmBlock).toMatch(/update-types:\s*\[\s*minor\s*,\s*patch\s*\]/);
    expect(npmBlock).toMatch(/^\s*majeures:/m);
    expect(npmBlock).toMatch(/update-types:\s*\[\s*major\s*\]/);
    expect(npmBlock).toMatch(/open-pull-requests-limit:\s*3\s*$/m);
  });

  it("AC6 : l'ecosysteme github-actions garde son groupe actions", () => {
    expect(actionsBlock).toMatch(/^\s*actions:/m);
    expect(actionsBlock).toMatch(/patterns:\s*\[\s*["']\*["']\s*\]/);
    expect(actionsBlock).toMatch(/open-pull-requests-limit:\s*1\s*$/m);
    expect(actionsBlock).not.toMatch(/@types\/node/);
  });
});
