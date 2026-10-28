/**
 * Liste des membres d'une organisation (US-07.1 partiel ; tranche 013, D-138
 * point 3).
 *
 * Arguments supposes deja valides par le contrat (`./contracts`) : UUID
 * d'organisation en forme canonique. Lecture seule, dans UNE transaction sous
 * `signet_app`, contexte de l'appelant pose par `withTenant` (RLS en seconde
 * barriere, ADR-0011) :
 *
 * 1. appartenance, filtre explicite sur `organization_id` ET `user_id` :
 *    non-membre ou organisation inexistante -> 404 identique (US-09.2) ; owner
 *    et member sont acceptes ;
 * 2. `SELECT` des membres avec `organization_id` explicite, joint a `app_user`
 *    pour l'adresse, par date d'arrivee croissante puis `user_id` croissant.
 *    Aucune invitation lue, aucune pagination (D-138 points 3 et 4).
 *
 * Valeurs rendues telles qu'enregistrees, reponse construite champ par champ.
 * Toute erreur de la base est inattendue : `withTenant` annule la transaction,
 * l'erreur est journalisee par son seul code (jamais un identifiant ni une
 * adresse) puis relevee sans detail (500 generique, patron D-133 point 3).
 */
import { withTenant } from "../db";
import { fail, ok, organizationNotFound, type Result } from "../errors";

/** Element de `listMembers.output` : exactement ces champs (tranche 013, AC5). */
export interface MemberListItem {
  userId: string;
  email: string;
  role: "owner" | "member";
}

interface MemberListRow {
  user_id: string;
  email: string;
  role: string;
}

function roleOf(value: string): MemberListItem["role"] {
  if (value === "owner" || value === "member") return value;
  // La contrainte de la colonne `member.role` n'admet que ces deux valeurs (ERD §4).
  throw new Error("member.role : valeur hors du domaine owner/member");
}

export async function listMembers(params: {
  userId: string;
  /** Forme canonique (minuscules). */
  organizationId: string;
}): Promise<Result<MemberListItem[]>> {
  try {
    return await readMembers(params);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    console.error(`[members] lecture : erreur inattendue de la base (code ${typeof code === "string" ? code : "absent"})`);
    throw new Error("lecture des membres : erreur inattendue");
  }
}

async function readMembers(params: {
  userId: string;
  organizationId: string;
}): Promise<Result<MemberListItem[]>> {
  const { userId, organizationId } = params;

  return withTenant({ userId, organizationId }, async (client) => {
    const membership = await client.query(
      `SELECT 1
         FROM member m
        WHERE m.organization_id = $1 AND m.user_id = $2`,
      [organizationId, userId],
    );
    if ((membership.rowCount ?? 0) === 0) return fail(organizationNotFound());

    const result = await client.query<MemberListRow>(
      `SELECT m.user_id, u.email, m.role
         FROM member m
         JOIN app_user u ON u.id = m.user_id
        WHERE m.organization_id = $1
        ORDER BY m.created_at ASC, m.user_id ASC`,
      [organizationId],
    );

    return ok(
      result.rows.map((row) => ({
        userId: row.user_id,
        email: row.email,
        role: roleOf(row.role),
      })),
    );
  });
}
