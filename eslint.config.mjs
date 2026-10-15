// Lint du depot (ADR-0009, ADR-0013) : regles Next (core-web-vitals +
// typescript) sur apps/web, typescript-eslint en mode type-aware sur tout le
// TypeScript.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

const root = dirname(fileURLToPath(import.meta.url));

// eslint-config-next 16 exporte des tableaux de configurations plates, dont
// des objets `{ ignores }` globaux relatifs a la racine (`.next/**`, `out/**`,
// `build/**`, `next-env.d.ts`). Ils sont retires : les ignores du depot, plus
// bas, restent la seule liste, comme avec la ligne 15 (ADR-0013).
function isGlobalIgnores(config) {
  return Object.keys(config).every((key) => key === "ignores" || key === "name");
}

const nextConfigs = [...nextCoreWebVitals, ...nextTypescript].filter((config) => !isGlobalIgnores(config));

export default tseslint.config(
  {
    // docs/templates : gabarits de l'usine, pas du code du projet.
    // next-env.d.ts : genere par next build, ignore par git, a ne pas editer.
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/next-env.d.ts",
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
  ...nextConfigs.map((config) => ({
    ...config,
    files: ["apps/web/**/*.{ts,tsx}"],
    settings: { ...config.settings, next: { rootDir: "apps/web" } },
  })),
  {
    files: ["**/*.mjs", "**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
  // AC16 (A3, D-058) : la connexion signet_billing n'est importable que par le
  // module de la fonction Inngest. Expression reguliere plutot que motif de
  // chemin : elle couvre l'alias `@/`, les chemins relatifs et l'extension.
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^|/)inngest/billing-db(\\.ts)?$|^\\./billing-db(\\.ts)?$",
              message:
                "La connexion signet_billing n'est importable que par lib/inngest/process-stripe-event.ts (AC16, ADR-0016).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/src/lib/inngest/process-stripe-event.ts"],
    rules: { "no-restricted-imports": "off" },
  },
);
