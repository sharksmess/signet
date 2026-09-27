// Chargement de l'environnement de test, commun au globalSetup et aux tests.
// Les valeurs vivent dans .env.test.local (ignore par git, illisible par les
// agents) : le processus les lit, le modele ne les voit jamais.
import { existsSync } from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "../..");

export function loadTestEnv(): void {
  const file = path.join(ROOT, ".env.test.local");
  // En CI, les variables viennent du workflow : le fichier est absent, c'est normal.
  // process.loadEnvFile n'ecrase jamais une variable deja definie.
  if (existsSync(file)) process.loadEnvFile(file);
}

export function requireEnv(names: readonly string[]): Record<string, string> {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length > 0) {
    throw new Error(
      `[tests] Variables manquantes : ${missing.join(", ")}.\n` +
        `Copie .env.test.example en .env.test.local a la racine et renseigne-les ` +
        `(l'humain le fait ; un agent ne lit ni n'ecrit ce fichier).`,
    );
  }
  return Object.fromEntries(names.map((n) => [n, process.env[n] as string]));
}

/** URL d'administration pointee sur la base de test (jamais la base de dev). */
export function testDbUrl(): string {
  const { TEST_DATABASE_ADMIN_URL, TEST_DATABASE_NAME } = requireEnv([
    "TEST_DATABASE_ADMIN_URL",
    "TEST_DATABASE_NAME",
  ]);
  const u = new URL(TEST_DATABASE_ADMIN_URL);
  u.pathname = `/${TEST_DATABASE_NAME}`;
  return u.toString();
}
