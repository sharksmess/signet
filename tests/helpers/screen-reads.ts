/**
 * Helpers de la tranche 013 (consultations pour les ecrans) : clients HTTP des
 * deux routes GET, parcours d'invitation reel (emission 003 puis acceptation
 * 006), insertions a horodatage egal, photographie des tables pour prouver
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
import { authHeaders, baseUrl, signUp, type AuthenticatedSession } from "./auth";
import { expectStatus, readResponse, type HttpResult } from "./billing";
import { asBypassRls } from "./db";
import type { OrganizationFixture } from "./fixtures";
import type { InvitationFakes } from "./invitations";
import { issueInvitation, postAccept } from "./invitations-accept";

// ---------------------------------------------------------------------------
// Client HTTP
// ---------------------------------------------------------------------------

export function organizationsUrl(): string {
  return `${baseUrl()}/api/organizations`;
}

export function membersUrl(organizationId: string): string {
  return `${baseUrl()}/api/organizations/${organizationId}/members`;
}

/**
 * `GET /api/organizations`. `session` null : aucune session. `query` : chaine de
 * requete avec son `?`. `extraHeaders` : en-tetes ajoutes (tentatives de changer
 * l'utilisateur lu).
 */
export async function getMyOrganizations(
  session: AuthenticatedSession | null,
  options?: { query?: string; extraHeaders?: Record<string, string> },
): Promise<HttpResult> {
  const response = await fetch(`${organizationsUrl()}${options?.query ?? ""}`, {
    method: "GET",
    headers: { ...(session ? authHeaders(session) : {}), ...(options?.extraHeaders ?? {}) },
  });
  return readResponse(response);
}

/** `GET /api/organizations` avec un cookie de session invalide. */
export async function getMyOrganizationsWithCookie(cookie: string): Promise<HttpResult> {
  const response = await fetch(organizationsUrl(), { method: "GET", headers: { Cookie: cookie, Origin: baseUrl() } });
  return readResponse(response);
}

/** `GET /api/organizations/:organizationId/members`. `organizationId` est place tel quel dans le chemin. */
export async function getMembers(session: AuthenticatedSession | null, organizationId: string, query = ""): Promise<HttpResult> {
  const response = await fetch(`${membersUrl(organizationId)}${query}`, {
    method: "GET",
    headers: session ? authHeaders(session) : {},
  });
  return readResponse(response);
}

/** `GET .../members` avec un cookie de session invalide. */
export async function getMembersWithCookie(organizationId: string, cookie: string): Promise<HttpResult> {
  const response = await fetch(membersUrl(organizationId), { method: "GET", headers: { Cookie: cookie, Origin: baseUrl() } });
  return readResponse(response);
}

/** Cookie de session qui ne correspond a aucune session. */
export const INVALID_COOKIE = "better-auth.session_token=invalide.invalide";

/** Identifiants de chemin qui ne sont pas des UUID (dont deux quasi-valides). */
export const MALFORMED_IDS = ["pas-un-uuid", "12345", "00000000-0000-0000-0000-00000000000g", "00000000-0000-0000-0000-0000000000000"];

/** Message fixe cite par le contrat de tranche (section « Erreurs »). */
export const INVALID_ORGANIZATION_ID_MESSAGE = "Identifiant d'organisation invalide.";

// ---------------------------------------------------------------------------
// Lecture des corps
// ---------------------------------------------------------------------------

/** Elements du corps `200` : un tableau d'objets. Echoue avec le corps brut sinon. */
export function recordsOf(result: HttpResult, label: string): Record<string, unknown>[] {
  expectStatus(result, 200, label);
  if (!Array.isArray(result.body)) {
    throw new Error(`${label} : HTTP 200 mais le corps n'est pas un tableau JSON. Corps brut : ${result.text}`);
  }
  return result.body.map((item: unknown, index: number) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(`${label} : l'element ${index} n'est pas un objet. Corps brut : ${result.text}`);
    }
    return item as Record<string, unknown>;
  });
}

/** Valeurs texte du champ `key`, dans l'ordre rendu. */
export function fieldOf(items: readonly Record<string, unknown>[], key: string): string[] {
  return items.map((item, index) => {
    const value = item[key];
    if (typeof value !== "string") throw new Error(`fieldOf : l'element ${index} n'a pas de champ texte "${key}" : ${JSON.stringify(item)}`);
    return value;
  });
}

/** `createdAt` ISO 8601 UTC avec millisecondes et suffixe `Z`. */
export function isIsoUtc(value: unknown): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}

