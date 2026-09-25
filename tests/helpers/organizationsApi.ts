/**
 * Client HTTP fin pour la capacite "organizations", au plus pres du contrat
 * `docs/02-architecture/api-contracts/organizations.ts` (source de verite,
 * lecture seule). Les tests appellent ces fonctions plutot que de reconstruire
 * des `fetch` bruts partout : une seule source de verite sur la forme des
 * requetes, l'autre moitie de la source de verite (la forme des reponses)
 * restant validee par les schemas Zod importes directement du contrat.
 */
import type { AuthenticatedSession } from "./auth";
import { authHeaders } from "./auth";

function baseUrl(): string {
  const url = process.env.TEST_APP_BASE_URL;
  if (!url) {
    throw new Error("TEST_APP_BASE_URL n'est pas definie (voir tests/helpers/db.ts).");
  }
  return url;
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

/**
 * Lit le corps de la reponse sans jamais le faire disparaitre silencieusement.
 * `response.json().catch(() => undefined)` transformait toute reponse non-JSON
 * (page d'erreur HTML, corps vide, texte brut) en `undefined` — un message de
 * diagnostic qui affiche "undefined" au lieu du corps reel fait perdre plus de
 * temps que l'echec lui-meme (cf. createOrganizationFixture). Ici : corps vide
 * -> `undefined` (rien a montrer, cas normal) ; JSON valide -> objet parse
 * (comportement inchange pour le cas nominal) ; sinon -> texte brut, pour que
 * l'appelant voie exactement ce que le serveur a renvoye.
 */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function createOrganization(
  session: AuthenticatedSession | null,
  payload: Record<string, unknown>,
): Promise<ApiResponse> {
  const response = await fetch(`${baseUrl()}/api/organizations`, {
    method: "POST",
    headers: session ? authHeaders(session) : { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readBody(response);
  return { status: response.status, body };
}

export async function renameOrganization(
  session: AuthenticatedSession | null,
  organizationId: string,
  payload: Record<string, unknown>,
): Promise<ApiResponse> {
  const response = await fetch(`${baseUrl()}/api/organizations/${organizationId}`, {
    method: "PATCH",
    headers: session ? authHeaders(session) : { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readBody(response);
  return { status: response.status, body };
}
