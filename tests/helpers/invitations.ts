/**
 * Helpers de la tranche 003 (invitation d'un membre) : environnement, doublures
 * (faux point d'evenements Inngest de 002, fausse messagerie), client HTTP de la
 * route, ouverture independante du jeton scelle, execution de la fonction
 * d'envoi dans le processus de test (@inngest/test).
 *
 * Messages d'echec : tout helper qui attend un statut HTTP affiche le VRAI code
 * recu et le corps BRUT complet (texte d'abord, JSON ensuite), voir
 * `expectStatus` / `expectError` de ./billing.
 *
 * Variables lues (noms seulement, valeurs jamais affichees) : voir `invitationEnv`.
 *
 * CONTRAT SUPPOSE (a confirmer par l'implementeur, voir journal d'avancement) :
 *   apps/web/src/lib/inngest/send-invitation-email.ts exporte
 *   `getSendInvitationEmail()`, qui construit la fonction Inngest au premier
 *   usage (comme `getProcessStripeEvent`, D-079).
 */
import { createDecipheriv, randomUUID } from "node:crypto";
import type { InngestTestEngine } from "@inngest/test";
import { vi } from "vitest";
import { loadTestEnv, requireEnv } from "../_factory/env";
import { authHeaders, baseUrl, uniqueEmail, type AuthenticatedSession } from "./auth";
import { applyServerEnvToProcess, readResponse, type HttpResult, type MemoizedStep, type ProcessorOutput } from "./billing";
import { FakeInngest, type CapturedInngestEvent } from "../billing/fakes/fake-inngest";
import { FakeMailbox } from "../invitations/fakes/fake-mailbox";

loadTestEnv();

export const INVITATION_EVENT = "signet/invitation.created";

// ---------------------------------------------------------------------------
// Environnement
// ---------------------------------------------------------------------------

export interface InvitationEnv {
  appUrl: string;
  /** Cle de scellement (32 octets, base64url), valeur inventee de test partagee par la suite et le serveur. */
  tokenKey: string;
  emailCaptureUrl: string;
  mailboxPort: number;
  fakeInngestPort: number;
}

function portOf(url: string, label: string): number {
  const port = Number(new URL(url).port);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`[tests] ${label} ne designe aucun port explicite.`);
  return port;
}

export function invitationEnv(): InvitationEnv {
  const env = requireEnv([
    "TEST_FAKE_INNGEST_PORT",
    "TEST_SERVER_ENV_INNGEST_DEV",
    "TEST_SERVER_ENV_APP_URL",
    "TEST_SERVER_ENV_INVITATION_TOKEN_KEY",
    "TEST_SERVER_ENV_EMAIL_CAPTURE_URL",
  ]);
  const fakeInngestPort = Number(env.TEST_FAKE_INNGEST_PORT);
  if (portOf(env.TEST_SERVER_ENV_INNGEST_DEV, "TEST_SERVER_ENV_INNGEST_DEV") !== fakeInngestPort) {
    throw new Error("[tests] TEST_SERVER_ENV_INNGEST_DEV ne vise pas le port TEST_FAKE_INNGEST_PORT.");
  }
  const key = Buffer.from(env.TEST_SERVER_ENV_INVITATION_TOKEN_KEY, "base64url");
  if (key.length !== 32) {
    throw new Error("[tests] TEST_SERVER_ENV_INVITATION_TOKEN_KEY doit etre 32 octets encodes en base64url (valeur inventee).");
  }
  return {
    appUrl: env.TEST_SERVER_ENV_APP_URL,
    tokenKey: env.TEST_SERVER_ENV_INVITATION_TOKEN_KEY,
    emailCaptureUrl: env.TEST_SERVER_ENV_EMAIL_CAPTURE_URL,
    mailboxPort: portOf(env.TEST_SERVER_ENV_EMAIL_CAPTURE_URL, "TEST_SERVER_ENV_EMAIL_CAPTURE_URL"),
    fakeInngestPort,
  };
}

// ---------------------------------------------------------------------------
// Doublures
// ---------------------------------------------------------------------------

export interface InvitationFakes {
  inngest: FakeInngest;
  mailbox: FakeMailbox;
}

export async function startInvitationFakes(): Promise<InvitationFakes> {
  const env = invitationEnv();
  const inngest = await FakeInngest.start(env.fakeInngestPort);
  try {
    const mailbox = await FakeMailbox.start(env.mailboxPort);
    return { inngest, mailbox };
  } catch (error) {
    await inngest.stop();
    throw error;
  }
}

