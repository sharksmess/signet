import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createOrganization as createOrganizationContract } from "@/lib/contracts";
import { createOrganization, listMyOrganizations } from "@/lib/organizations";
import { unauthenticated, validationFailed } from "@/lib/errors";

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    const error = unauthenticated();
    return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  }

  const body: unknown = await request.json().catch(() => undefined);
  const parsed = createOrganizationContract.input.safeParse(body);
  if (!parsed.success) {
    const error = validationFailed(parsed.error.message);
    return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  }

  const result = await createOrganization(session.user.id, parsed.data.name);
  if (!result.ok) {
    return NextResponse.json(
      { code: result.error.code, message: result.error.message },
      { status: result.error.status },
    );
  }

  return NextResponse.json(result.value, { status: 201 });
}

/**
 * US-01 : liste des organisations dont l'utilisateur de session est membre
 * (tranche 013, contrat `listMyOrganizations`, D-138 points 1 et 2).
 *
 * Ordre : session -> lecture (`lib/organizations.ts` :
 * `signet.organizations_for_user` de l'utilisateur de session,
 * `created_at DESC, id DESC`). `200` avec la liste, `[]` si aucune.
 * Le contrat n'a aucune entree (`input: z.object({})`) : la route ne lit ni
 * chaine de requete ni corps, l'utilisateur lu est toujours celui de la
 * session. Aucune ecriture.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    const error = unauthenticated();
    return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
  }

  const result = await listMyOrganizations(session.user.id);
  if (!result.ok) {
    return NextResponse.json(
      { code: result.error.code, message: result.error.message },
      { status: result.error.status },
    );
  }

  return NextResponse.json(result.value, { status: 200 });
}
