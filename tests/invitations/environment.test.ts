/**
 * Tranche 003 — AC14 (garde de EMAIL_CAPTURE_URL sur le schema), AC15 (le module
 * de la fonction d'envoi n'importe aucun acces a la base), AC16 (environnement,
 * dependances), AC4 (d) (documentation du double envoi residuel, ADR-0017).
 *
 * Le schema d'environnement est la fonction pure `parseServerEnv(raw)` de
 * `apps/web/src/lib/env.ts` (tranche 002) : elle leve une Error sans jamais citer
 * la valeur d'une variable. Chaque cas negatif est precede d'un temoin positif.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { ROOT } from "../_factory/env";

type RawEnv = Record<string, string | undefined>;

function validProductionEnv(): RawEnv {
  return {
    APP_ENV: "production",
    AUTH_RATE_LIMIT: "on",
    DATABASE_URL_APP: "postgresql://signet_app@localhost:5432/signet_env_check",
    DATABASE_URL_AUTH: "postgresql://signet_auth@localhost:5432/signet_env_check",
    DATABASE_URL_BILLING: "postgresql://signet_billing@localhost:5432/signet_env_check",
    BETTER_AUTH_SECRET: "env-check-better-auth-secret-0000000000000001",
    BETTER_AUTH_URL: "http://localhost:3100",
    APP_URL: "http://localhost:3100",
    STRIPE_SECRET_KEY: "sk_test_valeur_inventee_pour_le_schema",
    STRIPE_WEBHOOK_SECRET: "whsec_valeur_inventee_pour_le_schema",
    STRIPE_PRICE_ID_PRO: "price_valeur_inventee",
    INNGEST_SIGNING_KEY: "signkey-test-0123456789abcdef0123456789abcdef",
    INNGEST_EVENT_KEY: "event-key-valeur-inventee",
  };
}

function withEnv(base: RawEnv, changes: RawEnv): RawEnv {
  const merged: RawEnv = { ...base, ...changes };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete merged[key];
  }
  return merged;
}

/** Environnement de test valide (APP_ENV=test, Inngest en mode developpement). */
function validTestEnv(): RawEnv {
  return withEnv(validProductionEnv(), {
    APP_ENV: "test",
    AUTH_RATE_LIMIT: "off",
    INNGEST_SIGNING_KEY: undefined,
    INNGEST_EVENT_KEY: undefined,
    INNGEST_DEV: "http://localhost:12112",
  });
}

type ParseServerEnv = (raw: RawEnv) => unknown;
let parseServerEnv: ParseServerEnv;

beforeAll(async () => {
  const module = await import("../../apps/web/src/lib/env");
  parseServerEnv = module.parseServerEnv;
});