export async function stopInvitationFakes(fakes: InvitationFakes | undefined): Promise<void> {
  await Promise.all([fakes?.inngest.stop(), fakes?.mailbox.stop()]);
}

export function resetInvitationFakes(fakes: InvitationFakes): void {
  fakes.inngest.reset();
  fakes.mailbox.reset();
}

// ---------------------------------------------------------------------------
// Route d'invitation
// ---------------------------------------------------------------------------

export function invitationsUrl(organizationId: string): string {
  return `${baseUrl()}/api/organizations/${organizationId}/invitations`;
}

/** `payload` est serialise en JSON ; une chaine est envoyee telle quelle (corps non JSON). */
export async function postInvitation(
  session: AuthenticatedSession | null,
  organizationId: string,
  payload: Record<string, unknown> | string,
  options?: { signal?: AbortSignal },
): Promise<HttpResult> {
  const response = await fetch(invitationsUrl(organizationId), {
    method: "POST",
    headers: session ? authHeaders(session) : { "Content-Type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
    signal: options?.signal,
  });
  return readResponse(response);
}

/** Adresse d'invite unique (minuscules, domaine reserve aux tests). */
export function inviteeEmail(): string {
  return uniqueEmail("invitee");
}

/** Evenements `signet/invitation.created` captures par le faux Inngest pour une invitation. */
export function eventsOfInvitation(inngest: FakeInngest, invitationId: string): CapturedInngestEvent[] {
  return inngest.events.filter((e) => e.name === INVITATION_EVENT && e.data.invitationId === invitationId);
}

/** Evenements d'invitation captures dont les donnees portent `email` (adresse unique du test). */
export function eventsForEmail(inngest: FakeInngest, email: string): CapturedInngestEvent[] {
  return inngest.events.filter((e) => e.name === INVITATION_EVENT && e.data.email === email);
}

/** L'unique evenement d'une invitation ; echoue avec ce que le faux a recu sinon. */
export function singleInvitationEvent(inngest: FakeInngest, invitationId: string): CapturedInngestEvent {
  const events = eventsOfInvitation(inngest, invitationId);
  const [first] = events;
  if (events.length !== 1 || !first) {
    throw new Error(
      `evenement ${INVITATION_EVENT} attendu une fois pour l'invitation ${invitationId}, ${events.length} recu(s). ` +
        `Corps bruts recus par le faux Inngest : ${JSON.stringify(inngest.rawBodies)}`,
    );
  }
  return first;
}

// ---------------------------------------------------------------------------
// Jeton scelle : ouverture independante de l'implementation (AES-256-GCM)
// ---------------------------------------------------------------------------

export const IV_BYTES = 12;
export const TAG_BYTES = 16;

/**
 * Ouvre `sealedToken` selon le contrat : base64url(iv 12 octets || chiffre ||
 * etiquette 16 octets), AES-256-GCM, donnees authentifiees = invitationId.
 * Leve si l'authentification echoue. Renvoie le texte clair tel que scelle.
 */
export function openSealedToken(sealedToken: string, invitationId: string, key: string): Buffer {
  const raw = Buffer.from(sealedToken, "base64url");
  if (raw.length < IV_BYTES + TAG_BYTES + 1) throw new Error(`sealedToken trop court (${raw.length} octets)`);
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(raw.length - TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "base64url"), iv);
  decipher.setAAD(Buffer.from(invitationId, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Le jeton (forme du lien) deduit du clair scelle : 32 octets bruts -> leur
 * base64url ; sinon le clair est deja le jeton encode. Le contrat fixe le format
 * du lien, pas celui du clair interne au scellement.
 */
export function tokenFromPlaintext(plaintext: Buffer): string {
  return plaintext.length === 32 ? plaintext.toString("base64url") : plaintext.toString("utf8");
}

/** Une cle valide differente de celle du serveur de test (valeur inventee, 32 octets). */
export function otherTokenKey(): string {
  return Buffer.alloc(32, 7).toString("base64url");
}

/** Formes sous lesquelles le jeton ne doit apparaitre nulle part (AC3). */
export function tokenForms(token: string): string[] {
  const bytes = Buffer.from(token, "base64url");
  return [token, bytes.toString("hex"), bytes.toString("base64")];
}

// ---------------------------------------------------------------------------
// Lien de l'e-mail
// ---------------------------------------------------------------------------

/** Extrait le jeton du lien `APP_URL/invitations/accept#token=<jeton>` du texte ; undefined si absent. */
export function tokenFromText(text: string | undefined, appUrl: string): string | undefined {
  if (text === undefined) return undefined;
  const escaped = `${appUrl.replace(/\/$/, "")}/invitations/accept#token=`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}([A-Za-z0-9_-]+)`).exec(text);
  return match?.[1];
}

export function linkFor(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, "")}/invitations/accept#token=${token}`;
}

// ---------------------------------------------------------------------------
// Fonction d'envoi executee dans le processus de test (@inngest/test)
// ---------------------------------------------------------------------------

/**
 * Chemin du module de la fonction d'envoi, tenu dans une constante : le module
 * n'existe pas encore quand les tests sont ecrits (tranche ecrite tests d'abord),
 * et un import litteral ferait echouer `tsc` sur tout le depot. L'echec attendu est
 * alors « module introuvable » a l'execution, rendu par `runSender`.
 */
const SENDER_MODULE = "../../apps/web/src/lib/inngest/send-invitation-email";

function isSenderModule(value: unknown): value is SenderModule {
  return typeof value === "object" && value !== null && "getSendInvitationEmail" in value && typeof value.getSendInvitationEmail === "function";
}

interface SenderModule {
  getSendInvitationEmail: () => ConstructorParameters<typeof InngestTestEngine>[0]["function"];
}

/**
 * Environnement du serveur reproduit dans le processus de test (la fonction
 * s'execute ICI), puis surcharges du cas : `undefined` retire la variable.
 * `vi.unstubAllEnvs()` et `vi.resetModules()` sont a la charge de l'appelant.
 */
export async function loadSenderEngine(overrides?: Record<string, string | undefined>): Promise<InngestTestEngine> {
  applyServerEnvToProcess();
  for (const [name, value] of Object.entries(overrides ?? {})) vi.stubEnv(name, value);
  if (overrides && Object.keys(overrides).length > 0) vi.resetModules();
  const { InngestTestEngine: Engine } = await import("@inngest/test");
  const loaded: unknown = await import(SENDER_MODULE);
  if (!isSenderModule(loaded)) {
    throw new Error(`[tests] ${SENDER_MODULE} doit exporter getSendInvitationEmail() (nom attendu, voir le journal d'avancement de la tranche 003).`);
  }
  const module = loaded;
  return new Engine({ function: module.getSendInvitationEmail() });
}

/**
 * Execute la fonction d'envoi pour l'evenement. Une erreur a la CONSTRUCTION
 * (module absent, environnement refuse) est rendue comme une erreur d'execution :
 * les tests lisent le meme champ `error` dans tous les cas.
 */
export async function runSender(
  event: CapturedInngestEvent,
  options?: { steps?: MemoizedStep[]; env?: Record<string, string | undefined> },
): Promise<ProcessorOutput> {
  let engine: InngestTestEngine;
  try {
    engine = await loadSenderEngine(options?.env);
  } catch (error) {
    return { error, state: {} };
  }
  return engine.execute({ events: [event], steps: options?.steps });
}

/** Pas reussis de l'execution, rendus comme le fait Inngest lors d'un rejeu (valeur memorisee). */
export async function memoizedStepsOf(output: ProcessorOutput): Promise<MemoizedStep[]> {
  const memoized: MemoizedStep[] = [];
  for (const [id, promise] of Object.entries(output.state)) {
    const settled = await Promise.race([
      promise.then(
        (value) => ({ ok: true as const, value }),
        () => ({ ok: false as const }),
      ),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 2_000)),
    ]);
    if (settled?.ok) memoized.push({ id, idIsHashed: true, handler: () => settled.value });
  }
  return memoized;
}

/** Valeurs retournees par les pas reussis, serialisees (AC3 : Inngest les memorise). */
export async function stepReturnValuesText(output: ProcessorOutput): Promise<string> {
  const parts: string[] = [];
  for (const [id, promise] of Object.entries(output.state)) {
    const settled = await Promise.race([
      promise.then(
        (value) => ({ ok: true as const, value }),
        () => ({ ok: false as const }),
      ),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 2_000)),
    ]);
    if (settled?.ok) parts.push(`${id}=${JSON.stringify(settled.value) ?? "undefined"}`);
  }
  return parts.join("\n");
}

/** Attend au plus `ms` : `undefined` si la promesse ne s'est pas resolue (fonction suspendue). */
export async function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]);
}

export function randomOrganizationId(): string {
  return randomUUID();
}
