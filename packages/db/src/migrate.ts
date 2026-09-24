/**
 * Runner de migration dedie, plutot que le migrateur integre de Drizzle.
 *
 * Raison (ERD "Ordre des migrations") : chaque etape doit contenir, dans le
 * MEME fichier, la structure declarative (generee par `drizzle-kit generate`)
 * ET les politiques RLS / triggers / fonctions `SECURITY DEFINER` ecrits a la
 * main. Le migrateur de Drizzle (`drizzle-orm/node-postgres/migrator`) est
 * concu pour des fichiers purement generes ; il ne change rien a la maniere
 * dont un fichier `.sql` est execute, mais ce script explicite le contrat :
 * chaque fichier de `migrations/*.sql` (tri lexicographique, d'ou le prefixe
 * numerique a 4 chiffres) est execute une seule fois, dans une transaction,
 * en integralite, et son nom est enregistre dans `_signet_migrations` pour
 * ne jamais etre rejoue.
 *
 * Necessite `DATABASE_URL_MIGRATE` : un role Postgres 16 suffisamment
 * privilegie pour creer des roles, un schema et des tables (typiquement le
 * superuser d'une instance locale ou jetable de developpement/test — cf.
 * packages/db/migrations/0001_roles_schema_context.sql, tests/helpers/db.ts).
 * Ce role N'EST PAS l'un des roles applicatifs crees par la migration 1.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { Client } from "pg";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} n'est pas definie. pnpm db:migrate exige une connexion Postgres 16 ` +
        `suffisamment privilegiee (voir packages/db/src/migrate.ts).`,
    );
  }
  return value;
}

async function listMigrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en"));
}

async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS public._signet_migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
}

async function alreadyApplied(client: Client): Promise<Set<string>> {
  const result = await client.query<{ name: string }>("SELECT name FROM public._signet_migrations");
  return new Set(result.rows.map((row) => row.name));
}

async function applyMigration(client: Client, fileName: string): Promise<void> {
  const filePath = path.join(MIGRATIONS_DIR, fileName);
  const sql = await readFile(filePath, "utf8");

  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO public._signet_migrations (name) VALUES ($1)", [fileName]);
    await client.query("COMMIT");
    console.log(`applique : ${fileName}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw new Error(`Echec de la migration ${fileName} : ${(error as Error).message}`, {
      cause: error,
    });
  }
}

async function main(): Promise<void> {
  const connectionString = requiredEnv("DATABASE_URL_MIGRATE");
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await ensureMigrationsTable(client);
    const applied = await alreadyApplied(client);
    const files = await listMigrationFiles();
    const pending = files.filter((file) => !applied.has(file));

    if (pending.length === 0) {
      console.log("Aucune migration en attente.");
      return;
    }

    for (const file of pending) {
      await applyMigration(client, file);
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
