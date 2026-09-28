// Lint du depot (ADR-0009) : regles Next (core-web-vitals + typescript) sur
// apps/web, typescript-eslint en mode type-aware sur tout le TypeScript.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import tseslint from "typescript-eslint";

const root = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: root });

export default tseslint.config(
  {
    // docs/templates : gabarits de l'usine, pas du code du projet.
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "packages/db/migrations/**",
      ".claude/**",
      "docs/templates/**",
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Fichiers de configuration hors de tout tsconfig : analyses avec le
        // projet par defaut plutot que sortis du lint.
        projectService: {
          allowDefaultProject: ["vitest.config.ts", "apps/web/next.config.ts", "packages/db/drizzle.config.ts"],
        },
        tsconfigRootDir: root,
      },
    },
    rules: {
      // CLAUDE.md : pas de `any`, pas de suppression de verification de type.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true }],
    },
  },
  ...compat.extends("next/core-web-vitals", "next/typescript").map((config) => ({
    ...config,
    files: ["apps/web/**/*.{ts,tsx}"],
    settings: { ...config.settings, next: { rootDir: "apps/web" } },
  })),
  {
    files: ["**/*.mjs", "**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
);
