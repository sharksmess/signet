/**
 * Tranche 002 — D-079 : aucun module de l'application ne lit l'environnement
 * complet du serveur au chargement.
 *
 * `next build` charge chaque route pour collecter sa configuration. Un module
 * qui appelle `getServerEnv()` au premier niveau (hors fonction) valide alors
 * tout l'environnement du serveur pendant la construction, et l'etape Build de
 * la CI, qui ne pose que `DATABASE_URL_APP`, `DATABASE_URL_AUTH` et
 * `BETTER_AUTH_SECRET`, echoue (PR #26 : `lib/inngest/client.ts`). La suite de
 * tests ne le voit pas d'elle-meme : la construction du globalSetup recoit tout
 * l'environnement du serveur de test.
 *
 * Le test est statique (API du compilateur TypeScript) : Vitest ne resout pas
 * l'alias `@/` des routes, qui ne peuvent donc pas etre importees ici. Il
 * parcourt `apps/web/src` et refuse tout appel, au premier niveau d'un module,
 * a un accesseur qui lit l'environnement du serveur, directement (`env.ts`) ou
 * au premier usage (clients paresseux). Le premier niveau exclut le corps des
 * fonctions, fleches et methodes, executes plus tard.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(__dirname, "../..");
const SRC = path.join(root, "apps/web/src");

/** Accesseurs qui lisent l'environnement du serveur, et le module qui les declare. */
const ENV_ACCESSORS: Record<string, string> = {
  getServerEnv: "lib/env.ts",
  parseServerEnv: "lib/env.ts",
  billingDatabaseUrl: "lib/env.ts",
  getStripe: "lib/stripe.ts",
  getInngest: "lib/inngest/client.ts",
  getProcessStripeEvent: "lib/inngest/process-stripe-event.ts",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function isDeferred(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

/** Appels d'un accesseur d'environnement executes au chargement du module : `ligne : nom`. */
function loadTimeEnvCalls(code: string, fileName: string): string[] {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (isDeferred(node)) return;
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name !== null && name in ENV_ACCESSORS) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        found.push(`${line} : ${name}()`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("D-079 — aucun module ne lit l'environnement du serveur au chargement", () => {
  it("le detecteur refuse un appel au premier niveau et accepte un appel differe", () => {
    expect(loadTimeEnvCalls("const env = getServerEnv();\n", "a.ts")).toEqual(["1 : getServerEnv()"]);
    expect(loadTimeEnvCalls("export const f = getInngest().createFunction({}, async () => 1);\n", "b.ts")).toEqual([
      "1 : getInngest()",
    ]);
    expect(
      loadTimeEnvCalls(
        "export function f() { return getServerEnv(); }\nconst g = () => getStripe();\nconst h = make({ run: () => getServerEnv() });\n",
        "c.ts",
      ),
    ).toEqual([]);
  });

  it("chaque accesseur surveille existe toujours dans son module (un renommage ne desarme pas le test)", () => {
    for (const [name, file] of Object.entries(ENV_ACCESSORS)) {
      const code = readFileSync(path.join(SRC, file), "utf8");
      expect(code, `${name} declare dans ${file}`).toMatch(new RegExp(`export (async )?function ${name}\\(`));
    }
  });

  it("aucun fichier de apps/web/src n'appelle un accesseur d'environnement au premier niveau", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      loadTimeEnvCalls(readFileSync(file, "utf8"), file).map((call) => `${path.relative(root, file)}:${call}`),
    );
    expect(offenders).toEqual([]);
  });
});
