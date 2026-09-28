/**
 * Limiteur de debit de better-auth (ADR-0010).
 *
 * better-auth ne l'active par defaut qu'en `NODE_ENV=production`. Ici il est
 * toujours actif, sauf une seule combinaison : AUTH_RATE_LIMIT=off ET
 * APP_ENV=test, posee par la suite de tests (serveur de l'usine) et la CI.
 * Toute autre combinaison avec off, ou toute valeur invalide, leve au
 * demarrage : une erreur de configuration empeche le serveur de demarrer,
 * elle n'ouvre jamais le limiteur. APP_ENV absent vaut production.
 *
 * Fonction pure, sans lecture implicite de process.env : testee sans HTTP
 * (tests/organizations/auth-rate-limit.test.ts).
 */
import { z } from "zod";

const rateLimitEnvSchema = z.object({
  AUTH_RATE_LIMIT: z.enum(["on", "off"]).default("on"),
  APP_ENV: z.enum(["test", "development", "production"]).default("production"),
});

/**
 * Inscription : 3 requetes par 10 s et par IP. C'est aussi la regle
 * speciale integree de better-auth 1.7.5, reprise explicitement pour
 * qu'elle ne depende pas d'un defaut de la bibliotheque.
 */
export const SIGN_UP_RATE_LIMIT = { window: 10, max: 3 } as const;

export interface RateLimitOptions {
  enabled: boolean;
  customRules: Record<string, { window: number; max: number }>;
}

export function buildRateLimitOptions(env: Record<string, string | undefined>): RateLimitOptions {
  const parsed = rateLimitEnvSchema.safeParse(env);
  if (!parsed.success) {
    // Seuls les noms et valeurs de ces deux variables, jamais d'autre entree
    // de l'environnement : aucun secret ne peut fuiter par ce message.
    throw new Error(
      `Configuration du limiteur invalide (AUTH_RATE_LIMIT="${env.AUTH_RATE_LIMIT ?? ""}", ` +
        `APP_ENV="${env.APP_ENV ?? ""}") : AUTH_RATE_LIMIT vaut on|off, APP_ENV vaut test|development|production.`,
    );
  }
  const { AUTH_RATE_LIMIT, APP_ENV } = parsed.data;
  if (AUTH_RATE_LIMIT === "off" && APP_ENV !== "test") {
    throw new Error(
      `AUTH_RATE_LIMIT=off n'est accepte qu'avec APP_ENV=test (APP_ENV=${APP_ENV}). ` +
        `Demarrage refuse plutot que d'ouvrir le limiteur de debit.`,
    );
  }
  return {
    enabled: AUTH_RATE_LIMIT === "on",
    customRules: { "/sign-up/*": { ...SIGN_UP_RATE_LIMIT } },
  };
}
