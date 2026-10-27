/**
 * `link` (ERD §6.2, tranche 005). Colonnes, contraintes et index declaratifs
 * couverts par `pnpm db:generate` ; RLS (activee et forcee, politique unique
 * `link_isolation` `TO signet_app` sur `current_org()`), privileges (`SELECT`,
 * `INSERT`), fonction `signet.link_usage_on_insert()` et trigger
 * `AFTER INSERT` de compteur (ADR-0002, ERD §7) ecrits a la main dans la meme
 * migration (0017) : la table n'existe jamais sans sa RLS ni son compteur.
 *
 * `link_collection_fk (collection_id, organization_id) -> collection (id,
 * organization_id)` rend la denormalisation d'`organization_id` incorruptible :
 * un lien ne peut pas appartenir a une autre organisation que sa collection.
 */
import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { appUser } from "./auth";
import { collection } from "./collections";
import { organization } from "./organizations";

export const link = pgTable(
  "link",
  {
    id: uuid("id").primaryKey().default(sql`signet.uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    addedByUserId: uuid("added_by_user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "link_collection_fk",
      columns: [table.collectionId, table.organizationId],
      foreignColumns: [collection.id, collection.organizationId],
    }).onDelete("cascade"),
    check("link_url_scheme_chk", sql`${table.url} ~ '^https?://[^[:space:]]+$'`),
    check("link_url_length_chk", sql`char_length(${table.url}) BETWEEN 8 AND 2048`),
    check("link_title_length_chk", sql`char_length(btrim(${table.title})) BETWEEN 1 AND 200`),
    index("link_collection_recent_idx").on(table.collectionId, table.createdAt.desc().nullsFirst(), table.id.desc().nullsFirst()),
    index("link_org_idx").on(table.organizationId),
    index("link_author_idx").on(table.addedByUserId),
  ],
);
