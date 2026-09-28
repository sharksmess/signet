/**
 * Tables d'authentification (ERD §2). Vivent dans le schema `public` (par
 * defaut, jamais qualifiees `signet.` — seules les fonctions et roles vivent
 * dans le schema `signet`, cf. ERD §0/§1).
 *
 * Ces colonnes, contraintes et index declaratifs sont couverts par
 * `pnpm db:generate` (Drizzle). Les politiques RLS sont ecrites a la main,
 * dans la migration qui accompagne cette structure (ERD "Ordre des
 * migrations", etape 2).
 *
 * `active_organization_id` reference `organization(id)`, table qui n'existe
 * pas encore a cette etape (ERD §2.2) : la contrainte de cle etrangere est
 * ajoutee dans `./organizations.ts`, une fois `organization` definie, pour
 * que le diff Drizzle produise l'`ALTER TABLE ... ADD CONSTRAINT` dans la
 * migration suivante plutot qu'ici.
 */
import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organization } from "./organizations";

export const appUser = pgTable(
  "app_user",
  {
    id: uuid("id").primaryKey().default(sql`signet.uuidv7()`),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    name: text("name").notNull(),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("app_user_email_lower_idx").on(sql`lower(${table.email})`),
    check("app_user_email_length_chk", sql`char_length(${table.email}) <= 254`),
    check(
      "app_user_email_format_chk",
      sql`${table.email} ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'`,
    ),
    check("app_user_name_length_chk", sql`char_length(btrim(${table.name})) BETWEEN 1 AND 120`),
  ],
);

export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().default(sql`signet.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    // Reference ajoutee seulement maintenant que `organization` existe dans
    // le schema (voir commentaire d'en-tete) : le diff Drizzle produit un
    // ALTER TABLE ... ADD CONSTRAINT dans la migration 0003, jamais dans la
    // 0002 ou `organization` n'existe pas encore.
    activeOrganizationId: uuid("active_organization_id").references(() => organization.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("session_token_idx").on(table.token),
    index("session_user_id_idx").on(table.userId),
    index("session_expires_at_idx").on(table.expiresAt),
  ],
);

export const account = pgTable(
  "account",
  {
    id: uuid("id").primaryKey().default(sql`signet.uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    password: text("password"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    idToken: text("id_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("account_provider_account_idx").on(table.providerId, table.accountId),
    index("account_user_id_idx").on(table.userId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: uuid("id").primaryKey().default(sql`signet.uuidv7()`),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("verification_identifier_idx").on(table.identifier),
    index("verification_expires_at_idx").on(table.expiresAt),
  ],
);
