import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createCollection, listCollections } from "@/lib/collections/collections";
import {
  createCollection as createCollectionContract,
  listCollections as listCollectionsContract,
} from "@/lib/collections/contracts";
import { unauthenticated, validationFailed, type ApiError } from "@/lib/errors";

/**
 * US-05.1 : creation d'une collection par un membre, owner ou member
 * (tranche 004, contrat `collections.ts` `createCollection`).
 *
 * Ordre : session -> validation (contrat ; le `organizationId` du chemin fait
 * autorite, tout autre champ du corps est ignore) -> creation
 * (`lib/collections/collections.ts` : appartenance, puis INSERT ; l'unicite du
 * nom est decidee par l'index, 409 sinon). `201` avec la collection creee.
 *
 * US-07.1, US-07.2 : liste des collections par un membre, owner ou member
 * (tranche 009, contrat `listCollections`). Ordre : session -> validation du
 * chemin (contrat) -> lecture (`lib/collections/collections.ts` :
 * appartenance, puis SELECT `created_at DESC, id DESC`). `200` avec la liste,
 * `[]` si aucune. Chaine de requete ignoree (aucun parametre au contrat).
 * Aucune ecriture.
 *
 * Messages de 422 fixes : ni la valeur soumise, ni le message de Zod
 * (D-114 point 4).
 */

const BODY_EXPECTED = "Corps JSON attendu.";
const INVALID_ORGANIZATION_ID = "Identifiant d'organisation invalide.";
const INVALID_NAME = "Nom de collection invalide : 1 a 100 caracteres, espaces de bord exclus.";
/** Repli de la lecture (patron review-005 SUGGESTION 2) : refus du schema hors du chemin connu. */
const INVALID_REQUEST = "Requete invalide.";

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
    return errorResponse(validationFailed(BODY_EXPECTED));
  }
  const parsed = createCollectionContract.input.safeParse({ ...body, organizationId });
  if (!parsed.success) {
    const pathIsInvalid = parsed.error.issues.some((issue) => issue.path[0] === "organizationId");
    return errorResponse(validationFailed(pathIsInvalid ? INVALID_ORGANIZATION_ID : INVALID_NAME));
  }

  const result = await createCollection({
    userId: session.user.id,
    organizationId: canonical(parsed.data.organizationId),
    name: parsed.data.name,
  });
  if (!result.ok) return errorResponse(result.error);
  return NextResponse.json(result.value, { status: 201 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return errorResponse(unauthenticated());

  const { organizationId } = await params;
  const parsed = listCollectionsContract.input.safeParse({ organizationId });
  if (!parsed.success) {
    const pathIsInvalid = parsed.error.issues.some((issue) => issue.path[0] === "organizationId");
    return errorResponse(validationFailed(pathIsInvalid ? INVALID_ORGANIZATION_ID : INVALID_REQUEST));
  }

  const result = await listCollections({
    userId: session.user.id,
    organizationId: canonical(parsed.data.organizationId),
  });
  if (!result.ok) return errorResponse(result.error);
  return NextResponse.json(result.value, { status: 200 });
}