// ---------------------------------------------------------------------------
// Parcours d'invitation reel (003 puis 006)
// ---------------------------------------------------------------------------

/**
 * Fait de `session` un member de l'organisation par le parcours reel : emission
 * par l'owner (route de 003), envoi, lecture du jeton dans la fausse messagerie,
 * acceptation par la route de 006. Echoue avec le corps brut si l'acceptation
 * ne rend pas `200`.
 */
export async function joinByInvitation(fakes: InvitationFakes, org: OrganizationFixture, session: AuthenticatedSession): Promise<void> {
  // issueInvitation lit le PREMIER message depose pour l'adresse : un second parcours pour la meme adresse
  // (membre de deux organisations) lirait le jeton deja consomme. On vide donc la messagerie avant d'emettre.
  fakes.mailbox.reset();
  const issued = await issueInvitation(fakes, { org, email: session.email, label: "arrangement 013" });
  const accepted = await postAccept(session, { token: issued.token });
  expectStatus(accepted, 200, `acceptation de l'invitation de ${org.organizationId}`);
}

/** Inscrit un utilisateur puis le fait entrer dans l'organisation par invitation. */
export async function signUpAndJoin(fakes: InvitationFakes, org: OrganizationFixture): Promise<AuthenticatedSession> {
  const session = await signUp();
  await joinByInvitation(fakes, org, session);
  return session;
}

// ---------------------------------------------------------------------------
// Insertions a horodatage egal (administration, une seule transaction)
// ---------------------------------------------------------------------------

/** Ordre d'insertion volontairement ni croissant ni decroissant (indices 0 a 3). */
const PERMUTATION = [2, 0, 3, 1] as const;
export const TIED_COUNT = PERMUTATION.length;

export interface TiedOrganizations {
  /** Identifiants dans l'ordre d'INSERTION. */
  insertionOrder: string[];
  /** `created_at` relus apres validation. */
  createdAt: Date[];
}

/** Quatre identifiants distincts, visiblement fabriques : prefixe aleatoire, suffixe 1 a 4. */
function orderedIds(): string[] {
  const prefix = randomUUID().slice(0, 24);
  return PERMUTATION.map((_, index) => `${prefix}${String(index + 1).padStart(12, "0")}`);
}

/**
 * Quatre organisations dont `userId` est owner, inserees dans une meme
 * transaction (meme `now()`), ordre d'insertion different de l'ordre des ids.
 */
