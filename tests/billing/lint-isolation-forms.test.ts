/**
 * Tranche 002 — AC16 renforce (D-071 ; review-002 suggestion 8, audit-002
 * INFO-1) : un test par forme d'acces a la connexion signet_billing.
 *
 * Meme methode que lint-isolation.test.ts : le code est lint comme texte avec
 * le chemin d'un fichier (existant ou fictif), verification de type desactivee,
 * toutes les autres regles d'eslint.config.mjs appliquees. Chaque refus attendu
 * a un temoin : la meme forme visant une cible autorisee ne leve rien.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { ESLint } from "eslint";
import type { Linter } from "eslint";
import tseslint from "typescript-eslint";

const root = path.resolve(__dirname, "../..");
const web = (relative: string): string => path.join(root, "apps/web/src", relative);

const ROUTE = web("app/api/fictif/route.ts");
const FUNCTION_MODULE = web("lib/inngest/process-stripe-event.ts");
const BILLING_DB = web("lib/inngest/billing-db.ts");
const NESTED_INNGEST = web("lib/inngest/outils/fictif.ts");
const BILLING_LOGIC = web("lib/billing/fictif.ts");

const ISOLATION_RULES = new Set(["no-restricted-imports", "no-restricted-syntax"]);

async function lint(code: string, filePath: string): Promise<Linter.LintMessage[]> {
  const eslint = new ESLint({
    cwd: root,
    overrideConfig: [{ ...tseslint.configs.disableTypeChecked, files: ["**/*.ts"] }],
  });
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages ?? [];
}

function isolationErrors(messages: Linter.LintMessage[]): Linter.LintMessage[] {
  return messages.filter((m) => m.ruleId !== null && ISOLATION_RULES.has(m.ruleId) && m.severity === 2);
}

function describeMessages(messages: Linter.LintMessage[]): string {
  return JSON.stringify(messages.map((m) => ({ ruleId: m.ruleId, fatal: m.fatal, message: m.message })));
}

async function expectRefused(code: string, filePath: string): Promise<void> {
  const messages = await lint(code, filePath);
  expect(messages.filter((m) => m.fatal), `analyse impossible : ${describeMessages(messages)}`).toEqual([]);
  expect(isolationErrors(messages), `refus attendu ; messages : ${describeMessages(messages)}`).not.toHaveLength(0);
}

async function expectAllowed(code: string, filePath: string): Promise<void> {
  const messages = await lint(code, filePath);
  expect(messages.filter((m) => m.fatal), `analyse impossible : ${describeMessages(messages)}`).toEqual([]);
  expect(isolationErrors(messages), `aucun refus attendu ; messages : ${describeMessages(messages)}`).toEqual([]);
}

describe("AC16 renforce — import statique de billing-db", () => {
  it("extension .js depuis une route -> refus", async () => {
    await expectRefused('import { applyStripeSubscription } from "@/lib/inngest/billing-db.js";\nexport const x = applyStripeSubscription;\n', ROUTE);
  });

  it("extension .ts par chemin relatif depuis une route -> refus", async () => {
    await expectRefused('import { applyStripeSubscription } from "../../../lib/inngest/billing-db.ts";\nexport const x = applyStripeSubscription;\n', ROUTE);
  });

  it("../billing-db depuis un sous-dossier de lib/inngest -> refus", async () => {
    await expectRefused('import { applyStripeSubscription } from "../billing-db";\nexport const x = applyStripeSubscription;\n', NESTED_INNGEST);
  });

  it("le module de la fonction par une autre forme que ./billing-db (alias @/) -> refus : l'exception est limitee a un seul motif", async () => {
    await expectRefused('import { applyStripeSubscription } from "@/lib/inngest/billing-db";\nexport const x = applyStripeSubscription;\n', FUNCTION_MODULE);
  });

  it("temoin : le module de la fonction par ./billing-db -> autorise", async () => {
    await expectAllowed('import { applyStripeSubscription } from "./billing-db";\nexport const x = applyStripeSubscription;\n', FUNCTION_MODULE);
  });
});

describe("AC16 renforce — import dynamique et require de billing-db", () => {
  it("import() depuis une route -> refus", async () => {
    await expectRefused('export async function f() {\n  return import("@/lib/inngest/billing-db");\n}\n', ROUTE);
  });

  it("import() depuis le module de la fonction lui-meme -> refus", async () => {
    await expectRefused('export async function f() {\n  return import("./billing-db");\n}\n', FUNCTION_MODULE);
  });

  it("require() depuis une route -> refus", async () => {
    await expectRefused('export function f(): unknown {\n  return require("../../../lib/inngest/billing-db");\n}\n', ROUTE);
  });

  it("temoin : import() d'un autre module -> autorise", async () => {
    await expectAllowed('export async function f() {\n  return import("@/lib/inngest/client");\n}\n', ROUTE);
  });
});

describe("AC16 renforce — URL de la connexion (audit-002 INFO-1)", () => {
  it("billingDatabaseUrl importe depuis une route (alias @/) -> refus", async () => {
    await expectRefused('import { billingDatabaseUrl } from "@/lib/env";\nexport const x = billingDatabaseUrl;\n', ROUTE);
  });

  it("billingDatabaseUrl importe par chemin relatif depuis lib/billing -> refus", async () => {
    await expectRefused('import { billingDatabaseUrl } from "../env";\nexport const x = billingDatabaseUrl;\n', BILLING_LOGIC);
  });

  it("billingDatabaseUrl importe depuis le module de la fonction -> refus", async () => {
    await expectRefused('import { billingDatabaseUrl } from "../env";\nexport const x = billingDatabaseUrl;\n', FUNCTION_MODULE);
  });

  it("temoin : billingDatabaseUrl importe par billing-db.ts -> autorise", async () => {
    await expectAllowed('import { billingDatabaseUrl } from "../env";\nexport const x = billingDatabaseUrl;\n', BILLING_DB);
  });

  it("temoin : getServerEnv importe depuis une route -> autorise", async () => {
    await expectAllowed('import { getServerEnv } from "@/lib/env";\nexport const x = getServerEnv;\n', ROUTE);
  });

  it.each([
    ["acces par point", "export const url = process.env.DATABASE_URL_BILLING;\n"],
    ["acces par crochets", 'export const url = process.env["DATABASE_URL_BILLING"];\n'],
    ["destructuration", "const { DATABASE_URL_BILLING } = process.env;\nexport const url = DATABASE_URL_BILLING;\n"],
  ])("process.env.DATABASE_URL_BILLING, %s, depuis une route -> refus", async (_label, code) => {
    await expectRefused(code, ROUTE);
  });

  it("process.env.DATABASE_URL_BILLING depuis billing-db.ts -> refus (seul l'accesseur valide est permis)", async () => {
    await expectRefused("export const url = process.env.DATABASE_URL_BILLING;\n", BILLING_DB);
  });

  it("temoin : process.env.DATABASE_URL_APP depuis une route -> autorise", async () => {
    await expectAllowed("export const url = process.env.DATABASE_URL_APP;\n", ROUTE);
  });
});
