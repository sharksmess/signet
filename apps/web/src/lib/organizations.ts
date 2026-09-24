/**
 * Logique metier "organizations" (US-01, docs/03-slices/001-creation-organisation.md).
 * Chaque fonction suppose ses arguments deja valides par le schema Zod du
 * contrat (apps/web/src/lib/contracts.ts, applique par le Route Handler) :
 * elle ne verifie que les invariants qui dependent de l'etat en base
 * (appartenance, role — ADR-0004), jamais la forme de l'entree.
 */
import { withTenant, withUserOnly } from "./db";
import { fail, ok, organizationNotFound, insufficientRole, type Result } from "./errors";

export interface CreatedOrganization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  role: "owner";
}

/**
 * Delegue integralement a `signet.create_organization()` (SECURITY DEFINER,
 * ADR-0007) : c'est l'unique chemin qui cree une organisation, son
 * membership owner, son compteur de quota et son abonnement Free dans la
 * meme transaction (ERD §3). Aucune logique de slug ni de retry ici : la
 * fonction SQL les porte deja (collision resolue par suffixe deterministe).
 */
export async function createOrganization(
  userId: string,
  name: string,
): Promise<Result<CreatedOrganization>> {
  const row = await withUserOnly(userId, async (client) => {
    const result = await client.query<{
      id: string;
      name: string;
      slug: string;
      created_at: string;
    }>("SELECT * FROM signet.create_organization($1, $2)", [userId, name]);
    return result.rows[0];
  });

  if (!row) {
    throw new Error("signet.create_organization : aucune ligne retournee");
  }

  return ok({
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: new Date(row.created_at).toISOString(),
    role: "owner",
  });
}

export interface RenamedOrganization {
  id: string;
  name: string;
}

export async function renameOrganization(params: {
  userId: string;
  organizationId: string;
  name: string;
}): Promise<Result<RenamedOrganization>> {
  return withTenant(
    { userId: params.userId, organizationId: params.organizationId },
    async (client) => {
      const membership = await client.query<{ role: string }>(
        "SELECT role FROM member WHERE organization_id = $1 AND user_id = $2",
        [params.organizationId, params.userId],
      );
      const role = membership.rows[0]?.role;

      // US-09.2 : organisation inexistante et organisation d'un autre
      // tenant traversent toutes les deux ce meme "aucune ligne member"
      // (la RLS rend la ligne invisible dans le second cas) — 404 dans les
      // deux cas, jamais 403, pour ne rien reveler de plus a l'appelant.
      if (!role) {
        return fail(organizationNotFound());
      }
      if (role !== "owner") {
        return fail(insufficientRole());
      }

      const updated = await client.query<{ id: string; name: string }>(
        "UPDATE organization SET name = $1, updated_at = now() WHERE id = $2 RETURNING id, name",
        [params.name, params.organizationId],
      );
      const row = updated.rows[0];
      if (!row) {
        return fail(organizationNotFound());
      }
      return ok({ id: row.id, name: row.name });
    },
  );
}
