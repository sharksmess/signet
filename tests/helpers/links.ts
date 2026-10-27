/**
 * Helpers de la tranche 005 (ajout d'un lien avec quota Free) : client HTTP de
 * la route, remplissage par la voie normale (INSERT sous `signet_app`, donc par
 * le trigger de compteur), transactions applicatives pilotees a la main pour les
 * preuves de verrou, et lectures de verification.
 *
 * Messages d'echec : tout helper qui attend un statut HTTP affiche le VRAI code
 * recu et le corps BRUT complet (texte d'abord, JSON ensuite), voir
 * `expectStatus` / `expectError` de ./billing.
 *
 * Regles de ce fichier :
 *  - le compteur `link_count` n'est JAMAIS ecrit directement : tout remplissage
 *    insere des lignes `link` sous `signet_app` avec le contexte de
 *    l'organisation (le trigger incremente) ;
 *  - les lectures sous la connexion d'administration (BYPASSRLS) servent
 *    seulement a verifier l'etat apres une action ; aucune ne compte une table
 *    entiere, toutes sont filtrees par des identifiants crees par le test ;
 *  - les connexions applicatives des preuves de concurrence viennent d'un pool
 *    dedie (jusqu'a 12 connexions simultanees), sous le role `signet_app`.
 */
import pg from "pg";
import type { Pool, PoolClient } from "pg";
import { expect } from "vitest";
import { loadTestEnv, requireEnv } from "../_factory/env";
import { authHeaders, baseUrl, type AuthenticatedSession } from "./auth";
import { expectStatus, readResponse, type HttpResult } from "./billing";
import { readLinkCount } from "./billing-db";
import { postCollection } from "./collections";
import { asBypassRls } from "./db";

const { Pool: PgPool } = pg;

loadTestEnv();

// ---------------------------------------------------------------------------
// Client HTTP
// ---------------------------------------------------------------------------

export function linksUrl(organizationId: string, collectionId: string): string {
  return `${baseUrl()}/api/organizations/${organizationId}/collections/${collectionId}/links`;
}

