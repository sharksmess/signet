/**
 * `invitation` (ERD §5, tranche 003). Colonnes, contraintes et index
 * declaratifs couverts par `pnpm db:generate` ; RLS (owner seul, D-086 P-3),
 * privileges et fonction `signet.create_invitation` (SECURITY INVOKER) ecrits a
 * la main dans la meme migration (0014, D-088 ; ERD "Ordre des migrations").
 *
 * Le secret du lien n'est jamais stocke : seule son empreinte SHA-256
 * (`token_hash`, 32 octets) l'est (ADR-0003, D-090).
 */
import { sql } from "drizzle-orm";
import { check, customType, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { appUser } from "./auth";
import { organization } from "./organizations";

/** `bytea` : pg-core n'a pas de type de colonne natif pour ce type dans cette version. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const invitation = pgTable(
  "invitation",
  {
    id: uuid("id").primaryKey().default(sql`signet.uuidv7()`),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull().default("member"),
    tokenHash: bytea("token_hash").notNull(),
    invitedByUserId: uuid("invited_by_user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '7 days'`),
    // NULL = invitation non encore consommee (etat derive, ERD §5).
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    // NULL tant que l'invitation n'est pas acceptee (invitation_acceptance_consistent).
    acceptedByUserId: uuid("accepted_by_user_id").references(() => appUser.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("invitation_token_hash_idx").on(table.tokenHash),
    uniqueIndex("invitation_pending_idx")
      .on(table.organizationId, table.email)
      .where(sql`accepted_at IS NULL`),
    index("invitation_org_idx").on(table.organizationId),
    index("invitation_expires_idx")
      .on(table.expiresAt)
      .where(sql`accepted_at IS NULL`),
    check("invitation_email_lower_chk", sql`${table.email} = lower(${table.email})`),
    check("invitation_email_length_chk", sql`char_length(${table.email}) <= 254`),
    check(
      "invitation_email_format_chk",
      sql`${table.email} ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'`,
    ),
    check("invitation_role_chk", sql`${table.role} = 'member'`),
    check("invitation_token_hash_length_chk", sql`octet_length(${table.tokenHash}) = 32`),
    check("invitation_expires_after_creation_chk", sql`${table.expiresAt} > ${table.createdAt}`),
    check(
      "invitation_expires_within_7_days_chk",
      sql`${table.expiresAt} <= ${table.createdAt} + interval '7 days'`,
    ),
    check(
      "invitation_acceptance_consistent",
      sql`(${table.acceptedAt} IS NULL) = (${table.acceptedByUserId} IS NULL)`,
    ),
  ],
);
