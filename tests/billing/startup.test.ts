/**
 * Tranche 002 — AC13, A2 (D-070) : le serveur REFUSE DE DEMARRER si
 * l'environnement de facturation est invalide (`apps/web/src/instrumentation.ts`).
 *
 * Preuve de bout en bout : un second `next start` (build du globalSetup) est
 * lance sur un port libre avec l'environnement du serveur de test, modifie par
 * cas. Temoin positif d'abord : avec l'environnement complet, ce meme serveur
 * repond ; un refus ne peut donc pas venir d'autre chose que de la variable
 * retiree ou interdite. Le processus doit se terminer en erreur, en nommant la
 * variable, sans afficher aucune valeur de l'environnement.
 */
import { describe, it, expect } from "vitest";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import { ROOT, loadTestEnv } from "../_factory/env";

loadTestEnv();

const START_TIMEOUT_MS = 60_000;

/** Environnement du serveur de test (meme transformation que le globalSetup : TEST_SERVER_ENV_X -> X). */
function testServerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("TEST_SERVER_ENV_") && value !== undefined) env[key.slice("TEST_SERVER_ENV_".length)] = value;
  }
  return env;
}

/** Valeurs qui ne doivent jamais apparaitre dans la sortie d'un refus. */
function sensitiveValues(env: NodeJS.ProcessEnv): string[] {
  return [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "BETTER_AUTH_SECRET",
    "DATABASE_URL_APP",
    "DATABASE_URL_AUTH",
    "DATABASE_URL_BILLING",
  ]
    .map((name) => env[name])
    .filter((value): value is string => typeof value === "string" && value.length >= 8);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function killTree(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    /* deja arrete */
  }
}

interface StartOutcome {
  /** `ready` : le serveur a repondu ; `exited` : le processus s'est termine seul. */
  kind: "ready" | "exited" | "timeout";
  exitCode: number | null;
  output: string;
}

/** Lance `next start` et attend qu'il reponde, qu'il s'arrete, ou le delai. Le processus est toujours arrete a la fin. */
async function startServer(env: NodeJS.ProcessEnv): Promise<StartOutcome> {
  const port = await freePort();
  const child = spawn(`pnpm --dir apps/web exec next start -p ${port}`, {
    cwd: ROOT,
    env,
    shell: true,
    detached: process.platform !== "win32",
  });
  const chunks: string[] = [];
  child.stdout?.on("data", (b: Buffer) => chunks.push(b.toString()));
  child.stderr?.on("data", (b: Buffer) => chunks.push(b.toString()));
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));

  const deadline = Date.now() + START_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        return { kind: "exited", exitCode: await exited, output: chunks.join("") };
      }
      try {
        await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1_000) });
        return { kind: "ready", exitCode: null, output: chunks.join("") };
      } catch {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    return { kind: "timeout", exitCode: null, output: chunks.join("") };
  } finally {
    killTree(child);
  }
}

function expectRefused(outcome: StartOutcome, variable: string, env: NodeJS.ProcessEnv): void {
  expect(outcome.kind, `demarrage attendu refuse, obtenu ${outcome.kind}. Sortie : ${outcome.output}`).toBe("exited");
  expect(outcome.exitCode, "code de sortie en erreur").not.toBe(0);
  expect(outcome.output, "le refus nomme la variable en cause").toContain(variable);
  for (const value of sensitiveValues(env)) {
    expect(outcome.output.includes(value), "aucune valeur de l'environnement dans la sortie").toBe(false);
  }
}

describe("AC13, A2 (D-070) — le serveur refuse de demarrer sur un environnement de facturation invalide", () => {
  it("temoin : avec l'environnement complet du serveur de test, next start demarre et repond", async () => {
    const outcome = await startServer(testServerEnv());

    expect(outcome.kind, `sortie : ${outcome.output}`).toBe("ready");
  }, 90_000);

  it("AC13 : STRIPE_SECRET_KEY absente -> le processus s'arrete en erreur, en nommant la variable sans afficher de valeur", async () => {
    const env = testServerEnv();
    delete env.STRIPE_SECRET_KEY;

    const outcome = await startServer(env);

    expectRefused(outcome, "STRIPE_SECRET_KEY", testServerEnv());
  }, 90_000);

  it("A2 : mode developpement d'Inngest avec APP_ENV=production -> le processus s'arrete en erreur", async () => {
    const env: NodeJS.ProcessEnv = { ...testServerEnv(), APP_ENV: "production", AUTH_RATE_LIMIT: "on" };
    delete env.STRIPE_API_BASE_URL;

    const outcome = await startServer(env);

    expectRefused(outcome, "INNGEST_DEV", env);
  }, 90_000);
});