export async function insertTiedOrganizations(userId: string): Promise<TiedOrganizations> {
  const ids = orderedIds();
  const insertionOrder = PERMUTATION.map((position) => ids[position] ?? "");
  const createdAt = await asBypassRls(async (client) => {
    await client.query("BEGIN");
    try {
      // Les declencheurs de creation (compteur, abonnement) tournent sous signet_definer et leurs politiques lisent
      // la valeur brute de app.organization_id : on la pose avant chaque INSERT (SET LOCAL, meme transaction).
      for (const [index, id] of insertionOrder.entries()) {
        await client.query("SELECT set_config('app.organization_id', $1, true)", [id]);
        await client.query("INSERT INTO organization (id, name, slug) VALUES ($1, $2, $3)", [
          id,
          `Organisation simultanee ${index}`,
          `simultanee-${id.replace(/-/g, "")}`,
        ]);
        await client.query("INSERT INTO member (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [id, userId]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    const { rows } = await client.query<{ created_at: Date }>("SELECT created_at FROM organization WHERE id = ANY($1::uuid[])", [insertionOrder]);
    return rows.map((row) => row.created_at);
  });
  return { insertionOrder, createdAt };
}

export interface TiedMembers {
  /** Identifiants d'utilisateurs dans l'ordre d'INSERTION. */
  insertionOrder: string[];
  createdAt: Date[];
}

/** Ajoute les `userIds` comme members de l'organisation, dans une meme transaction (meme `created_at`), dans l'ordre fourni. */
export async function insertTiedMembers(organizationId: string, userIds: readonly string[]): Promise<TiedMembers> {
  const createdAt = await asBypassRls(async (client) => {
    await client.query("BEGIN");
    try {
      for (const userId of userIds) {
        await client.query("INSERT INTO member (organization_id, user_id, role) VALUES ($1, $2, 'member')", [organizationId, userId]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    const { rows } = await client.query<{ created_at: Date }>(
      "SELECT created_at FROM member WHERE organization_id = $1 AND user_id = ANY($2::uuid[])",
      [organizationId, [...userIds]],
    );
    return rows.map((row) => row.created_at);
  });
  return { insertionOrder: [...userIds], createdAt };
}

/** Utilisateurs reels, dans l'ordre de leurs identifiants croissants, puis reordonnes en une insertion ni croissante ni decroissante. */
export async function signUpUsersForTie(): Promise<{ sessions: AuthenticatedSession[]; insertionOrder: string[]; ascending: string[] }> {
  const sessions: AuthenticatedSession[] = [];
  for (let index = 0; index < TIED_COUNT; index += 1) sessions.push(await signUp());
  const ascending = sessions.map((s) => s.userId).sort();
  const insertionOrder = PERMUTATION.map((position) => ascending[position] ?? "");
  return { sessions, insertionOrder, ascending };
}

/** Precondition : un seul `created_at`, ordre d'insertion ni croissant ni decroissant. */
export function expectTiedPrecondition(input: { insertionOrder: readonly string[]; createdAt: readonly Date[] }, label: string): void {
  expect(input.createdAt, `${label} : toutes les lignes ont ete relues`).toHaveLength(TIED_COUNT);
  expect(new Set(input.createdAt.map((d) => d.getTime())).size, `${label} : precondition, un seul created_at (meme transaction)`).toBe(1);
  const ascending = [...input.insertionOrder].sort();
  expect(input.insertionOrder, `${label} : precondition, insertion pas dans l'ordre croissant`).not.toEqual(ascending);
  expect(input.insertionOrder, `${label} : precondition, insertion pas dans l'ordre decroissant`).not.toEqual([...ascending].reverse());
}

// ---------------------------------------------------------------------------
// Lectures de verification (administration, filtrees par identifiants du test)
// ---------------------------------------------------------------------------

export interface OrganizationDbRow {
  id: string;
  name: string;
  created_at: Date;
}

export async function readOrganizationRow(organizationId: string): Promise<OrganizationDbRow> {
  return asBypassRls(async (client) => {
    const { rows } = await client.query<OrganizationDbRow>("SELECT id, name, created_at FROM organization WHERE id = $1", [organizationId]);
    const [row] = rows;
    if (!row) throw new Error(`readOrganizationRow : organisation ${organizationId} introuvable.`);
    return row;
  });
}

export interface MemberDbRow {
  user_id: string;
  email: string;
  role: string;
  created_at: Date;
}

/** Membres d'une organisation avec leur adresse, dans l'ordre attendu par D-138 point 3 (calcule ici, pas par la route). */
export async function readMembersWithEmail(organizationId: string): Promise<MemberDbRow[]> {
  return asBypassRls(async (client) => {
    const { rows } = await client.query<MemberDbRow>(
      `SELECT m.user_id, u.email, m.role, m.created_at
         FROM member m JOIN app_user u ON u.id = m.user_id
        WHERE m.organization_id = $1
        ORDER BY m.created_at ASC, m.user_id ASC`,
      [organizationId],
    );
    return rows;
  });
}

// ---------------------------------------------------------------------------
// Photographie des lignes completes (AC10)
// ---------------------------------------------------------------------------

export interface TablesSnapshot {
  organization: unknown[];
  member: unknown[];
  app_user: unknown[];
  invitation: unknown[];
}

/**
 * Lignes completes (`to_jsonb`) des quatre tables pour les organisations et les
 * utilisateurs donnes, relues sous administration, triees par identifiant.
 */
export async function snapshotTables(input: { organizationIds: readonly string[]; userIds: readonly string[] }): Promise<TablesSnapshot> {
  const orgs = [...input.organizationIds];
  const users = [...input.userIds];
  return asBypassRls(async (client) => {
    const read = async (sql: string): Promise<unknown[]> => {
      const { rows } = await client.query<{ row: unknown }>(sql, [orgs, users]);
      return rows.map((r) => r.row);
    };
    return {
      organization: await read("SELECT to_jsonb(t) AS row FROM organization t WHERE t.id = ANY($1::uuid[]) AND $2::uuid[] IS NOT NULL ORDER BY t.id"),
      member: await read("SELECT to_jsonb(t) AS row FROM member t WHERE t.organization_id = ANY($1::uuid[]) OR t.user_id = ANY($2::uuid[]) ORDER BY t.id"),
      app_user: await read("SELECT to_jsonb(t) AS row FROM app_user t WHERE t.id = ANY($2::uuid[]) AND $1::uuid[] IS NOT NULL ORDER BY t.id"),
      invitation: await read("SELECT to_jsonb(t) AS row FROM invitation t WHERE t.organization_id = ANY($1::uuid[]) AND $2::uuid[] IS NOT NULL ORDER BY t.id"),
    };
  });
}
