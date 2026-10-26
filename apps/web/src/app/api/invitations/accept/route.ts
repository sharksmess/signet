import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { unauthenticated, validationFailed, type ApiError } from "@/lib/errors";
import { acceptInvitation } from "@/lib/invitations/accept";
import { acceptInvitation as acceptInvitationContract } from "@/lib/invitations/contracts";

/**
 * US-03.1 : acceptation d'une invitation par l'invite connecte (tranche 006,
 * D-102, ADR-0018). POST seul ; aucun segment dynamique : le jeton n'arrive
 * que dans le corps (ADR-0003), jamais dans le chemin ni la query string, qui
 * n'est pas lue.
 *
 * Ordre : session -> validation (contrat `invitations.ts`, `acceptInvitation`)
 * -> acceptation (`lib/invitations/accept.ts` : decodage strict, empreinte,
 * `accept_invitation`, puis `lookup_invitation` si rien n'est consomme).
 *
 * Le jeton n'est ni journalise, ni renvoye : les messages d'erreur sont fixes
 * et la validation ne reprend jamais l'entree.
 */

const INVALID_BODY = "Corps JSON attendu, avec un champ token textuel de 256 caracteres au plus.";

function errorResponse(error: ApiError): NextResponse {
  return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return errorResponse(unauthenticated());

  const body: unknown = await request.json().catch(() => undefined);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return errorResponse(validationFailed(INVALID_BODY));
  }
  // Tout autre champ du corps (password compris, retire du contrat) est ignore.
  const parsed = acceptInvitationContract.input.safeParse(body);
  if (!parsed.success) return errorResponse(validationFailed(INVALID_BODY));

  const result = await acceptInvitation({
    userId: session.user.id,
    sessionEmail: session.user.email,
    token: parsed.data.token,
  });
  if (!result.ok) return errorResponse(result.error);
  return NextResponse.json({ organizationId: result.value.organizationId, role: result.value.role }, { status: 200 });
}
