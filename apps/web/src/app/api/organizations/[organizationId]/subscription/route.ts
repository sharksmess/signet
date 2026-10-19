import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { changeTier as changeTierContract, getSubscription as getSubscriptionContract } from "@/lib/billing/contracts";
import { changeTier, getSubscription } from "@/lib/billing/subscriptions";
import { unauthenticated, validationFailed, type ApiError } from "@/lib/errors";

/**
 * Forme canonique (minuscules) de l'UUID valide par le contrat, qui accepte les
 * majuscules. L'identifiant part chez Stripe (metadonnees) et revient dans les
 * evenements : une seule ecriture possible (audit-002 CRITIQUE-1, D-071).
 */
function canonical(uuid: string): string {
  return uuid.toLowerCase();
}

function errorResponse(error: ApiError): NextResponse {
  return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
}

/** US-08.1 : consultation du palier, owner uniquement (US-08.2). Aucun appel Stripe. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return errorResponse(unauthenticated());

  const parsed = getSubscriptionContract.input.safeParse(await params);
  if (!parsed.success) return errorResponse(validationFailed(parsed.error.message));

  const result = await getSubscription({ userId: session.user.id, organizationId: canonical(parsed.data.organizationId) });
  if (!result.ok) return errorResponse(result.error);
  return NextResponse.json(result.value, { status: 200 });
}

/** US-08.1 : demande de changement de palier (ADR-0005 : l'etat change au webhook, pas ici). */
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
  // `organizationId` du chemin fait autorite : le corps ne peut pas le contredire.
  const parsed = changeTierContract.input.safeParse({ ...body, organizationId });
  if (!parsed.success) return errorResponse(validationFailed(parsed.error.message));

  const result = await changeTier({
    userId: session.user.id,
    organizationId: canonical(parsed.data.organizationId),
    tier: parsed.data.tier,
  });
  if (!result.ok) return errorResponse(result.error);
  return NextResponse.json(result.value, { status: 200 });
}