function parseError(env: RawEnv): Error | undefined {
  try {
    parseServerEnv(env);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function expectAccepted(env: RawEnv, label: string): void {
  const error = parseError(env);
  expect(error, `${label} : environnement attendu valide, refuse avec : ${error?.message}`).toBeUndefined();
}

function expectRefusedWithoutValues(env: RawEnv, label: string, secrets: string[]): void {
  const error = parseError(env);
  expect(error, `${label} : demarrage attendu refuse`).toBeDefined();
  for (const secret of secrets) {
    expect(error?.message ?? "", `${label} : le message ne doit pas afficher une valeur`).not.toContain(secret);
  }
}

const CAPTURE_URL = "http://localhost:12113";

describe("AC14 — EMAIL_CAPTURE_URL n'est acceptee qu'avec APP_ENV=test (meme garde que STRIPE_API_BASE_URL)", () => {
  it("AC14 : temoin — l'environnement de test de base est accepte, sans EMAIL_CAPTURE_URL", () => {
    expectAccepted(validTestEnv(), "base de test");
  });

  it("AC14 : EMAIL_CAPTURE_URL est acceptee avec APP_ENV=test", () => {
    expectAccepted(withEnv(validTestEnv(), { EMAIL_CAPTURE_URL: CAPTURE_URL }), "test + EMAIL_CAPTURE_URL");
  });

  it.each([
    ["development", "development"],
    ["production", "production"],
    ["APP_ENV absent (production par defaut)", undefined],
  ])("AC14 : EMAIL_CAPTURE_URL avec APP_ENV = %s -> le demarrage est refuse, sans afficher l'URL", (_label, appEnv) => {
    const base = withEnv(validProductionEnv(), appEnv === "development" ? { APP_ENV: "development", AUTH_RATE_LIMIT: "on" } : { APP_ENV: appEnv });
    expectAccepted(base, "temoin sans EMAIL_CAPTURE_URL");

    expectRefusedWithoutValues(withEnv(base, { EMAIL_CAPTURE_URL: CAPTURE_URL }), "EMAIL_CAPTURE_URL hors test", ["localhost:12113"]);
  });

  it("AC14 : EMAIL_CAPTURE_URL mal formee avec APP_ENV=test -> refus, sans afficher la valeur", () => {
    expectRefusedWithoutValues(
      withEnv(validTestEnv(), { EMAIL_CAPTURE_URL: "SENTINELLE pas une url" }),
      "EMAIL_CAPTURE_URL mal formee",
      ["SENTINELLE"],
    );
  });
});

describe("AC16 — INVITATION_TOKEN_KEY est validee au premier usage, pas au demarrage (D-079)", () => {
  it("AC16 : l'environnement de production de 002, sans INVITATION_TOKEN_KEY, reste accepte par le schema (la cle est validee a l'usage, voir sending.test.ts)", () => {
    expectAccepted(validProductionEnv(), "environnement de production sans INVITATION_TOKEN_KEY");
  });
});

describe("AC15 — le module de la fonction d'envoi n'importe aucun module d'acces a la base", () => {
  const SRC = path.join(ROOT, "apps/web/src");
  const ENTRY = path.join(SRC, "lib/inngest/send-invitation-email.ts");
  /** Specificateurs interdits, directement ou par transitivite dans le depot : acces base, ORM, pilote. */
  const FORBIDDEN = [/(^|\/)db$/, /billing-db$/, /^pg$/, /^pg\//, /^drizzle-orm/, /^postgres$/, /^@signet\/db/];

  function importsOf(file: string): string[] {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const specifiers: string[] = [];
    const visit = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const [argument] = node.arguments;
        if (argument && ts.isStringLiteral(argument)) specifiers.push(argument.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return specifiers;
  }

  function resolveLocal(from: string, specifier: string): string | undefined {
    const base = specifier.startsWith("@/")
      ? path.join(SRC, specifier.slice(2))
      : specifier.startsWith(".")
        ? path.resolve(path.dirname(from), specifier)
        : undefined;
    if (!base) return undefined;
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      if (existsSync(candidate)) return candidate;
    }
    return undefined;
  }

  it("AC15 : ni le module, ni aucun module local qu'il atteint, n'importe lib/db, billing-db, pg ou un ORM", () => {
    expect(existsSync(ENTRY), "apps/web/src/lib/inngest/send-invitation-email.ts (fichier de la fonction d'envoi)").toBe(true);

    const visited = new Set<string>();
    const violations: string[] = [];
    const queue = [ENTRY];
    while (queue.length > 0) {
      const file = queue.pop() ?? "";
      if (visited.has(file)) continue;
      visited.add(file);
      for (const specifier of importsOf(file)) {
        if (FORBIDDEN.some((rule) => rule.test(specifier))) {
          violations.push(`${path.relative(ROOT, file)} importe "${specifier}"`);
          continue;
        }
        const local = resolveLocal(file, specifier);
        if (local) queue.push(local);
      }
    }

    expect(violations).toEqual([]);
    expect(visited.size, "le parcours a bien lu le module et ses dependances locales").toBeGreaterThanOrEqual(1);
  });
});

describe("AC16 — dependances, exemples d'environnement et CI (fichiers du depot)", () => {
  function gitDiffAgainstMain(files: string[]): string {
    const refs = ["main", "origin/main"];
    for (const ref of refs) {
      try {
        const base = execFileSync("git", ["merge-base", "HEAD", ref], { cwd: ROOT, encoding: "utf8" }).trim();
        return execFileSync("git", ["diff", "--name-only", base, "--", ...files], { cwd: ROOT, encoding: "utf8" }).trim();
      } catch {
        // reference absente dans ce clone : on essaie la suivante
      }
    }
    throw new Error("[tests] ni `main` ni `origin/main` n'est disponible : impossible de verifier que les dependances sont inchangees.");
  }

  function currentBranch(): string {
    try {
      return execFileSync("git", ["branch", "--show-current"], { cwd: ROOT, encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  }

  // D-099 : verification ponctuelle de la tranche 003, sans objet hors de sa branche
  // (preuve conservee dans evidence/003.md : "Dependances ajoutees : aucune").
  it.runIf(currentBranch().startsWith("slice/003-"))("AC16 : aucune dependance ajoutee — package.json (racine, apps/web, packages/db) et pnpm-lock.yaml sont inchanges par la tranche", () => {
    const changed = gitDiffAgainstMain(["package.json", "apps/web/package.json", "packages/db/package.json", "pnpm-lock.yaml"]);

    expect(changed, "fichiers de dependances modifies depuis main").toBe("");
  });

  it("AC16 : .env.example et .env.test.example listent les noms des variables de la tranche (noms seulement, aucune valeur)", () => {
    const server = readFileSync(path.join(ROOT, ".env.example"), "utf8");
    const tests = readFileSync(path.join(ROOT, ".env.test.example"), "utf8");

    expect(["INVITATION_TOKEN_KEY", "EMAIL_CAPTURE_URL"].filter((n) => !server.includes(n)), "noms absents de .env.example").toEqual([]);
    expect(
      ["TEST_SERVER_ENV_INVITATION_TOKEN_KEY", "TEST_SERVER_ENV_EMAIL_CAPTURE_URL"].filter((n) => !tests.includes(n)),
      "noms absents de .env.test.example",
    ).toEqual([]);
  });

  it("AC16 : le workflow CI declare les variables de test de la tranche (valeurs inventees)", () => {
    const workflow = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");

    expect(
      ["TEST_SERVER_ENV_INVITATION_TOKEN_KEY", "TEST_SERVER_ENV_EMAIL_CAPTURE_URL"].filter((n) => !workflow.includes(n)),
      "variables absentes de ci.yml",
    ).toEqual([]);
  });
});

describe("AC4 (d) — le double envoi residuel est documente dans ADR-0017", () => {
  it("AC4 (d) : ADR-0017 existe et documente le double envoi acceptable (meme lien, cle d'idempotence) et le lien inerte apres creation annulee", () => {
    const dir = path.join(ROOT, "docs/02-architecture/ADR");
    const file = readdirSync(dir).find((name) => name.startsWith("0017-"));
    expect(file, "docs/02-architecture/ADR/0017-*.md").toBeDefined();
    const text = readFileSync(path.join(dir, file ?? ""), "utf8");

    expect(text).toMatch(/double envoi/i);
    expect(text).toMatch(/idempotence/i);
    expect(text, "cas residuel : evenement emis puis creation annulee").toMatch(/inerte/i);
  });
});
