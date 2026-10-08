/**
 * Tranche 002 — AC16 : isolement de la connexion `signet_billing` (A3, D-058).
 *
 * La connexion DATABASE_URL_BILLING vit dans `apps/web/src/lib/inngest/
 * billing-db.ts` et n'est importable que par le module de la fonction Inngest.
 * Preuve mecanique : la regle `no-restricted-imports` de eslint.config.mjs
 * refuse cet import partout ailleurs. Ce test lint du code (API ESLint,
 * `lintText`) avec le chemin d'un fichier fictif de route, et attend l'erreur ;
 * il lint le meme import depuis le module de la fonction et n'en attend aucune.
 *
 * Chemins supposes (voir rapport) : module de connexion `lib/inngest/billing-db.ts`,
 * module de la fonction `lib/inngest/process-stripe-event.ts`.
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { ESLint } from "eslint";
import type { Linter } from "eslint";
import tseslint from "typescript-eslint";

const root = path.resolve(__dirname, "../..");
const RULE = "no-restricted-imports";

const ROUTE = path.join(root, "apps/web/src/app/api/fictif/route.ts");
const FUNCTION_MODULE = path.join(root, "apps/web/src/lib/inngest/process-stripe-event.ts");
const SIBLING_MODULE = path.join(root, "apps/web/src/lib/inngest/serve.ts");
const DB_MODULE = path.join(root, "apps/web/src/lib/db.ts");

/**
 * Le code est lint comme texte, avec le chemin d'un fichier qui n'existe pas
 * (route fictive, module non encore ecrit) : l'analyse typee de
 * typescript-eslint (projectService) exige un fichier connu du projet et
 * echouerait en erreur fatale avant toute regle. Seule la verification de type
 * est donc desactivee (meme configuration que celle appliquee aux .mjs dans
 * eslint.config.mjs) ; toutes les autres regles, dont `no-restricted-imports`
 * telle que configuree dans eslint.config.mjs, s'appliquent.
 */
async function lint(code: string, filePath: string): Promise<Linter.LintMessage[]> {
  const eslint = new ESLint({
    cwd: root,
    overrideConfig: [{ ...tseslint.configs.disableTypeChecked, files: ["**/*.ts"] }],
  });
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages ?? [];
}

function restrictedImportErrors(messages: Linter.LintMessage[]): Linter.LintMessage[] {
  return messages.filter((m) => m.ruleId === RULE && m.severity === 2);
}

function describeMessages(messages: Linter.LintMessage[]): string {
  return JSON.stringify(messages.map((m) => ({ ruleId: m.ruleId, severity: m.severity, fatal: m.fatal, message: m.message })));
}

describe("AC16 — import de billing-db interdit hors du module de la fonction Inngest", () => {
  it("AC16 : une route qui importe billing-db (alias @/) recoit une erreur no-restricted-imports", async () => {
    const code = 'import { getBillingPool } from "@/lib/inngest/billing-db";\n\nexport const runtime = getBillingPool;\n';

    const messages = await lint(code, ROUTE);

    expect(restrictedImportErrors(messages), `messages ESLint : ${describeMessages(messages)}`).not.toHaveLength(0);
  });

  it("AC16 : une route qui importe billing-db par chemin relatif recoit une erreur no-restricted-imports", async () => {
    const code = 'import { getBillingPool } from "../../../lib/inngest/billing-db";\n\nexport const runtime = getBillingPool;\n';

    const messages = await lint(code, ROUTE);

    expect(restrictedImportErrors(messages), `messages ESLint : ${describeMessages(messages)}`).not.toHaveLength(0);
  });

  it("AC16 : db.ts importe billing-db -> erreur no-restricted-imports (la connexion reste hors de db.ts)", async () => {
    const code = 'import { getBillingPool } from "./inngest/billing-db";\n\nexport const pool = getBillingPool;\n';

    const messages = await lint(code, DB_MODULE);

    expect(restrictedImportErrors(messages), `messages ESLint : ${describeMessages(messages)}`).not.toHaveLength(0);
  });

  it("AC16 : un autre module du dossier inngest (serve.ts) importe billing-db -> erreur no-restricted-imports", async () => {
    const code = 'import { getBillingPool } from "./billing-db";\n\nexport const pool = getBillingPool;\n';

    const messages = await lint(code, SIBLING_MODULE);

    expect(restrictedImportErrors(messages), `messages ESLint : ${describeMessages(messages)}`).not.toHaveLength(0);
  });

  it("AC16 : le module de la fonction Inngest importe billing-db -> aucune erreur no-restricted-imports", async () => {
    const code = 'import { getBillingPool } from "./billing-db";\n\nexport const pool = getBillingPool;\n';

    const messages = await lint(code, FUNCTION_MODULE);

    expect(restrictedImportErrors(messages), `messages ESLint : ${describeMessages(messages)}`).toEqual([]);
    expect(
      messages.filter((m) => m.fatal),
      `le fichier doit etre analysable (une erreur fatale masquerait la regle) : ${describeMessages(messages)}`,
    ).toEqual([]);
  });

  it("AC16 : un import voisin non restreint (un autre module de lib/inngest) n'est pas touche par la regle", async () => {
    const code = 'import { inngest } from "./client";\n\nexport const client = inngest;\n';

    const messages = await lint(code, ROUTE.replace("fictif/route.ts", "fictif/autre.ts"));

    expect(restrictedImportErrors(messages), `messages ESLint : ${describeMessages(messages)}`).toEqual([]);
  });
});
