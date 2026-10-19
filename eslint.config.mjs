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
  ...billingIsolation(),
);

/**
 * AC16 (A3, D-058, renforce par D-071) : la connexion signet_billing n'est
 * accessible qu'au module de la fonction Inngest.
 * - import statique de `billing-db` (alias `@/`, chemin relatif quelconque,
 *   extension `.ts`/`.js`/...) : interdit partout, sauf `./billing-db` depuis
 *   `lib/inngest/process-stripe-event.ts` (exception limitee a ce seul motif) ;
 * - import dynamique (`import()`) et `require()` de `billing-db` : interdits
 *   partout, y compris dans le module de la fonction ;
 * - l'accesseur `billingDatabaseUrl` de `lib/env.ts` : importable par
 *   `lib/inngest/billing-db.ts` seul ;
 * - `process.env.DATABASE_URL_BILLING` (point, crochets, destructuration) :
 *   interdit partout dans l'application (audit-002 INFO-1).
 * Preuve : tests/billing/lint-isolation.test.ts et lint-isolation-forms.test.ts.
 */
function billingIsolation() {
  const message =
    "La connexion signet_billing n'est accessible qu'a lib/inngest/process-stripe-event.ts (AC16, ADR-0016).";
  // String.raw : les antislashs vont tels quels aux expressions regulieres.
  const billingDb = String.raw`(^|/)billing-db(\.[cm]?[jt]sx?)?$`;
  const billingDbExceptSibling = String.raw`^(?!\./billing-db$).*(^|/)billing-db(\.[cm]?[jt]sx?)?$`;
  const envAccessor = {
    regex: String.raw`(^|/)env(\.[cm]?[jt]s)?$`,
    importNames: ["billingDatabaseUrl"],
    message: "billingDatabaseUrl est reserve a lib/inngest/billing-db.ts (AC16, D-071).",
  };
  // esquery ne lit pas de "/" dans une expression reguliere de selecteur, meme
  // echappe : la barre est ecrite \x2F.
  const literal = String.raw`/(^|\x2F)billing-db(\.[cm]?[jt]sx?)?$/`;
  const syntax = [
    "error",
    { selector: `ImportExpression[source.value=${literal}]`, message },
    { selector: `CallExpression[callee.name='require'][arguments.0.value=${literal}]`, message },
    {
      selector:
        "MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env'][property.name='DATABASE_URL_BILLING']",
      message,
    },
    {
      selector:
        "MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env'][property.value='DATABASE_URL_BILLING']",
      message,
    },
    {
      selector:
        "VariableDeclarator[init.type='MemberExpression'][init.object.name='process'][init.property.name='env'] > ObjectPattern > Property[key.name='DATABASE_URL_BILLING']",
      message,
    },
  ];
  const imports = (billingDbRegex, withEnvAccessor) => [
    "error",
    { patterns: [{ regex: billingDbRegex, message }, ...(withEnvAccessor ? [envAccessor] : [])] },
  ];
  return [
    {
      files: ["apps/web/**/*.{ts,tsx}"],
      rules: { "no-restricted-imports": imports(billingDb, true), "no-restricted-syntax": syntax },
    },
    {
      files: ["apps/web/src/lib/inngest/process-stripe-event.ts"],
      rules: { "no-restricted-imports": imports(billingDbExceptSibling, true) },
    },
    {
      files: ["apps/web/src/lib/inngest/billing-db.ts"],
      rules: { "no-restricted-imports": imports(billingDb, false) },
    },
  ];
}
