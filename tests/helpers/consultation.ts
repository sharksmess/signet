/**
 * Helpers de la tranche 009 (consultation des collections et des liens) :
 * clients HTTP des deux routes GET, insertions a horodatage egal (une seule
 * transaction, donc un seul `now()`), et photographie des tables pour prouver
 * qu'une lecture n'ecrit rien.
 *
 * Messages d'echec : tout helper qui attend un statut HTTP affiche le VRAI code
 * recu et le corps BRUT complet (voir `expectStatus` / `expectError` de
 * ./billing, qui lisent le corps en texte puis tentent le JSON).
 *
 * Les lectures et insertions sous la connexion d'administration (BYPASSRLS)
 * servent a l'arrangement et a la verification apres coup ; toutes sont
 * filtrees par des identifiants crees par le test, jamais par une table entiere.
 */
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { authHeaders, baseUrl, type AuthenticatedSession } from "./auth";
import { expectStatus, readResponse, type HttpResult } from "./billing";
import { collectionsUrl, type CollectionRow } from "./collections";
import { asBypassRls } from "./db";
import { linksUrl, type LinkRow } from "./links";

// ---------------------------------------------------------------------------
// Client HTTP
// ---------------------------------------------------------------------------

/** `session` null : aucune session. `query` : chaine de requete avec son `?` (ex. `?sort=asc`). */
export async function getCollections(session: AuthenticatedSession | null, organizationId: string, query = ""): Promise<HttpResult> {
  const response = await fetch(`${collectionsUrl(organizationId)}${query}`, {
    method: "GET",
    headers: session ? authHeaders(session) : {},
  });
  return readResponse(response);
}

export async function getLinks(
  session: AuthenticatedSession | null,
  organizationId: string,
  collectionId: string,
  query = "",
): Promise<HttpResult> {
  const response = await fetch(`${linksUrl(organizationId, collectionId)}${query}`, {
    method: "GET",
    headers: session ? authHeaders(session) : {},
  });
  return readResponse(response);
}

/** Lecture des collections avec un cookie de session invalide. */
export async function getCollectionsWithCookie(organizationId: string, cookie: string): Promise<HttpResult> {
  const response = await fetch(collectionsUrl(organizationId), {
    method: "GET",
    headers: { Cookie: cookie, Origin: baseUrl() },
  });
  return readResponse(response);
}

/** Lecture des liens avec un cookie de session invalide. */
export async function getLinksWithCookie(organizationId: string, collectionId: string, cookie: string): Promise<HttpResult> {
  const response = await fetch(linksUrl(organizationId, collectionId), {
    method: "GET",
    headers: { Cookie: cookie, Origin: baseUrl() },
  });
  return readResponse(response);
}

/** Exige un `200` et un corps JSON qui est un tableau ; rend ce tableau. Echoue avec le corps brut sinon. */
export function expectList(result: HttpResult, label: string): unknown[] {
  expectStatus(result, 200, label);
  if (!Array.isArray(result.body)) {
    throw new Error(`${label} : HTTP 200 mais le corps n'est pas un tableau JSON. Corps brut : ${result.text}`);
  }
  return result.body as unknown[];
}

/** Les cles de chaque element sont EXACTEMENT `keys` (ni plus, ni moins). */
export function expectExactKeys(items: readonly unknown[], keys: readonly string[], label: string): void {
  const expected = [...keys].sort();
  for (const [index, item] of items.entries()) {
    const actual = typeof item === "object" && item !== null ? Object.keys(item).sort() : [`<${typeof item}>`];
    expect(actual, `${label} : cles de l'element ${index}`).toEqual(expected);
  }
}

/** Identifiants, dans l'ordre rendu. */
export function idsOf(items: readonly unknown[]): string[] {
  return items.map((item, index) => {
    const id = typeof item === "object" && item !== null && "id" in item ? item.id : undefined;
    if (typeof id !== "string") throw new Error(`idsOf : l'element ${index} n'a pas d'identifiant texte : ${JSON.stringify(item)}`);
    return id;
  });
}

/** Ordre attendu a horodatage egal : identifiants decroissants (UUID en minuscules, comparaison octet a octet). */
export function sortedDescending(ids: readonly string[]): string[] {
  return [...ids].sort().reverse();
}

// ---------------------------------------------------------------------------
// Insertions a horodatage egal (administration, une seule transaction)
// ---------------------------------------------------------------------------

/** Ordre d'insertion volontairement ni croissant ni decroissant en identifiant (indices 0 a 5). */
const INSERTION_PERMUTATION = [2, 5, 0, 4, 1, 3] as const;
export const TIED_COUNT = INSERTION_PERMUTATION.length;

/** Six identifiants distincts, visiblement fabriques : prefixe aleatoire, suffixe 1 a 6 (ordre connu). */
function orderedIds(): string[] {
  const prefix = randomUUID().slice(0, 24);
  return INSERTION_PERMUTATION.map((_, index) => `${prefix}${String(index + 1).padStart(12, "0")}`);
}

