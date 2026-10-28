import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { unauthenticated, validationFailed, type ApiError } from "@/lib/errors";
import { listMembers as listMembersContract } from "@/lib/members/contracts";
import { listMembers } from "@/lib/members/members";

/**
 * US-07.1 (partiel) : liste des membres d'une organisation par un membre,
 * owner ou member (tranche 013, contrat `members.ts` `listMembers`, D-138
 * point 3).
 *
 * Ordre : session -> validation du chemin (contrat) -> lecture
 * (`lib/members/members.ts` : appartenance, puis SELECT
 * `member.created_at ASC, user_id ASC`). `200` avec la liste, qui contient
 * toujours l'appelant. Chaine de requete ignoree (aucun parametre au contrat).
 * Aucune ecriture.
 *
 * Message de 422 fixe : ni la valeur soumise, ni le message de Zod
 * (D-114 point 4).
 */

const INVALID_ORGANIZATION_ID = "Identifiant d'organisation invalide.";
/** Repli (patron review-005 SUGGESTION 2) : refus du schema hors du chemin connu. */
const INVALID_REQUEST = "Requete invalide.";

function errorResponse(error: ApiError): NextResponse {
  return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
}

/** Forme canonique (minuscules) de l'UUID valide par le contrat, qui accepte les majuscules. */
function canonical(uuid: string): string {
  return uuid.toLowerCase();
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return errorResponse(unauthenticated());

  const { organizationId } = await params;
  const parsed = listMembersContract.input.safeParse({ organizationId });
  if (!parsed.success) {
    const pathIsInvalid = parsed.error.issues.some((issue) => issue.path[0] === "organizationId");
    return errorResponse(validationFailed(pathIsInvalid ? INVALID_ORGANIZATION_ID : INVALID_REQUEST));
  }

  const result = await listMembers({
    userId: session.user.id,
    organizationId: canonical(parsed.data.organizationId),
  });
  if (!result.ok) return errorResponse(result.error);
  return NextResponse.json(result.value, { status: 200 });
}
