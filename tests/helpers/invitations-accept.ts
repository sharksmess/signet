/**
 * Helpers de la tranche 006 (acceptation d'une invitation) : client HTTP de la
 * route `POST /api/invitations/accept`, emission de bout en bout (vraie route
 * d'emission de 003, fonction d'envoi executee par @inngest/test, jeton relu dans
 * la fausse messagerie), invitation « forcee en base », appel direct des fonctions
 * `signet.lookup_invitation` / `signet.accept_invitation` sous le role applicatif.
 *
 * Regles : un helper qui echoue affiche le VRAI statut HTTP et le corps BRUT
 * (voir `expectStatus` / `expectError` de ./billing). Les arrangements passent
 * par la connexion d'administration, les verifications de comportement par
 * `signet_app` (jamais un superutilisateur). Aucune requete n'agrege une table
 * entiere : tout est filtre par des identifiants crees par le test.
 */
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { authHeaders, baseUrl, signUp, type AuthenticatedSession } from "./auth";
import { applyServerEnvToProcess, expectProcessed, readResponse, type HttpResult } from "./billing";
import { asBypassRls, getAppPool, getBypassRlsPool } from "./db";
import { createOrganizationFixture, type OrganizationFixture } from "./fixtures";
import { invitationEnv, inviteeEmail, runSender, tokenFromText, type InvitationFakes } from "./invitations";
import { emitInvitation, type EmittedInvitation } from "./invitations-flow";
import { insertInvitationDirect, readInvitationById, sha256, type InvitationRow } from "./invitations-db";

// ---------------------------------------------------------------------------
// Route d'acceptation
// ---------------------------------------------------------------------------

export function acceptUrl(query = ""): string {
  return `${baseUrl()}/api/invitations/accept${query}`;
}

/** `payload` est serialise en JSON ; une chaine est envoyee telle quelle (corps non JSON). */
export async function postAccept(
  session: AuthenticatedSession | null,
  payload: Record<string, unknown> | string,
  options?: { query?: string; signal?: AbortSignal },
): Promise<HttpResult> {
  const response = await fetch(acceptUrl(options?.query), {
    method: "POST",
    headers: session ? authHeaders(session) : { "Content-Type": "application/json", Origin: baseUrl() },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
    signal: options?.signal,
  });
  return readResponse(response);
}

/** Comme `expectError`, pour les clients qui ne conservent pas le corps brut (`ApiResponse`) : statut, code et corps JSON affiches. */
export function expectApiError(result: { status: number; body: unknown }, status: number, code: string, label: string): void {
  const actual = typeof result.body === "object" && result.body !== null && "code" in result.body ? result.body.code : undefined;
  if (result.status !== status || actual !== code) {
    throw new Error(`${label} : HTTP ${result.status} ${JSON.stringify(actual)} recu, ${status} ${code} attendu. Corps : ${JSON.stringify(result.body)}`);
  }
}

/** Les corps d'erreur du projet n'ont que `code` et `message`. */
export function errorBodyKeys(result: HttpResult): string[] {
  const body = result.body;
  return typeof body === "object" && body !== null ? Object.keys(body).sort() : [];
}

// ---------------------------------------------------------------------------
// Invitations : de bout en bout, ou forcees en base
// ---------------------------------------------------------------------------

export interface IssuedInvitation extends EmittedInvitation {
  /** Le jeton (43 caracteres base64url), lu dans le lien de l'e-mail depose dans la fausse messagerie. */
  token: string;
  /** `sha256` des 32 octets decodes (D-090). */
  tokenHash: Buffer;
}

/**
 * Invitation emise par la vraie route (owner de l'organisation), puis fonction
 * d'envoi executee ; le jeton vient du lien de l'e-mail (aucune lecture en base).
 */
