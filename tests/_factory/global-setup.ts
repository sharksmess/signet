// globalSetup Vitest de l'usine — rend la suite autonome et reproductible :
//   1. charge l'environnement depuis .env.test.local (ou la CI) ;
//   2. verifie Postgres et echoue en UNE phrase claire s'il est injoignable ;
//   3. recree une base de test dediee (jamais la base de dev), la migre ;
//   4. construit puis demarre le serveur applicatif sur le port de test,
//      avec les variables de la base de test, et l'arrete a la fin.
// Aucun serveur a lancer a la main, aucun secret a synchroniser entre fenetres.
import { spawn, execSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import pg from "pg";
import { ROOT, loadTestEnv, requireEnv, testDbUrl } from "./env";

const log = (m: string) => process.stdout.write(`[tests] ${m}\n`);

function fail(message: string): never {
  // Une seule erreur lisible plutot que 30 tests rouges qui ressemblent a des bugs.
  throw new Error(`\n\n[tests] PRE-REQUIS NON SATISFAIT\n${message}\n`);
}

async function recreateTestDatabase(): Promise<void> {
  const { TEST_DATABASE_ADMIN_URL, TEST_DATABASE_NAME } = requireEnv([
    "TEST_DATABASE_ADMIN_URL",
    "TEST_DATABASE_NAME",
  ]);
  if (!/^[a-z0-9_]+_test$/.test(TEST_DATABASE_NAME)) {
    fail(`TEST_DATABASE_NAME="${TEST_DATABASE_NAME}" : doit se terminer par _test. Garde-fou contre la destruction de la base de dev.`);
  }
  const admin = new pg.Client({ connectionString: TEST_DATABASE_ADMIN_URL });
  try {
    await admin.connect();
  } catch (e) {
    const u = new URL(TEST_DATABASE_ADMIN_URL);
    fail(
      `Postgres injoignable sur ${u.hostname}:${u.port || 5432} (${(e as Error).message}).\n` +
        `Windows : Get-Service postgresql*  |  CI : service postgres du workflow.`,
    );
  }
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${TEST_DATABASE_NAME}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
    log(`base ${TEST_DATABASE_NAME} recreee`);
  } finally {
    await admin.end();
  }

  const urlVar = process.env.TEST_MIGRATE_URL_VAR ?? "DATABASE_URL_MIGRATE";
  const cmd = process.env.TEST_MIGRATE_CMD ?? "pnpm db:migrate";
  log(`migrations : ${cmd}`);
  try {
    execSync(cmd, { cwd: ROOT, stdio: "inherit", env: { ...process.env, [urlVar]: testDbUrl() } });
  } catch {
    fail(`les migrations echouent sur la base de test (commande : ${cmd}). Corrige la migration, pas le test.`);
  }

  // Mots de passe des roles applicatifs, utile en CI ou les roles viennent
  // d'etre crees sans mot de passe. Format "role:motdepasse,role2:motdepasse2".
  // Les roles sont communs a tout le cluster : en local, ne le definir que si
  // la base de dev utilise les memes mots de passe.
  const pw = process.env.TEST_ROLE_PASSWORDS;
  if (pw) {
    const c = new pg.Client({ connectionString: TEST_DATABASE_ADMIN_URL });
    await c.connect();
    try {
      for (const pair of pw.split(",")) {
        const [role, password] = pair.split(":");
        if (!role || !password || !/^[a-z_][a-z0-9_]*$/.test(role)) fail(`TEST_ROLE_PASSWORDS mal forme pres de "${role}".`);
        await c.query(`ALTER ROLE "${role}" WITH PASSWORD '${password.replace(/'/g, "''")}'`);
      }
    } finally {
      await c.end();
    }
  }
}

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(true));
    s.once("listening", () => s.close(() => resolve(false)));
    s.listen(port, "127.0.0.1");
  });
}

function serverEnv(): NodeJS.ProcessEnv {
  // TEST_SERVER_ENV_FOO=bar est transmis au serveur sous le nom FOO=bar.
  // Ainsi le serveur de test pointe sur la base de test, jamais sur celle de dev.
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("TEST_SERVER_ENV_") && v !== undefined) env[k.slice("TEST_SERVER_ENV_".length)] = v;
  }
  return env;
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

async function startServer(): Promise<ChildProcess | undefined> {
  const base = process.env.TEST_APP_BASE_URL;
  if (!base) return undefined; // suite sans serveur HTTP
  const port = Number(new URL(base).port || 80);
  if (await portInUse(port)) {
    fail(`le port ${port} est deja occupe. Arrete le serveur qui l'utilise : il pointe peut-etre sur la base de dev.`);
  }
  const env = serverEnv();
  if (process.env.TEST_SKIP_BUILD !== "1") {
    const build = process.env.TEST_SERVER_BUILD_CMD ?? "pnpm run build";
    log(`build : ${build}`);
    try {
      execSync(build, { cwd: ROOT, stdio: "inherit", env });
    } catch {
      fail(`le build echoue (${build}). Un code qui ne se construit pas ne se teste pas.`);
    }
  }
  const start = (process.env.TEST_SERVER_START_CMD ?? "pnpm --dir apps/web exec next start -p {port}").replace("{port}", String(port));
  log(`serveur : ${start}`);
  const child = spawn(start, { cwd: ROOT, env, shell: true, detached: process.platform !== "win32" });
  const tail: string[] = [];
  const keep = (b: Buffer) => {
    tail.push(...b.toString().split("\n"));
    if (tail.length > 40) tail.splice(0, tail.length - 40);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);

  const deadline = Date.now() + Number(process.env.TEST_SERVER_TIMEOUT_MS ?? 90_000);
  while (Date.now() < deadline) {
    if (child.exitCode !== null) fail(`le serveur s'est arrete au demarrage :\n${tail.join("\n")}`);
    try {
      await fetch(base, { signal: AbortSignal.timeout(2_000) });
      log(`serveur pret sur ${base}`);
      return child;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  killTree(child);
  fail(`le serveur ne repond pas sur ${base} apres le delai imparti :\n${tail.join("\n")}`);
}

export default async function setup(): Promise<() => void> {
  loadTestEnv();
  await recreateTestDatabase();
  const server = await startServer();
  return () => {
    if (server) killTree(server);
    // La base de test est conservee pour l'inspection post-mortem ; elle est
    // recreee au prochain lancement.
  };
}
