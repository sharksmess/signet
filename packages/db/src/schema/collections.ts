/**
 * `collection` (ERD §6.1, tranche 004). Colonnes, contraintes et index
 * declaratifs couverts par `pnpm db:generate` ; RLS (activee et forcee, une
 * politique `TO signet_app` sur `current_org()`) et privileges (`SELECT`,
 * `INSERT`) ecrits a la main dans la meme migration (0016, ERD "Ordre des
 * migrations") : la table n'existe jamais sans sa RLS.
 *
 * `UNIQUE (id, organization_id)` est la cible de la cle etrangere composite de
 * `link` (tranche 005). `collection_org_name_ci_idx` porte l'unicite du nom par
 * organisation, insensible a la casse et aux espaces de bord (US-05.3).
 */
import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { appUser } from "./auth";
import { organization } from "./organizations";

export const collection = pgTable(
  "collection",
  {
    id: uuid("id").primaryKey().default(sql`signet.uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("collection_id_organization_id_key").on(table.id, table.organizationId),
    uniqueIndex("collection_org_name_ci_idx").on(table.organizationId, sql`lower(btrim(${table.name}))`),
    check("collection_name_length_chk", sql`char_length(btrim(${table.name})) BETWEEN 1 AND 100`),
    check("collection_name_trimmed_chk", sql`${table.name} = btrim(${table.name})`),
  ],
);