export async function issueInvitation(
  fakes: InvitationFakes,
  options?: { org?: OrganizationFixture; email?: string; label?: string },
): Promise<IssuedInvitation> {
  const emitted = await emitInvitation(fakes, options);
  expectProcessed(await runSender(emitted.event), `envoi de l'invitation (${options?.label ?? "arrangement"})`);
  const message = fakes.mailbox.messagesTo(emitted.email)[0];
  const token = tokenFromText(message?.text, invitationEnv().appUrl);
  if (!token) {
    throw new Error(`issueInvitation : aucun lien #token= dans le message depose pour ${emitted.email}. Texte : ${message?.text}`);
  }
  return { ...emitted, token, tokenHash: sha256(Buffer.from(token, "base64url")) };
}

export interface ForgedInvitation {
  org: OrganizationFixture;
  email: string;
  token: string;
  tokenHash: Buffer;
  row: InvitationRow;
}

/** Jeton de test : 32 octets aleatoires, texte base64url et empreinte des octets. */
export function newTestToken(): { token: string; tokenHash: Buffer } {
  const secret = randomBytes(32);
  return { token: secret.toString("base64url"), tokenHash: sha256(secret) };
}

/**
 * Invitation « forcee en base » (connexion d'administration) : etat de depart
 * que l'API ne produit pas, avec un jeton que le test connait.
 */
export async function forgeInvitation(options?: {
  org?: OrganizationFixture;
  email?: string;
  acceptedBy?: string;
  label?: string;
}): Promise<ForgedInvitation> {
  const org = options?.org ?? (await createOrganizationFixture(`Org ${options?.label ?? "forcee"} ${randomBytes(4).toString("hex")}`));
  const email = options?.email ?? inviteeEmail();
  const { token, tokenHash } = newTestToken();
  const row = await insertInvitationDirect({
    organizationId: org.organizationId,
    email,
    invitedByUserId: org.owner.userId,
    tokenHash,
    accepted: options?.acceptedBy ? { byUserId: options.acceptedBy } : undefined,
  });
  return { org, email, token, tokenHash, row };
}

/**
 * Invitation forcee dont les dates sont exprimees en secondes relatives a
 * `now()` : cree `ago` secondes dans le passe, vit `lifetime` secondes (donc
 * expire dans `lifetime - ago` secondes). Calcul sous `TimeZone = 'UTC'` : la
 * ligne respecte le CHECK de 7 jours quel que soit le fuseau de la connexion.
 */
