/**
 * Versions et epinglage de la montee Next 16 (tranche 011, AC1).
 * Source : docs/03-slices/011-montee-next16.md
 *
 * Lecture de fichiers du depot uniquement, pas de base de donnees. Ecrits avant
 * l'implementation : ils echouent tant que le socle est en Next 15 avec FlatCompat.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(__dirname, "../..");

type Manifest = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(value)) return out;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

function readManifest(relativePath: string): Manifest {
  const raw = readFileSync(path.join(root, relativePath), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error(`${relativePath} : JSON inattendu`);
  return {
    dependencies: toStringRecord(parsed.dependencies),
    devDependencies: toStringRecord(parsed.devDependencies),
  };
}

const rootManifest = readManifest("package.json");
const webManifest = readManifest("apps/web/package.json");
const dbManifest = readManifest("packages/db/package.json");

// Version exacte 16.x.y : exclut ^, ~, et les pre-versions (-canary, -rc, -beta, -preview).
const EXACT_16 = /^16\.\d+\.\d+$/;

describe("AC1 : versions et epinglage", () => {
  it("AC1 : next est epingle exactement en 16.x.y stable", () => {
    expect(webManifest.dependencies.next).toMatch(EXACT_16);
  });

  it("AC1 : eslint-config-next est epingle exactement en 16.x.y et egal a la version de next", () => {
    const configNext = rootManifest.devDependencies["eslint-config-next"];
    expect(configNext).toMatch(EXACT_16);
    expect(configNext).toBe(webManifest.dependencies.next);
  });

  it("AC1 : eslint est epingle exactement en 9.x ou 10.x", () => {
    expect(rootManifest.devDependencies.eslint).toMatch(/^(9|10)\.\d+\.\d+$/);
  });

  it("AC1 : @eslint/eslintrc est absent de tous les manifestes", () => {
    const manifests: Array<[string, Manifest]> = [
      ["package.json", rootManifest],
      ["apps/web/package.json", webManifest],
      ["packages/db/package.json", dbManifest],
    ];
    for (const [name, manifest] of manifests) {
      expect(Object.keys(manifest.dependencies), `${name} dependencies`).not.toContain("@eslint/eslintrc");
      expect(Object.keys(manifest.devDependencies), `${name} devDependencies`).not.toContain("@eslint/eslintrc");
    }
  });

  it("AC1 : eslint.config.mjs n'utilise plus FlatCompat ni @eslint/eslintrc", () => {
    const config = readFileSync(path.join(root, "eslint.config.mjs"), "utf8");
    expect(config).not.toContain("FlatCompat");
    expect(config).not.toContain("@eslint/eslintrc");
  });

  it("AC1 : pnpm-workspace.yaml ne contient pas minimumReleaseAgeExclude", () => {
    const workspace = readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
    expect(workspace).not.toContain("minimumReleaseAgeExclude");
  });

  it("AC1 : la version de next installee correspond au manifeste", () => {
    const requireFromWeb = createRequire(path.join(root, "apps/web/package.json"));
    const installedRaw = readFileSync(requireFromWeb.resolve("next/package.json"), "utf8");
    const installed: unknown = JSON.parse(installedRaw);
    if (!isRecord(installed)) throw new Error("next/package.json : JSON inattendu");
    expect(installed.version).toBe(webManifest.dependencies.next);
  });
});
