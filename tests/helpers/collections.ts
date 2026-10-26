/**
 * Helpers de la tranche 004 (creation d'une collection) : client HTTP de la
 * route, arrangements et lectures de verification en base.
 *
 * Messages d'echec : tout helper qui attend un statut HTTP affiche le VRAI code
 * recu et le corps BRUT complet (texte d'abord, JSON ensuite), voir
 * `expectStatus` / `expectError` de ./billing.
 *
 * Les lectures sous la connexion d'administration (BYPASSRLS) ne servent qu'a
 * verifier l'etat apres une action HTTP ; aucune ne compte une table entiere :
 * toutes sont filtrees par l'identifiant de l'organisation creee par le test.
 * Les assertions d'isolation passent par `asTenant` (role `signet_app`).
 */
import { authHeaders, baseUrl, signUp, type AuthenticatedSession } from "./auth";
import { readResponse, type HttpResult } from "./billing";
import { asBypassRls } from "./db";
import { addMemberDirect } from "./fixtures";

export function collectionsUrl(organizationId: string): string {
  return `${baseUrl()}/api/organizations/${organizationId}/collections`;
}

/** `payload` est serialise en JSON ; une chaine est envoyee telle quelle (corps non JSON). */
export async function postCollection(
  session: AuthenticatedSession | null,
  organizationId: string,
  payload: unknown,
): Promise<HttpResult> {
  const response = await fetch(collectionsUrl(organizationId), {
    method: "POST",
    headers: session ? authHeaders(session) : { "Content-Type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  return readResponse(response);
}

/** Meme requete avec un cookie de session invalide (AC7). */
export async function postCollectionWithCookie(organizationId: string, cookie: string, payload: unknown): Promise<HttpResult> {
  const response = await fetch(collectionsUrl(organizationId), {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json", Origin: baseUrl() },
    body: JSON.stringify(payload),
  });
  return readResponse(response);
}

/** Un utilisateur reel, membre (role `member`) de l'organisation, ajoute par une ligne forcee en base. */
export async function createMemberSession(organizationId: string): Promise<AuthenticatedSession> {
  const session = await signUp();
  await addMemberDirect({ organizationId, userId: session.userId, role: "member" });
  return session;
}

export interface CollectionRow {
  id: string;
  organization_id: string;
  name: string;
  created_by_user_id: string;
  created_at: Date;
}

/** Collections d'une organisation (toutes, ou celles dont le nom, casse et bords ignores, est `name`). */
export async function readCollections(organizationId: string, name?: string): Promise<CollectionRow[]> {
  return asBypassRls(async (client) => {
    const { rows } =
      name === undefined
        ? await client.query<CollectionRow>(
            "SELECT id, organization_id, name, created_by_user_id, created_at FROM collection WHERE organization_id = $1 ORDER BY created_at, id",
            [organizationId],
          )
        : await client.query<CollectionRow>(
            "SELECT id, organization_id, name, created_by_user_id, created_at FROM collection WHERE organization_id = $1 AND lower(btrim(name)) = lower(btrim($2::text)) ORDER BY created_at, id",
            [organizationId, name],
          );
    return rows;
  });
}

export async function readCollectionById(id: string): Promise<CollectionRow | undefined> {
  return asBypassRls(async (client) => {
    const { rows } = await client.query<CollectionRow>(
      "SELECT id, organization_id, name, created_by_user_id, created_at FROM collection WHERE id = $1",
      [id],
    );
    return rows[0];
  });
}

/** Arrangement : insere une collection sous administration (jamais pour verifier un comportement). */
export async function insertCollectionDirect(input: { organizationId: string; name: string; createdByUserId: string }): Promise<CollectionRow> {
  return asBypassRls(async (client) => {
    const { rows } = await client.query<CollectionRow>(
      `INSERT INTO collection (organization_id, name, created_by_user_id) VALUES ($1, $2, $3)
       RETURNING id, organization_id, name, created_by_user_id, created_at`,
      [input.organizationId, input.name, input.createdByUserId],
    );
    const [row] = rows;
    if (!row) throw new Error("insertCollectionDirect : INSERT sans ligne retournee.");
    return row;
  });
}

/** Chaine de `length` caracteres (UTF-16 = points de code ici : ASCII seulement). */
export function nameOfLength(length: number, filler = "a"): string {
  return filler.repeat(length);
}

/** Nom unique par test (les noms sont uniques par organisation, mais les organisations changent a chaque test). */
let counter = 0;
export function uniqueCollectionName(prefix = "Veille"): string {
  counter += 1;
  return `${prefix} ${Date.now()}-${counter}`;
}
