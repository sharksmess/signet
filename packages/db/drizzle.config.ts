import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/**
 * `drizzle-kit generate` n'a besoin d'aucune connexion reseau : il diffe le
 * schema TypeScript contre l'historique local (`migrations/meta`). Seule
 * `drizzle-kit migrate` (non utilise ici, cf. src/migrate.ts) exigerait une
 * connexion — nous n'utilisons pas le migrateur integre de Drizzle, voir
 * src/migrate.ts pour la raison (intercalation de migrations SQL ecrites a
 * la main, ERD "Ordre des migrations").
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL_MIGRATE ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
