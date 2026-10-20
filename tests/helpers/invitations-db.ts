/**
 * Acces base de la tranche 003 (invitations) : lectures de verification et
 * arrangements sous la connexion d'administration (BYPASSRLS, tests/helpers/db.ts).
 *
 * Regle du projet : jamais utilise pour verifier un comportement d'isolation ou
 * d'autorisation (ceux-la passent par `asTenant`, role `signet_app`). Aucune
 * requete n'agrege une table entiere : toutes portent sur des identifiants crees
 * par le test (organisation, adresse unique, identifiant d'invitation).
 */
import { createHash, randomBytes } from "node:crypto";
import { asBypassRls } from "./db";

export interface InvitationRow {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  token_hash: Buffer;
  invited_by_user_id: string;
  created_at: Date;
  expires_at: Date;
  accepted_at: Date | null;
  accepted_by_user_id: string | null;
  /** `expires_at - created_at` calcule par la base, en secondes (7 jours = 604800). */
  lifetime_seconds: number;
}

const COLUMNS = `id, organization_id, email, role, token_hash, invited_by_user_id, created_at, expires_at,
  accepted_at, accepted_by_user_id, extract(epoch FROM (expires_at - created_at))::float8 AS lifetime_seconds`;

export const SEVEN_DAYS_SECONDS = 7 * 24 * 3600;

/** Invitations d'une organisation, eventuellement restreintes a une adresse. */
export async function readInvitations(organizationId: string, email?: string): Promise<InvitationRow[]> {
  return asBypassRls(async (client) => {
    const { rows } =
      email === undefined
        ? await client.query<InvitationRow>(
            `SELECT ${COLUMNS} FROM invitation WHERE organization_id = $1 ORDER BY created_at, id`,
            [organizationId],
          )
        : await client.query<InvitationRow>(
            `SELECT ${COLUMNS} FROM invitation WHERE organization_id = $1 AND email = $2 ORDER BY created_at, id`,
            [organizationId, email],
          );
    return rows;
  });
}

export async function readInvitationById(id: string): Promise<InvitationRow | undefined> {
  return asBypassRls(async (client) => {
    const { rows } = await client.query<InvitationRow>(`SELECT ${COLUMNS} FROM invitation WHERE id = $1`, [id]);
    return rows[0];
  });
}

/** La seule ligne attendue pour (organisation, adresse) ; echoue avec ce qui existe sinon. */
export async function readSingleInvitation(organizationId: string, email: string): Promise<InvitationRow> {
  const rows = await readInvitations(organizationId, email);
  const [first] = rows;
  if (rows.length !== 1 || !first) {
    throw new Error(
      `[invitations] une ligne invitation etait attendue pour (${organizationId}, ${email}), ${rows.length} trouvee(s) : ` +
        JSON.stringify(rows.map((r) => ({ id: r.id, created_at: r.created_at, expires_at: r.expires_at }))),
    );
  }
  return first;
}

export function sha256(value: string | Buffer): Buffer {
  return createHash("sha256").update(value).digest();
}

export function randomTokenHash(): Buffer {
  return randomBytes(32);
}

export interface DirectInvitation {
  organizationId: string;
  email: string;
  invitedByUserId: string;
  tokenHash?: Buffer;
  /** Intervalles SQL relatifs a now(), ex. `-8 days`. Defaut : creation maintenant, expiration par defaut (7 jours). */
  createdAtOffset?: string;
  expiresAtOffset?: string;
  accepted?: { byUserId: string };
}

/**
 * Arrangement : insere une invitation sous administration. Sert a construire un
 * etat de depart (invitation expiree, acceptee, appartenant a un autre tenant)
 * que l'API ne produit pas, jamais a verifier le comportement sous test.
 */
export async function insertInvitationDirect(input: DirectInvitation): Promise<InvitationRow> {
  return asBypassRls(async (client) => {
    const created = input.createdAtOffset ?? "0 seconds";
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO invitation (organization_id, email, token_hash, invited_by_user_id, created_at, expires_at, accepted_at, accepted_by_user_id)
       VALUES ($1, $2, $3, $4,
               now() + $5::interval,
               CASE WHEN $6::text IS NULL THEN now() + $5::interval + interval '7 days' ELSE now() + $6::text::interval END,
               CASE WHEN $7::uuid IS NULL THEN NULL ELSE now() END,
               $7::uuid)
       RETURNING id`,
      [
        input.organizationId,
        input.email,
        input.tokenHash ?? randomTokenHash(),
        input.invitedByUserId,
        created,
        input.expiresAtOffset ?? null,
        input.accepted?.byUserId ?? null,
      ],
    );
    const [inserted] = rows;
    if (!inserted) throw new Error("insertInvitationDirect : INSERT sans ligne retournee.");
    const row = await readInvitationById(inserted.id);
    if (!row) throw new Error(`insertInvitationDirect : ligne ${inserted.id} introuvable apres insertion.`);
    return row;
  });
}

/** Arrangement : rend une invitation expiree (dates forcees, contraintes de la table respectees). */
export async function expireInvitationDirect(id: string): Promise<void> {
  await asBypassRls(async (client) => {
    const result = await client.query(
      "UPDATE invitation SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = $1",
      [id],
    );
    if (result.rowCount !== 1) throw new Error(`expireInvitationDirect : ${result.rowCount} ligne(s) modifiee(s) pour ${id}.`);
  });
}

/** Representations textuelles de chaque colonne d'une ligne (AC3 : le jeton n'est dans aucune). */
export function columnTexts(row: InvitationRow): string[] {
  const texts: string[] = [];
  for (const value of Object.values(row)) {
    if (Buffer.isBuffer(value)) {
      texts.push(value.toString("hex"), value.toString("base64"), value.toString("base64url"), value.toString("utf8"));
    } else if (value instanceof Date) {
      texts.push(value.toISOString());
    } else {
      texts.push(String(value));
    }
  }
  return texts;
}
