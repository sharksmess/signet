/**
 * Schema de l'environnement du serveur (AC13, AC15 ; ADR-0015, ADR-0016).
 *
 * Toute variable lue par la facturation et la file d'attente est validee ici,
 * une fois, au premier appel de `getServerEnv`, jamais au chargement d'un
 * module (D-079 : `next build` charge les routes). Une variable absente ou mal
 * formee arrete le serveur au demarrage (`assertServerEnvOrExit`, appelee par
 * `instrumentation.ts`) et fait echouer l'appel. Le message ne cite que des NOMS de
 * variables, jamais une valeur (regle absolue CLAUDE.md : secrets jamais dans
 * un message d'erreur).
 *
 * Gardes croisees :
 * - `STRIPE_API_BASE_URL` (faux Stripe des tests, D-059) n'est acceptee qu'avec
 *   `APP_ENV=test`, meme garde que `AUTH_RATE_LIMIT=off` (ADR-0010) ;
 * - le mode developpement d'Inngest (`INNGEST_DEV`, signature des appels
 *   desactivee) n'est accepte qu'avec `APP_ENV=test` ou `development` (A2) ;
 * - hors mode developpement, `INNGEST_SIGNING_KEY` et `INNGEST_EVENT_KEY` sont
 *   exigees.
 *
 * `APP_ENV` absent vaut `production` (la valeur la plus restrictive).
 *
 * Fonction pure `parseServerEnv` : aucune lecture implicite de `process.env`
 * (modele : `buildRateLimitOptions`). Imports relatifs seulement : le module est
 * charge par la suite de tests hors de Next (pas d'alias `@/`).
 */
import { z } from "zod";

const postgresUrl = z
  .string()
  .refine((value) => URL.canParse(value) && /^postgres(ql)?:$/.test(new URL(value).protocol));

const httpUrl = z
  .string()
  .refine((value) => URL.canParse(value) && /^https?:$/.test(new URL(value).protocol));

const serverEnvSchema = z
  .object({
    APP_ENV: z.enum(["test", "development", "production"]).default("production"),
    DATABASE_URL_APP: postgresUrl,
    DATABASE_URL_AUTH: postgresUrl,
    DATABASE_URL_BILLING: postgresUrl,
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: httpUrl,
    APP_URL: httpUrl,
    STRIPE_SECRET_KEY: z.string().regex(/^(sk|rk)_(test|live)_[A-Za-z0-9_]+$/),
    STRIPE_WEBHOOK_SECRET: z.string().regex(/^whsec_[A-Za-z0-9_]+$/),
    STRIPE_PRICE_ID_PRO: z.string().regex(/^price_[A-Za-z0-9_]+$/),
    STRIPE_API_BASE_URL: httpUrl.optional(),
    // URL du serveur de developpement Inngest (ou du faux des tests), ou `1`.
    INNGEST_DEV: z.union([z.literal("1"), httpUrl]).optional(),
    INNGEST_SIGNING_KEY: z.string().regex(/^signkey-[a-z]+-[0-9a-f]{32,}$/).optional(),
    INNGEST_EVENT_KEY: z.string().min(8).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.STRIPE_API_BASE_URL !== undefined && env.APP_ENV !== "test") {
      ctx.addIssue({ code: "custom", path: ["STRIPE_API_BASE_URL"], message: "acceptee seulement avec APP_ENV=test" });
    }
    const devMode = env.INNGEST_DEV !== undefined;
    if (devMode && env.APP_ENV === "production") {
      ctx.addIssue({ code: "custom", path: ["INNGEST_DEV"], message: "refusee avec APP_ENV=production" });
    }
    if (!devMode && env.INNGEST_SIGNING_KEY === undefined) {
      ctx.addIssue({ code: "custom", path: ["INNGEST_SIGNING_KEY"], message: "exigee hors mode developpement" });
    }
    if (!devMode && env.INNGEST_EVENT_KEY === undefined) {
      ctx.addIssue({ code: "custom", path: ["INNGEST_EVENT_KEY"], message: "exigee hors mode developpement" });
    }
  });

type ValidatedEnv = z.infer<typeof serverEnvSchema>;

/**
 * Environnement commun, SANS `DATABASE_URL_BILLING` (audit-002 INFO-1, D-071) :
 * la variable est validee au demarrage comme les autres, mais seul
 * `lib/inngest/billing-db.ts` la lit, par `billingDatabaseUrl()` ; la regle de
 * lint d'AC16 interdit cet accesseur et `process.env.DATABASE_URL_BILLING`
 * partout ailleurs.
 */
export type ServerEnv = Omit<ValidatedEnv, "DATABASE_URL_BILLING">;

/** Les entrees vides valent absentes (une ligne `NOM=` dans un fichier .env). */
function withoutEmpty(raw: Record<string, string | undefined>): Record<string, string> {
  const entries = Object.entries(raw).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== "");
  return Object.fromEntries(entries);
}

function validate(raw: Record<string, string | undefined>): ValidatedEnv {
  const parsed = serverEnvSchema.safeParse(withoutEmpty(raw));
  if (!parsed.success) {
    // Noms de variables et regle enfreinte seulement : jamais la valeur recue.
    const problems = parsed.error.issues.map((issue) => {
      const name = issue.path.join(".") || "(environnement)";
      return issue.code === "custom" ? `${name} : ${issue.message}` : `${name} : absente ou mal formee`;
    });
    throw new Error(`Environnement du serveur invalide, demarrage refuse. ${problems.join(" ; ")}.`);
  }
  return parsed.data;
}

export function parseServerEnv(raw: Record<string, string | undefined>): ServerEnv {
  const common: ServerEnv & { DATABASE_URL_BILLING?: string } = { ...validate(raw) };
  delete common.DATABASE_URL_BILLING;
  return common;
}

/** Reserve a `lib/inngest/billing-db.ts` (AC16, D-071) : URL de la connexion `signet_billing`, validee. */
export function billingDatabaseUrl(): string {
  return validate(process.env).DATABASE_URL_BILLING;
}

let cached: ServerEnv | null = null;

/** Environnement du processus, valide une fois. */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

export function isInngestDevMode(env: ServerEnv): boolean {
  return env.INNGEST_DEV !== undefined;
}

/**
 * Refus de demarrer (D-070) : appelee par `instrumentation.ts`, runtime Node
 * seulement. Next 16 ne fait que journaliser une erreur levee par
 * `register()` et continue d'ecouter : le processus est donc arrete ici. Le
 * message ne cite que des noms de variables.
 */
export function assertServerEnvOrExit(raw: Record<string, string | undefined>): void {
  try {
    parseServerEnv(raw);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Environnement du serveur invalide, demarrage refuse.");
    process.exit(1);
  }
}
