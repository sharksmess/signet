// Chargement de l'environnement de test, commun au globalSetup et aux tests.
// Les valeurs vivent dans .env.test.local (ignore par git, illisible par les
// agents) : le processus les lit, le modele ne les voit jamais.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

export const ROOT = path.resolve(import.meta.dirname, "../..");

// Variables deja chargees depuis le fichier par ce processus (appels repetes).
const LOADED = new Set<string>();

/**
 * Charge .env.test.local dans process.env. Une variable deja presente dans
 * l'environnement du terminal avec une AUTRE valeur fait echouer le chargement :
 * sinon elle l'emporterait en silence (process.loadEnvFile n'ecrase rien) et les
 * tests viseraient une autre base que celle du fichier. Vecu : une vieille
 * fenetre PowerShell pointait sur la base de dev, 11 faux echecs.
 * Seuls les NOMS des variables apparaissent dans le message, jamais les valeurs.
 */
export function loadTestEnv(): void {
  const file = path.join(ROOT, ".env.test.local");
  // En CI, les variables viennent du workflow : le fichier est absent, c'est normal.
  if (!existsSync(file)) return;
  const values = parseEnv(readFileSync(file, "utf8"));
  const conflicts = Object.keys(values).filter(
    (k) => process.env[k] !== undefined && process.env[k] !== values[k] && !LOADED.has(k),
  );
  if (conflicts.length > 0) {
    throw new Error(
      `[tests] Variables definies a la fois dans l'environnement du terminal et dans .env.test.local, ` +
        `avec des valeurs differentes : ${conflicts.join(", ")}.\n` +
        `Ferme ce terminal et ouvres-en un neuf (ou Remove-Item env:<NOM>), puis relance. ` +
        `Le fichier .env.test.local est la seule source des tests.`,
    );
  }
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined && process.env[k] === undefined) process.env[k] = v;
    LOADED.add(k);
  }
}

/** Noms (jamais les valeurs) des variables TEST_* venues du terminal plutot que du fichier. */
export function envOrigin(): { fromFile: number; fromShell: string[] } {
  const shell = Object.keys(process.env).filter((k) => k.startsWith("TEST_") && !LOADED.has(k));
  return { fromFile: LOADED.size, fromShell: shell.sort() };
}

export function requireEnv<const N extends string>(names: readonly N[]): Record<N, string> {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length > 0) {
    throw new Error(
      `[tests] Variables manquantes : ${missing.join(", ")}.\n` +
        `Copie .env.test.example en .env.test.local a la racine et renseigne-les ` +
        `(l'humain le fait ; un agent ne lit ni n'ecrit ce fichier).`,
    );
  }
  return Object.fromEntries(names.map((n) => [n, process.env[n] as string])) as Record<N, string>;
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