export async function forgeInvitationWindow(options: {
  org?: OrganizationFixture;
  email?: string;
  agoSeconds: number;
  lifetimeSeconds: number;
  label?: string;
}): Promise<ForgedInvitation> {
  const org = options.org ?? (await createOrganizationFixture(`Org ${options.label ?? "fenetre"} ${randomBytes(4).toString("hex")}`));
  const email = options.email ?? inviteeEmail();
  const { token, tokenHash } = newTestToken();
  const id = await asBypassRls(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("SELECT set_config('TimeZone', 'UTC', true)");
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO invitation (organization_id, email, token_hash, invited_by_user_id, created_at, expires_at)
         VALUES ($1, $2, $3, $4,
                 now() - make_interval(secs => $5::float8),
                 now() - make_interval(secs => $5::float8) + make_interval(secs => $6::float8))
         RETURNING id`,
        [org.organizationId, email, tokenHash, org.owner.userId, options.agoSeconds, options.lifetimeSeconds],
      );
      await client.query("COMMIT");
      return rows[0]?.id;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
  if (!id) throw new Error("forgeInvitationWindow : INSERT sans ligne retournee.");
  const row = await readInvitationById(id);
  if (!row) throw new Error(`forgeInvitationWindow : ligne ${id} introuvable.`);
  return { org, email, token, tokenHash, row };
}

/** Un utilisateur inscrit par better-auth (route reelle) a une adresse donnee. */
export async function signUpWithEmail(email: string): Promise<AuthenticatedSession> {
  return signUp({ email });
}

/** Meme adresse, casse alteree (`Invitee-1@Example.TEST`), pour les rapprochements insensibles a la casse. */
export function mixedCase(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.charAt(0).toUpperCase()}${local.slice(1)}@${domain.toUpperCase().replace(/\.TEST$/, ".TEST")}`;
}

// ---------------------------------------------------------------------------
// Lectures de verification (administration, filtrees par identifiants du test)
// ---------------------------------------------------------------------------

export interface MemberRow {
  organization_id: string;
  user_id: string;
  role: string;
}

export async function readMembersOfUser(userId: string): Promise<MemberRow[]> {
  return asBypassRls(async (client) => {
    const { rows } = await client.query<MemberRow>(
      "SELECT organization_id, user_id, role FROM member WHERE user_id = $1 ORDER BY organization_id",
      [userId],
    );
    return rows;
  });
}

export async function readMembersOfOrganization(organizationId: string): Promise<MemberRow[]> {
  return asBypassRls(async (client) => {
    const { rows } = await client.query<MemberRow>(
      "SELECT organization_id, user_id, role FROM member WHERE organization_id = $1 ORDER BY user_id",
      [organizationId],
    );
    return rows;
  });
}

export async function accountCountForEmail(email: string): Promise<number> {
  return asBypassRls(async (client) => {
    const { rows } = await client.query<{ n: string }>("SELECT count(*)::text AS n FROM app_user WHERE lower(email) = lower($1)", [email]);
    return Number(rows[0]?.n ?? "0");
  });
}

/** Supprime le compte sous la connexion d'administration (cascade : sessions, comptes). */
export async function deleteAccountDirect(userId: string): Promise<void> {
  await asBypassRls(async (client) => {
    await client.query("DELETE FROM app_user WHERE id = $1", [userId]);
  });
}

/** Forme comparable de la ligne d'invitation (dates en ISO, empreinte en hexadecimal). */
export function snapshotOf(row: InvitationRow | undefined): string {
  if (!row) return "absent";
  return JSON.stringify({ ...row, token_hash: row.token_hash.toString("hex") });
}

// ---------------------------------------------------------------------------
// Fonctions de la base sous le role applicatif
// ---------------------------------------------------------------------------

export interface AppContext {
  organizationId?: string;
  userId?: string;
  /** Fuseau de la session Postgres de l'appelant (AC4). */
  timeZone?: string;
}

/**
 * Transaction ouverte sous `signet_app`, contexte pose comme le fait la couche
 * applicative. Contrairement a `asTenant` (toujours annulee), le mode `commit`
 * persiste l'effet pour qu'il soit relu ensuite sous administration.
 */
export async function inAppTransaction<T>(
  ctx: AppContext,
  fn: (client: PoolClient) => Promise<T>,
  mode: "commit" | "rollback" = "rollback",
): Promise<T> {
  const client = await getAppPool().connect();
  try {
    await openAppTransaction(client, ctx);
    const result = await fn(client);
    await client.query(mode === "commit" ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** BEGIN + contexte, sans fin de transaction : pour les scenarios a deux transactions ouvertes. */
export async function openAppTransaction(client: PoolClient, ctx: AppContext): Promise<void> {
  await client.query("BEGIN");
  if (ctx.timeZone !== undefined) await client.query("SELECT set_config('TimeZone', $1, true)", [ctx.timeZone]);
  if (ctx.organizationId !== undefined) await client.query("SELECT set_config('app.organization_id', $1, true)", [ctx.organizationId]);
  if (ctx.userId !== undefined) await client.query("SELECT set_config('app.user_id', $1, true)", [ctx.userId]);
}

export async function acceptViaDb(client: PoolClient, tokenHash: Buffer | null): Promise<string[]> {
  const { rows } = await client.query<{ organization_id: string }>(
    "SELECT organization_id FROM signet.accept_invitation($1::bytea)",
    [tokenHash],
  );
  return rows.map((r) => r.organization_id);
}

export interface LookupRow {
  organization_name: string;
  email: string;
  state: string;
}

export async function lookupViaDb(client: PoolClient, tokenHash: Buffer | null): Promise<{ rows: LookupRow[]; columns: string[] }> {
  const result = await client.query<LookupRow>("SELECT * FROM signet.lookup_invitation($1::bytea)", [tokenHash]);
  return { rows: result.rows, columns: result.fields.map((f) => f.name) };
}

export interface PgFailure {
  code?: string;
  message?: string;
}

export async function failureOf(operation: () => Promise<unknown>): Promise<PgFailure | undefined> {
  try {
    await operation();
    return undefined;
  } catch (error) {
    return error as PgFailure;
  }
}

/** Codes qui signaleraient une erreur de test ou une fonction absente, jamais le refus attendu. */
export const WRONG_REASON_CODES = ["42883", "42601", "42P01", "42703", "22P02", "08006", "28000", "28P01", "3D000"];

// ---------------------------------------------------------------------------
// Verrou : prouver qu'une requete ne touche pas la table `invitation`
// ---------------------------------------------------------------------------

export interface TableLock {
  release(): Promise<void>;
}

/**
 * Prend un verrou exclusif sur `invitation` (connexion d'administration). Toute
 * requete qui lit ou ecrit la table attend sa liberation ; une requete qui rend
 * sa reponse pendant que le verrou est tenu n'a donc jamais touche la table.
 * Les fichiers de test s'executent un a un (vitest `fileParallelism: false`).
 */
export async function lockInvitationTable(): Promise<TableLock> {
  const client = await getBypassRlsPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("LOCK TABLE invitation IN ACCESS EXCLUSIVE MODE");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    throw error;
  }
  return {
    release: async () => {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    },
  };
}

/** Attend au plus `ms` ; `"pending"` si la promesse n'est pas resolue. */
export async function settledWithin<T>(promise: Promise<T>, ms: number): Promise<T | "pending"> {
  return Promise.race([promise, new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), ms))]);
}