/** `payload` est serialise en JSON ; une chaine est envoyee telle quelle (corps non JSON). */
export async function postLink(
  session: AuthenticatedSession | null,
  organizationId: string,
  collectionId: string,
  payload: unknown,
): Promise<HttpResult> {
  const response = await fetch(linksUrl(organizationId, collectionId), {
    method: "POST",
    headers: session ? authHeaders(session) : { "Content-Type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  return readResponse(response);
}

/** Meme requete avec un cookie de session invalide. */
export async function postLinkWithCookie(
  organizationId: string,
  collectionId: string,
  cookie: string,
  payload: unknown,
): Promise<HttpResult> {
  const response = await fetch(linksUrl(organizationId, collectionId), {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json", Origin: baseUrl() },
    body: JSON.stringify(payload),
  });
  return readResponse(response);
}

/** Collection creee par la vraie route de la tranche 004 ; echoue avec le corps brut sinon. */
export async function createCollectionViaApi(
  session: AuthenticatedSession,
  organizationId: string,
  name: string,
): Promise<string> {
  const result = await postCollection(session, organizationId, { name });
  expectStatus(result, 201, `creation de la collection ${JSON.stringify(name)}`);
  const body = result.body;
  const id = typeof body === "object" && body !== null && "id" in body && typeof body.id === "string" ? body.id : undefined;
  if (!id) throw new Error(`creation de la collection : reponse 201 sans identifiant. Corps brut : ${result.text}`);
  return id;
}

/** `count` collections, noms uniques dans l'organisation. */
export async function createCollectionsViaApi(
  session: AuthenticatedSession,
  organizationId: string,
  count: number,
  prefix = "Collection",
): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    ids.push(await createCollectionViaApi(session, organizationId, `${prefix} ${index} ${Date.now()}`));
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Valeurs de test (visiblement fausses)
// ---------------------------------------------------------------------------

let counter = 0;

/** URL unique, sur un domaine reserve `.invalid`. */
export function uniqueUrl(path = "article"): string {
  counter += 1;
  return `https://exemple.invalid/${path}/${Date.now()}-${counter}`;
}

/** URL de exactement `length` caracteres (UTF-16), valide par ailleurs. */
export function urlOfLength(length: number): string {
  const prefix = "https://exemple.invalid/";
  if (length < prefix.length) throw new Error(`urlOfLength(${length}) : trop court.`);
  return prefix + "a".repeat(length - prefix.length);
}

// ---------------------------------------------------------------------------
// Lectures de verification (administration, filtrees par organisation)
// ---------------------------------------------------------------------------

export interface LinkRow {
  id: string;
  organization_id: string;
  collection_id: string;
  url: string;
  title: string;
  added_by_user_id: string;
  created_at: Date;
}

const LINK_COLUMNS = "id, organization_id, collection_id, url, title, added_by_user_id, created_at";

/** Liens d'une organisation (tous, ou ceux d'une collection). */
export async function readLinks(organizationId: string, collectionId?: string): Promise<LinkRow[]> {
  return asBypassRls(async (client) => {
    const { rows } =
      collectionId === undefined
        ? await client.query<LinkRow>(`SELECT ${LINK_COLUMNS} FROM link WHERE organization_id = $1 ORDER BY created_at, id`, [organizationId])
        : await client.query<LinkRow>(
            `SELECT ${LINK_COLUMNS} FROM link WHERE organization_id = $1 AND collection_id = $2 ORDER BY created_at, id`,
            [organizationId, collectionId],
          );
    return rows;
  });
}

export async function countLinks(organizationId: string): Promise<number> {
  return asBypassRls(async (client) => {
    const { rows } = await client.query<{ c: string }>("SELECT count(*)::text AS c FROM link WHERE organization_id = $1", [organizationId]);
    return Number(rows[0]?.c ?? "0");
  });
}

export async function readLinkById(id: string): Promise<LinkRow | undefined> {
  return asBypassRls(async (client) => {
    const { rows } = await client.query<LinkRow>(`SELECT ${LINK_COLUMNS} FROM link WHERE id = $1`, [id]);
    return rows[0];
  });
}

/** Nombre de liens de l'organisation portant exactement ce titre (preuve qu'une ligne precise n'existe pas). */
export async function countLinksTitled(organizationId: string, title: string): Promise<number> {
  return asBypassRls(async (client) => {
    const { rows } = await client.query<{ c: string }>(
      "SELECT count(*)::text AS c FROM link WHERE organization_id = $1 AND title = $2",
      [organizationId, title],
    );
    return Number(rows[0]?.c ?? "0");
  });
}

export interface LinkState {
  /** Nombre reel de lignes `link`. */
  rows: number;
  /** `link_count` du compteur de l'organisation. */
  counter: number;
}

export async function linkState(organizationId: string): Promise<LinkState> {
  return { rows: await countLinks(organizationId), counter: await readLinkCount(organizationId) };
}

/** AC9 (a) : `link_count = count(*)` ; renvoie l'etat pour la suite du scenario. */
export async function expectCounterAligned(organizationId: string, label: string): Promise<LinkState> {
  const state = await linkState(organizationId);
  expect(state.counter, `${label} : link_count (${state.counter}) doit egaler le nombre reel de liens (${state.rows})`).toBe(state.rows);
  return state;
}

/** Etat identique a `before` (aucun lien cree, compteur inchange) ET compteur aligne. */
export async function expectUnchanged(organizationId: string, before: LinkState, label: string): Promise<void> {
  const after = await expectCounterAligned(organizationId, label);
  expect(after, `${label} : aucun lien ne devait etre cree`).toEqual(before);
}

/** Horloge de la base (instant reel, pas l'heure de la transaction). */
export async function databaseNow(): Promise<Date> {
  return asBypassRls(async (client) => {
    const { rows } = await client.query<{ t: Date }>("SELECT clock_timestamp() AS t");
    const [row] = rows;
    if (!row) throw new Error("databaseNow : aucune ligne.");
    return row.t;
  });
}

// ---------------------------------------------------------------------------
// Erreurs Postgres
// ---------------------------------------------------------------------------

export interface PgFailure {
  code?: string;
  message?: string;
  constraint?: string;
}

/** Execute l'operation ; rend l'erreur Postgres levee, ou `undefined` si elle a reussi. */
export async function failureOf(operation: () => Promise<unknown>): Promise<PgFailure | undefined> {
  try {
    await operation();
    return undefined;
  } catch (error) {
    return error as PgFailure;
  }
}

// ---------------------------------------------------------------------------
// Corps d'erreur : jamais de valeur soumise, de Zod, de SQL
// ---------------------------------------------------------------------------

/** Fragments propres aux messages de Zod 4 (`parsed.error.message`), jamais dans un texte fixe. */
export const ZOD_FRAGMENTS = [
  "Too big",
  "Too small",
  "too_big",
  "too_small",
  "expected",
  "received",
  "Invalid",
  "invalid_type",
  "invalid_format",
  "invalid_string",
  "\"path\"",
  "\"code\": \"",
];

/** Fragments d'une erreur Postgres : code SQL, nom de contrainte, d'objet ou de fonction, texte de la base. */
export const SQL_FRAGMENTS = [
  "SG001",
  "P0001",
  "40001",
  "23514",
  "23503",
  "42501",
  "SQLSTATE",
  "violates",
  "constraint",
  "row-level security",
  "could not serialize",
  "link_url_scheme_chk",
  "link_url_length_chk",
  "link_title_length_chk",
  "link_collection_fk",
  "link_usage_on_insert",
  "organization_link_usage",
  "link_count",
  "link_quota",
];

/**
 * Le corps brut de l'erreur ne contient ni fragment de Zod, ni fragment SQL,
 * ni aucune des valeurs de `forbidden` (valeur soumise, identifiants...).
 */
export function expectCleanErrorBody(result: HttpResult, label: string, forbidden: readonly string[] = []): void {
  for (const fragment of [...ZOD_FRAGMENTS, ...SQL_FRAGMENTS, ...forbidden]) {
    expect(result.text, `${label} : ${JSON.stringify(fragment)} ne doit pas figurer dans le corps d'erreur`).not.toContain(fragment);
  }
}

export function messageOf(result: HttpResult): string | undefined {
  const body = result.body;
  return typeof body === "object" && body !== null && "message" in body && typeof body.message === "string" ? body.message : undefined;
}

// ---------------------------------------------------------------------------
// Connexions applicatives (role signet_app) pilotees a la main
// ---------------------------------------------------------------------------

let linkAppPool: Pool | null = null;

/** Pool dedie aux preuves de concurrence : role `signet_app`, base de test verifiee, 12 connexions au plus. */
export function getLinkAppPool(): Pool {
  if (!linkAppPool) {
    const env = requireEnv(["TEST_DATABASE_URL_APP", "TEST_DATABASE_NAME"]);
    const database = new URL(env.TEST_DATABASE_URL_APP).pathname.replace(/^\//, "");
    if (database !== env.TEST_DATABASE_NAME) {
      throw new Error(`[tests] TEST_DATABASE_URL_APP designe la base "${database}", pas la base de test "${env.TEST_DATABASE_NAME}".`);
    }
    linkAppPool = new PgPool({ connectionString: env.TEST_DATABASE_URL_APP, max: 12 });
  }
  return linkAppPool;
}

export async function closeLinkPools(): Promise<void> {
  await linkAppPool?.end();
  linkAppPool = null;
}

export interface AppContext {
  organizationId: string;
  userId: string;
}

/**
 * Ouvre une transaction sous `signet_app` avec le contexte tenant exact de la
 * couche applicative. L'appelant decide du COMMIT ou du ROLLBACK, puis appelle
 * `release()`. `isolation` : niveau demande au BEGIN (defaut : celui du serveur).
 */
export async function beginAsApp(
  ctx: AppContext,
  isolation?: "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE",
): Promise<PoolClient> {
  const client = await getLinkAppPool().connect();
  try {
    await client.query(isolation ? `BEGIN ISOLATION LEVEL ${isolation}` : "BEGIN");
    await client.query("SELECT set_config('app.organization_id', $1, true)", [ctx.organizationId]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [ctx.userId]);
    return client;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    throw error;
  }
}

/** Execute `fn` sous `signet_app` dans une transaction VALIDEE si `fn` reussit (ROLLBACK sinon). */
export async function asAppCommitted<T>(ctx: AppContext, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await beginAsApp(ctx);
  try {
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export const INSERT_LINK_SQL =
  "INSERT INTO link (organization_id, collection_id, url, title, added_by_user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id";

export interface LinkInsert {
  organizationId: string;
  collectionId: string;
  userId: string;
  url?: string;
  title?: string;
}

/** Une insertion directe (sans la route) sur la connexion fournie. */
export async function insertLink(client: PoolClient, input: LinkInsert): Promise<string> {
  const { rows } = await client.query<{ id: string }>(INSERT_LINK_SQL, [
    input.organizationId,
    input.collectionId,
    input.url ?? uniqueUrl("direct"),
    input.title ?? "Lien de test",
    input.userId,
  ]);
  const [row] = rows;
  if (!row) throw new Error("insertLink : INSERT sans ligne retournee.");
  return row.id;
}

/**
 * Remplissage : `count` liens inseres sous `signet_app` avec le contexte de
 * l'organisation (donc par le trigger de compteur), repartis en tourniquet sur
 * `collectionIds`, dans une transaction validee. Ne touche jamais le compteur.
 * Echoue (SG001) si l'organisation est Free et que le total depasse 50 : une
 * organisation a plus de 50 liens est d'abord Pro, puis retrogradee.
 */
export async function seedLinks(input: {
  organizationId: string;
  userId: string;
  collectionIds: readonly string[];
  count: number;
}): Promise<void> {
  if (input.collectionIds.length === 0) throw new Error("seedLinks : au moins une collection est necessaire.");
  await asAppCommitted({ organizationId: input.organizationId, userId: input.userId }, async (client) => {
    const result = await client.query(
      `INSERT INTO link (organization_id, collection_id, url, title, added_by_user_id)
       SELECT $1::uuid, ($2::uuid[])[1 + (g % $3::int)], 'https://exemple.invalid/remplissage/' || g, 'Remplissage ' || g, $4::uuid
         FROM generate_series(1, $5::int) AS g`,
      [input.organizationId, input.collectionIds, input.collectionIds.length, input.userId, input.count],
    );
    if (result.rowCount !== input.count) {
      throw new Error(`seedLinks : ${result.rowCount} ligne(s) inseree(s), ${input.count} attendue(s).`);
    }
  });
}

// ---------------------------------------------------------------------------
// Observation du verrou (AC7 c)
// ---------------------------------------------------------------------------

export async function backendPid(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const [row] = rows;
  if (!row) throw new Error("backendPid : aucune ligne.");
  return row.pid;
}

/**
 * Attend (sonde l'etat, ne dort pas a l'aveugle) que la session `pid` soit
 * observee en attente de verrou : `pg_stat_activity.wait_event_type = 'Lock'`.
 * Echoue, avec le dernier etat observe, si elle n'y est pas apres `timeoutMs`.
 */
export async function waitUntilBlockedOnLock(pid: number, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "aucune ligne dans pg_stat_activity";
  for (;;) {
    const observed = await asBypassRls(async (client) => {
      const { rows } = await client.query<{ state: string | null; wait_event_type: string | null; wait_event: string | null }>(
        "SELECT state, wait_event_type, wait_event FROM pg_stat_activity WHERE pid = $1",
        [pid],
      );
      return rows[0];
    });
    if (observed?.wait_event_type === "Lock") return;
    if (observed) last = `state=${observed.state}, wait_event_type=${observed.wait_event_type}, wait_event=${observed.wait_event}`;
    if (Date.now() > deadline) {
      throw new Error(`La session ${pid} n'a pas ete observee en attente de verrou en ${timeoutMs} ms. Dernier etat : ${last}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export type Settled<T> = { ok: true; value: T } | { ok: false; error: PgFailure };

/** Lance la requete sans l'attendre ; le resultat (succes ou erreur) se lit plus tard, sans rejet non gere. */
export function startQuery<T>(operation: () => Promise<T>): { result: Promise<Settled<T>>; isSettled: () => boolean } {
  let settled = false;
  const result = operation().then(
    (value): Settled<T> => {
      settled = true;
      return { ok: true, value };
    },
    (error: unknown): Settled<T> => {
      settled = true;
      return { ok: false, error: error as PgFailure };
    },
  );
  return { result, isSettled: () => settled };
}
