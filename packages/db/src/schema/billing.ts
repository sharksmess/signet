/**
 * `billing_event` (ERD §8.2) : journal append-only des evenements facturables.
 * Colonnes, contraintes et index declaratifs couverts par `pnpm db:generate` ;
 * RLS, trigger d'immutabilite et fonction `SECURITY DEFINER` d'application
 * d'etat Stripe ecrits a la main dans la meme migration (ERD "Ordre des
 * migrations", ADR-0016).
 *
 * `organization_id` n'a volontairement AUCUNE cle etrangere : l'historique de
 * facturation survit a la suppression de son organisation (ERD §8.2, decide le
 * 2026-09-22).
 */
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { appUser } from "./auth";

export const billingEvent = pgTable(
  "billing_event",
  {
    id: uuid("id").primaryKey().default(sql`signet.uuidv7()`),
    // Pas de REFERENCES organization(id) : voir l'en-tete.
    organizationId: uuid("organization_id").notNull(),
    type: text("type").notNull(),
    // NULL pour subscription_started : aucun etat anterieur.
    fromTier: text("from_tier"),
    // NULL pour subscription_canceled : aucun etat posterieur facture.
    toTier: text("to_tier"),
    // NULL quand Stripe agit seul, ou quand l'auteur a ete supprime.
    actorUserId: uuid("actor_user_id").references(() => appUser.id, { onDelete: "set null" }),
    // NULL pour un evenement d'origine interne ; cle d'idempotence des webhooks.
    stripeEventId: text("stripe_event_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("billing_event_org_time_idx").on(table.organizationId, table.occurredAt.desc(), table.id.desc()),
    uniqueIndex("billing_event_stripe_idx")
      .on(table.stripeEventId)
      .where(sql`stripe_event_id IS NOT NULL`),
    check(
      "billing_event_type_chk",
      sql`${table.type} IN ('subscription_started', 'tier_changed', 'subscription_canceled')`,
    ),
    check("billing_event_from_tier_chk", sql`${table.fromTier} IS NULL OR ${table.fromTier} IN ('free', 'pro')`),
    check("billing_event_to_tier_chk", sql`${table.toTier} IS NULL OR ${table.toTier} IN ('free', 'pro')`),
    check(
      "billing_event_stripe_event_length_chk",
      sql`${table.stripeEventId} IS NULL OR char_length(${table.stripeEventId}) <= 255`,
    ),
    check(
      "billing_event_shape",
      sql`(${table.type} = 'subscription_started' AND ${table.fromTier} IS NULL AND ${table.toTier} IS NOT NULL)
       OR (${table.type} = 'tier_changed' AND ${table.fromTier} IS NOT NULL AND ${table.toTier} IS NOT NULL
           AND ${table.fromTier} <> ${table.toTier})
       OR (${table.type} = 'subscription_canceled' AND ${table.fromTier} IS NOT NULL AND ${table.toTier} IS NULL)`,
    ),
  ],
);
