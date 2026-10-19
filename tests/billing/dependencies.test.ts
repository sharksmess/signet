/**
 * Tranche 002 — AC13 (dependances, exemples d'environnement, CI) : verifications
 * sur les fichiers du depot, sans reseau. `pnpm audit --prod --audit-level=high`
 * (reseau) est verifie par `scripts/close-slice.sh`, pas ici.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ROOT } from "../_factory/env";

describe("AC13 — dependances et environnement (fichiers du depot)", () => {
  it("AC13 : stripe, inngest et @inngest/test sont epingles a une version exacte", () => {
    const web = JSON.parse(readFileSync(path.join(ROOT, "apps/web/package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const root = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      devDependencies?: Record<string, string>;
    };
    const exact = /^\d+\.\d+\.\d+$/;

    expect(web.dependencies?.stripe, "stripe dans apps/web (dependencies)").toMatch(exact);
    expect(web.dependencies?.inngest, "inngest dans apps/web (dependencies)").toMatch(exact);
    expect(root.devDependencies?.["@inngest/test"], "@inngest/test dans le package racine (devDependencies)").toMatch(exact);
  });

  it("AC13 : aucune exclusion de la quarantaine pnpm (minimumReleaseAgeExclude)", () => {
    const workspace = readFileSync(path.join(ROOT, "pnpm-workspace.yaml"), "utf8");

    expect(workspace).not.toMatch(/minimumReleaseAgeExclude/);
  });

  it("AC13 : ADR-0015 existe et nomme les trois paquets", () => {
    const dir = path.join(ROOT, "docs/02-architecture/ADR");
    const file = readdirSync(dir).find((name) => name.startsWith("0015-"));
    expect(file, "docs/02-architecture/ADR/0015-*.md").toBeDefined();
    const text = readFileSync(path.join(dir, file ?? ""), "utf8");

    for (const name of ["stripe", "inngest", "@inngest/test"]) {
      expect(text, `ADR-0015 doit nommer ${name}`).toContain(name);
    }
  });

  it("AC13 : .env.example et .env.test.example listent les noms des variables de la tranche (noms seulement)", () => {
    const serverNames = [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_PRICE_ID_PRO",
      "STRIPE_API_BASE_URL",
      "APP_URL",
      "INNGEST_DEV",
      "INNGEST_EVENT_KEY",
      "INNGEST_SIGNING_KEY",
      "DATABASE_URL_BILLING",
    ];
    const testNames = [
      "TEST_STRIPE_WEBHOOK_SECRET",
      "TEST_DATABASE_URL_BILLING",
      "TEST_FAKE_STRIPE_PORT",
      "TEST_FAKE_INNGEST_PORT",
      "TEST_SERVER_ENV_STRIPE_SECRET_KEY",
      "TEST_SERVER_ENV_STRIPE_WEBHOOK_SECRET",
      "TEST_SERVER_ENV_STRIPE_PRICE_ID_PRO",
      "TEST_SERVER_ENV_STRIPE_API_BASE_URL",
      "TEST_SERVER_ENV_APP_URL",
      "TEST_SERVER_ENV_INNGEST_DEV",
      "TEST_SERVER_ENV_DATABASE_URL_BILLING",
    ];
    const envExample = path.join(ROOT, ".env.example");
    const envTestExample = path.join(ROOT, ".env.test.example");
    expect(existsSync(envExample), ".env.example").toBe(true);

    const server = readFileSync(envExample, "utf8");
    const tests = readFileSync(envTestExample, "utf8");
    expect(serverNames.filter((n) => !server.includes(n)), "noms absents de .env.example").toEqual([]);
    expect(testNames.filter((n) => !tests.includes(n)), "noms absents de .env.test.example").toEqual([]);
  });

  it("AC13 : le workflow CI declare les variables de test de la tranche (valeurs inventees, aucun secret Stripe reel)", () => {
    const workflow = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
    const names = [
      "TEST_STRIPE_WEBHOOK_SECRET",
      "TEST_DATABASE_URL_BILLING",
      "TEST_FAKE_STRIPE_PORT",
      "TEST_FAKE_INNGEST_PORT",
      "TEST_SERVER_ENV_STRIPE_API_BASE_URL",
      "TEST_SERVER_ENV_INNGEST_DEV",
    ];

    expect(names.filter((n) => !workflow.includes(n)), "variables absentes de ci.yml").toEqual([]);
    expect(workflow, "aucune cle Stripe reelle (sk_live_, rk_live_) dans le workflow").not.toMatch(/\b(sk|rk)_live_/);
  });
});
