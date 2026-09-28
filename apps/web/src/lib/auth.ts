/**
 * Instance better-auth (ERD §2, §2.2 "Ecarts assumes"). Email + mot de passe
 * uniquement : seul fournisseur du MVP (ERD, PRD). Connexion dediee
 * `DATABASE_URL_AUTH` (role `signet_auth`, ADR-0007) : better-auth ne touche
 * jamais les tables tenant.
 *
 * Le plugin `organization` de better-auth n'est pas active : la creation
 * d'une organisation passe exclusivement par `signet.create_organization()`
 * (SECURITY DEFINER, packages/db/migrations/0003_organizations_and_policies.sql),
 * jamais par le CRUD par defaut du plugin (docs/03-slices/001-creation-organisation.md,
 * perimetre — pas de selecteur multi-organisation dans cette tranche).
 *
 * `fields` mappe explicitement chaque colonne divergente vers son nom
 * snake_case (packages/db/src/schema/auth.ts), plutot que de s'appuyer sur
 * une convention de casing implicite de l'adaptateur : une seule source de
 * verite, stable independamment de la version de l'adaptateur Kysely interne.
 */
import { betterAuth } from "better-auth";
import { buildRateLimitOptions } from "./auth-rate-limit";
import { getAuthPool } from "./db";
import { uuidv7 } from "./uuid";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} n'est pas definie. Voir apps/web/src/lib/auth.ts.`);
  }
  return value;
}

export const auth = betterAuth({
  database: getAuthPool(),
  secret: requiredEnv("BETTER_AUTH_SECRET"),
  emailAndPassword: {
    enabled: true,
  },
  // Actif partout, desactivable uniquement en APP_ENV=test (ADR-0010) ;
  // evalue au chargement du module : une configuration invalide bloque le
  // demarrage.
  rateLimit: buildRateLimitOptions(process.env),
  advanced: {
    database: {
      // UUIDv7 cote applicatif (ERD "Prerequis d'infrastructure"),
      // algorithmiquement identique a signet.uuidv7() : better-auth genere
      // l'id avant l'INSERT, il ne peut pas s'appuyer sur le DEFAULT SQL.
      generateId: () => uuidv7(),
    },
  },
  user: {
    modelName: "app_user",
    fields: {
      createdAt: "created_at",
      updatedAt: "updated_at",
      emailVerified: "email_verified",
    },
  },
  session: {
    fields: {
      createdAt: "created_at",
      updatedAt: "updated_at",
      userId: "user_id",
      expiresAt: "expires_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
    },
  },
  account: {
    fields: {
      createdAt: "created_at",
      updatedAt: "updated_at",
      providerId: "provider_id",
      accountId: "account_id",
      userId: "user_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      idToken: "id_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
    },
  },
  verification: {
    fields: {
      createdAt: "created_at",
      updatedAt: "updated_at",
      expiresAt: "expires_at",
    },
  },
});