export interface TiedInsertion<Row> {
  /** Identifiants dans l'ordre d'INSERTION. */
  insertionOrder: string[];
  /** Lignes relues apres validation. */
  rows: Row[];
}

/** Six collections inserees dans une meme transaction (meme `now()`), ordre d'insertion different de l'ordre des ids. */
export async function insertTiedCollections(input: { organizationId: string; userId: string }): Promise<TiedInsertion<CollectionRow>> {
  const ids = orderedIds();
  const insertionOrder = INSERTION_PERMUTATION.map((position) => ids[position] ?? "");
  const rows = await asBypassRls(async (client) => {
    await client.query("BEGIN");
    try {
      for (const [index, id] of insertionOrder.entries()) {
        await client.query(
          "INSERT INTO collection (id, organization_id, name, created_by_user_id) VALUES ($1, $2, $3, $4)",
          [id, input.organizationId, `Collection simultanee ${index}`, input.userId],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    const { rows: read } = await client.query<CollectionRow>(
      "SELECT id, organization_id, name, created_by_user_id, created_at FROM collection WHERE organization_id = $1 AND id = ANY($2::uuid[]) ORDER BY id",
      [input.organizationId, insertionOrder],
    );
    return read;
  });
  return { insertionOrder, rows };
}

/** Six liens inseres dans une meme transaction (meme `now()`), ordre d'insertion different de l'ordre des ids. */
export async function insertTiedLinks(input: {
  organizationId: string;
  collectionId: string;
  userId: string;
}): Promise<TiedInsertion<LinkRow>> {
  const ids = orderedIds();
  const insertionOrder = INSERTION_PERMUTATION.map((position) => ids[position] ?? "");
  const rows = await asBypassRls(async (client) => {
    await client.query("BEGIN");
    try {
      for (const [index, id] of insertionOrder.entries()) {
        await client.query(
          "INSERT INTO link (id, organization_id, collection_id, url, title, added_by_user_id) VALUES ($1, $2, $3, $4, $5, $6)",
          [id, input.organizationId, input.collectionId, `https://exemple.invalid/simultane/${index}`, `Lien simultane ${index}`, input.userId],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    const { rows: read } = await client.query<LinkRow>(
      "SELECT id, organization_id, collection_id, url, title, added_by_user_id, created_at FROM link WHERE organization_id = $1 AND id = ANY($2::uuid[]) ORDER BY id",
      [input.organizationId, insertionOrder],
    );
    return read;
  });
  return { insertionOrder, rows };
}

/** Precondition d'AC2 : toutes les lignes ont le meme `created_at`, et l'ordre d'insertion n'est ni l'ordre des ids ni son inverse. */
export function expectTiedPrecondition(inserted: TiedInsertion<{ created_at: Date }>, label: string): void {
  expect(inserted.rows, `${label} : toutes les lignes ont ete relues`).toHaveLength(TIED_COUNT);
  const instants = new Set(inserted.rows.map((row) => row.created_at.getTime()));
  expect(instants.size, `${label} : precondition, un seul created_at (meme transaction)`).toBe(1);
  const ascending = [...inserted.insertionOrder].sort();
  expect(inserted.insertionOrder, `${label} : precondition, insertion pas dans l'ordre croissant des ids`).not.toEqual(ascending);
  expect(inserted.insertionOrder, `${label} : precondition, insertion pas dans l'ordre decroissant des ids`).not.toEqual([...ascending].reverse());
}

// ---------------------------------------------------------------------------
// Photographie d'une organisation (AC10)
// ---------------------------------------------------------------------------

export interface OrganizationSnapshot {
  collections: number;
  links: number;
  /** Ligne `organization_link_usage` de l'organisation, `null` si absente. */
  usage: { link_count: number; link_quota: number | null } | null;
}

/** Lignes `collection` et `link` de l'organisation et sa ligne de compteur, relues sous administration. */
export async function snapshotOrganization(organizationId: string): Promise<OrganizationSnapshot> {
  return asBypassRls(async (client) => {
    const collections = await client.query<{ c: string }>("SELECT count(*)::text AS c FROM collection WHERE organization_id = $1", [organizationId]);
    const links = await client.query<{ c: string }>("SELECT count(*)::text AS c FROM link WHERE organization_id = $1", [organizationId]);
    const usage = await client.query<{ link_count: number; link_quota: number | null }>(
      "SELECT link_count, link_quota FROM organization_link_usage WHERE organization_id = $1",
      [organizationId],
    );
    return {
      collections: Number(collections.rows[0]?.c ?? "0"),
      links: Number(links.rows[0]?.c ?? "0"),
      usage: usage.rows[0] ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Valeurs de test
// ---------------------------------------------------------------------------

/** U+202E (inversion de sens d'ecriture) et U+200B (espace de largeur nulle), D-119. */
export const RLO = "‮";
export const ZWSP = "​";

export function messageFrom(result: HttpResult): string {
  const body = result.body;
  const message = typeof body === "object" && body !== null && "message" in body ? body.message : undefined;
  if (typeof message !== "string") throw new Error(`Aucun message texte dans la reponse (HTTP ${result.status}). Corps brut : ${result.text}`);
  return message;
}
