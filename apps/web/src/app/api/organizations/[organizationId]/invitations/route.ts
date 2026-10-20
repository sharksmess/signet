import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { unauthenticated, validationFailed, type ApiError } from "@/lib/errors";
import { createInvitation as createInvitationContract, normalizedEmail } from "@/lib/invitations/contracts";
import { createInvitation } from "@/lib/invitations/invitations";

/**
 * US-02.1 : emission d'une invitation par l'owner (tranche 003, ADR-0017).
 *
 * Ordre : session -> validation (contrat `invitations.ts`, e-mail normalise) ->
 * emission (`lib/invitations/invitations.ts` : appartenance et role, adresse
 * deja membre, `create_invitation`, mise en file avant le COMMIT). `201`
 * signifie « invitation persistee et envoi mis en file », jamais « e-mail
 * remis » (ADR-0006). Le jeton n'apparait jamais dans la reponse.
 */

function errorResponse(error: ApiError): NextResponse {
  return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
}

/** Forme canonique (minuscules) de l'UUID valide par le contrat, qui accepte les majuscules. */
function canonical(uuid: string): string {
  return uuid.toLowerCase();
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return errorResponse(unauthenticated());

  const { organizationId } = await params;
  const body: unknown = await request.json().catch(() => undefined);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return errorResponse(validationFailed("Corps JSON attendu."));
  }
  // `organizationId` du chemin fait autorite ; tout autre champ du corps
  // (expiresAt, role, invitedByUserId...) est ignore par le contrat.
  const parsed = createInvitationContract.input.safeParse({ ...body, organizationId });
  if (!parsed.success) return errorResponse(validationFailed(parsed.error.message));
  const email = normalizedEmail.safeParse(parsed.data.email);
  if (!email.success) return errorResponse(validationFailed("Adresse e-mail invalide."));

  const result = await createInvitation({
    userId: session.user.id,
    organizationId: canonical(parsed.data.organizationId),
    email: email.data,
  });
  if (!result.ok) return errorResponse(result.error);
  return NextResponse.json(result.value, { status: 201 });
}
