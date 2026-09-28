/**
 * `organization`, `member`, `organization_link_usage`, `subscription`
 * (ERD §3, §4, §7, §8.1). Colonnes, contraintes et index declaratifs
 * couverts par `pnpm db:generate` ; RLS, triggers et fonctions
 * `SECURITY DEFINER` ecrits a la main dans la migration correspondante
 * (0003_organizations_and_policies.sql).
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { appUser } from "./auth";

export const organization = pgTable(
  "organization",
  {
    id: uuid("id").primaryKey().default(sql`signet.uuidv7()`),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("organization_slug_idx").on(table.slug),
    check("organization_name_length_chk", sql`char_length(btrim(${table.name})) BETWEEN 1 AND 120`),
    check(
      "organization_slug_format_chk",
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(${table.slug}) BETWEEN 2 AND 60`,
    ),
  ],
);

export const member = pgTable(
  "member",
  {
    id: uuid("id").primaryKey().default(sql`signet.uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("member_org_user_idx").on(table.organizationId, table.userId),
    index("member_user_idx").on(table.userId),
    uniqueIndex("member_single_owner_idx")
      .on(table.organizationId)
      .where(sql`role = 'owner'`),
    check("member_role_chk", sql`${table.role} IN ('owner', 'member')`),
  ],
);

export const organizationLinkUsage = pgTable(
  "organization_link_usage",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    linkCount: integer("link_count").notNull().default(0),
    // NULL = illimite (palier Pro). Pas de valeur par defaut au niveau
    // colonne : la valeur initiale (50 pour Free) est posee par le trigger
    // de propagation de quota depuis `subscription` (ERD §8.1), jamais ici.
    linkQuota: integer("link_quota"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("organization_link_usage_count_chk", sql`${table.linkCount} >= 0`),
    check(
      "organization_link_usage_quota_chk",
      sql`${table.linkQuota} IS NULL OR ${table.linkQuota} > 0`,
    ),
  ],
);

export const subscription = pgTable(
  "subscription",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    tier: text("tier").notNull().default("free"),
    status: text("status").notNull().default("active"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("subscription_stripe_sub_idx")
      .on(table.stripeSubscriptionId)
      .where(sql`stripe_subscription_id IS NOT NULL`),
    uniqueIndex("subscription_stripe_customer_idx")
      .on(table.stripeCustomerId)
      .where(sql`stripe_customer_id IS NOT NULL`),
    check("subscription_tier_chk", sql`${table.tier} IN ('free', 'pro')`),
    check(
      "subscription_status_chk",
      sql`${table.status} IN ('active', 'past_due', 'canceled', 'incomplete')`,
    ),
    check(
      "subscription_stripe_customer_length_chk",
      sql`${table.stripeCustomerId} IS NULL OR char_length(${table.stripeCustomerId}) <= 255`,
    ),
    check(
      "subscription_pro_is_backed_chk",
      sql`${table.tier} <> 'pro' OR ${table.stripeSubscriptionId} IS NOT NULL`,
    ),
    check(
      "subscription_free_has_no_period_chk",
      sql`${table.tier} <> 'free' OR ${table.currentPeriodEnd} IS NULL`,
    ),
  ],
);
