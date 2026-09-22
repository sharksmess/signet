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

export async function createOrganization(
  session: AuthenticatedSession | null,
  payload: Record<string, unknown>,
): Promise<ApiResponse> {
  const response = await fetch(`${baseUrl()}/api/organizations`, {
    method: "POST",
    headers: session ? authHeaders(session) : { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => undefined);
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
  const body = await response.json().catch(() => undefined);
  return { status: response.status, body };
}