/**
 * Attend (au plus `ms`) qu'une connexion executant `accept_invitation`
 * soit bloquee sur un verrou. Lue sur une connexion d'administration distincte a
 * chaque tour (hors transaction : `pg_stat_activity` est fige dans une transaction).
 */
export async function waitForAcceptBlockedOnLock(ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const waiting = await asBypassRls(async (client) => {
      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND pid <> pg_backend_pid() AND query LIKE '%signet.accept_invitation(%'`,
      );
      return Number(rows[0]?.n ?? "0");
    });
    if (waiting > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Reouverture D-111 : forme canonique du jeton (D-106), logique dans le processus de test (D-108)
// ---------------------------------------------------------------------------

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Les trois variantes non canoniques d'un jeton de 43 caracteres : meme texte,
 * sauf le dernier caractere dont seuls les deux bits de poids faible (ignores au
 * decodage de 32 octets) changent. Toutes decodent en les memes 32 octets.
 */
export function nonCanonicalVariants(token: string): string[] {
  if (token.length !== 43) throw new Error(`nonCanonicalVariants : 43 caracteres attendus, ${token.length} recus.`);
  const last = BASE64URL_ALPHABET.indexOf(token.charAt(42));
  if (last < 0 || (last & 0b11) !== 0) {
    throw new Error("nonCanonicalVariants : le jeton fourni n'est pas canonique (dernier caractere aux deux bits de poids faible non nuls).");
  }
  return [1, 2, 3].map((low) => `${token.slice(0, 42)}${BASE64URL_ALPHABET.charAt(last | low)}`);
}

/**
 * `apps/web/src/lib/invitations/accept.ts` charge DANS le processus de test, avec
 * l'environnement du serveur de test (`DATABASE_URL_APP` : role `signet_app` sur la
 * base de test). Permet d'atteindre les branches que la route ne peut pas
 * atteindre (compte disparu APRES `getSession`, D-108).
 */
export async function loadAcceptModule(): Promise<typeof import("../../apps/web/src/lib/invitations/accept")> {
  applyServerEnvToProcess();
  return import("../../apps/web/src/lib/invitations/accept");
}

/** Ferme le pool de `apps/web/src/lib/db.ts` ouvert dans le processus de test par `loadAcceptModule`. */
export async function closeServerAppPool(): Promise<void> {
  const db = await import("../../apps/web/src/lib/db");
  await db.getAppPool().end();
}
