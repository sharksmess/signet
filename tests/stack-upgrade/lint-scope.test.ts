/**
 * Portee des regles de lint (tranche 011, AC2, ADR-0009).
 *
 * Non-regression : ces tests peuvent deja passer avant l'implementation, la
 * reecriture de eslint.config.mjs doit conserver exactement ces portees.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { ESLint } from "eslint";

const root = path.resolve(__dirname, "../..");
const webFile = path.join(root, "apps/web/src/lib/organizations.ts");
const dbFile = path.join(root, "packages/db/src/migrate.ts");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Severite normalisee : 0 (off), 1 (warn), 2 (error). Une regle absente vaut 0. */
function severityOf(entry: unknown): 0 | 1 | 2 {
  const level: unknown = Array.isArray(entry) ? (entry as unknown[])[0] : entry;
  if (level === 2 || level === "error") return 2;
  if (level === 1 || level === "warn") return 1;
  return 0;
}

async function activeRules(file: string): Promise<Record<string, 0 | 1 | 2>> {
  const eslint = new ESLint({ cwd: root });
  const config: unknown = await eslint.calculateConfigForFile(file);
  if (!isRecord(config) || !isRecord(config.rules)) {
    throw new Error(`Aucune configuration resolue pour ${file} : ${JSON.stringify(config)}`);
  }
  const out: Record<string, 0 | 1 | 2> = {};
  for (const [name, entry] of Object.entries(config.rules)) {
    out[name] = severityOf(entry);
  }
  return out;
}

function activeWithPrefix(rules: Record<string, 0 | 1 | 2>, prefix: string): string[] {
  return Object.entries(rules)
    .filter(([name, severity]) => name.startsWith(prefix) && severity !== 0)
    .map(([name]) => name);
}

describe("AC2 : portee des regles de lint", () => {
  it("AC2 : apps/web recoit des regles @next/next/* actives", async () => {
    const rules = await activeRules(webFile);
    expect(activeWithPrefix(rules, "@next/next/").length).toBeGreaterThan(0);
  });

  it("AC2 : apps/web recoit des regles react-hooks/* actives", async () => {
    const rules = await activeRules(webFile);
    expect(activeWithPrefix(rules, "react-hooks/").length).toBeGreaterThan(0);
  });

  it("AC2 : packages/db ne recoit aucune regle @next/next/*", async () => {
    const rules = await activeRules(dbFile);
    expect(activeWithPrefix(rules, "@next/next/")).toEqual([]);
  });

  it("AC2 : no-explicit-any et ban-ts-comment restent en erreur dans apps/web et packages/db", async () => {
    for (const file of [webFile, dbFile]) {
      const rules = await activeRules(file);
      expect(rules["@typescript-eslint/no-explicit-any"], `no-explicit-any ${file}`).toBe(2);
      expect(rules["@typescript-eslint/ban-ts-comment"], `ban-ts-comment ${file}`).toBe(2);
    }
  });
});
