import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { unauthenticated, validationFailed, type ApiError } from "@/lib/errors";
import { addLink as addLinkContract, listLinks as listLinksContract } from "@/lib/links/contracts";
import { addLink, listLinks } from "@/lib/links/links";

/**
 * US-06 : ajout d'un lien a une collection par un membre, owner ou member
 * (tranche 005, contrat `links.ts` `addLink`, resserre par D-120).
 *
 * Ordre : session -> validation (contrat ; `organizationId` et `collectionId`
 * du chemin font autorite, tout autre champ du corps est ignore : auteur et
 * date sont poses par le serveur) -> ajout (`lib/links/links.ts` :
 * appartenance, puis une seule instruction INSERT ... SELECT ; le quota est
 * decide par la base, 409 sinon). `201` avec le lien cree.
 *
 * Messages de 422 fixes : ni la valeur soumise, ni le message de Zod
 * (precedent D-114 point 4). Premier champ fautif dans l'ordre : chemin
 * (organisation, collection), puis `url`, puis `title`.
 *
 * US-07.1, US-07.2 : liste des liens d'une collection par un membre, owner ou
 * member (tranche 009, contrat `listLinks`). Ordre : session -> validation du
 * chemin (contrat, meme ordre des messages) -> lecture (`lib/links/links.ts` :
 * appartenance, collection de l'organisation du chemin, puis SELECT
 * `created_at DESC, id DESC`). `200` avec la liste, `[]` si aucun lien. Chaine
 * de requete ignoree (aucun parametre au contrat). Aucune ecriture.
 */

const BODY_EXPECTED = "Corps JSON attendu.";
const INVALID_ORGANIZATION_ID = "Identifiant d'organisation invalide.";
const INVALID_COLLECTION_ID = "Identifiant de collection invalide.";
const INVALID_URL =
  "URL invalide : schema http ou https en minuscules, nom d'hote obligatoire, sans identifiants, espaces ni caracteres de controle, 8 a 2048 caracteres.";
const INVALID_TITLE = "Titre invalide : 1 a 200 caracteres, espaces de bord exclus, sans caractere nul.";
/**
 * Repli (review-005 SUGGESTION 2) : un refus du schema sur un champ hors de
 * la liste ci-dessous (champ ajoute un jour au contrat, regle d'objet entier)
 * reste une erreur de l'appelant, donc un 422 au message neutre, jamais un
 * message qui accuserait un autre champ ni un 500.
 */
const INVALID_REQUEST = "Requete invalide.";

/** Ordre d'evaluation des champs fautifs : le message est celui du premier. */
const FIELD_MESSAGES: ReadonlyArray<readonly [string, string]> = [
  ["organizationId", INVALID_ORGANIZATION_ID],
  ["collectionId", INVALID_COLLECTION_ID],
  ["url", INVALID_URL],
  ["title", INVALID_TITLE],
];

function errorResponse(error: ApiError): NextResponse {
  return NextResponse.json({ code: error.code, message: error.message }, { status: error.status });
}

/** Forme canonique (minuscules) de l'UUID valide par le contrat, qui accepte les majuscules. */
function canonical(uuid: string): string {
  return uuid.toLowerCase();
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; collectionId: string }> },
): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return errorResponse(unauthenticated());

  const { organizationId, collectionId } = await params;
  const body: unknown = await request.json().catch(() => undefined);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return errorResponse(validationFailed(BODY_EXPECTED));
  }
  const parsed = addLinkContract.input.safeParse({ ...body, organizationId, collectionId });
  if (!parsed.success) {
    const faulty = new Set(parsed.error.issues.map((issue) => issue.path[0]));
    const [, message] = FIELD_MESSAGES.find(([field]) => faulty.has(field)) ?? ["", INVALID_REQUEST];
    return errorResponse(validationFailed(message));
  }
  const result = await addLink({
    userId: session.user.id,
    organizationId: canonical(parsed.data.organizationId),
    collectionId: canonical(parsed.data.collectionId),
    url: parsed.data.url,
    title: parsed.data.title,
  });
  if (!result.ok) return errorResponse(result.error);
  return NextResponse.json(result.value, { status: 201 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; collectionId: string }> },
): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return errorResponse(unauthenticated());

  const { organizationId, collectionId } = await params;
  const parsed = listLinksContract.input.safeParse({ organizationId, collectionId });
  if (!parsed.success) {
    const faulty = new Set(parsed.error.issues.map((issue) => issue.path[0]));
    const [, message] = FIELD_MESSAGES.find(([field]) => faulty.has(field)) ?? ["", INVALID_REQUEST];
    return errorResponse(validationFailed(message));
  }

  const result = await listLinks({
    userId: session.user.id,
    organizationId: canonical(parsed.data.organizationId),
    collectionId: canonical(parsed.data.collectionId),
  });
  if (!result.ok) return errorResponse(result.error);
  return NextResponse.json(result.value, { status: 200 });
}
