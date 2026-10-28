/**
 * Fonctions pures d'interface de la tranche 012, chargees DYNAMIQUEMENT : les
 * modules `apps/web/src/ui/*` n'existent pas quand les tests sont ecrits (tests
 * d'abord), et un import litteral ferait echouer `tsc` sur tout le depot. L'echec
 * attendu avant implementation est « module introuvable », rendu en clair.
 *
 * SIGNATURES FIXEES PAR LES TESTS (l'implementation s'y conforme ; chemins relatifs
 * a `apps/web/src/`, import depuis `tests/` par chemin relatif, jamais d'alias `@/`) :
 *
 * `ui/visible-text.ts`
 *   export function visibleText(value: string): string
 *
 * `ui/safe-link.tsx`
 *   export function safeLink(url: string):
 *     | { kind: "link"; href: string; hostname: string }
 *     | { kind: "text" }
 *
 * `ui/requests.ts`
 *   export interface FormRequest { path: string; method: "POST"; headers: { "Content-Type": "application/json" }; body: string }
 *   export type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>
 *   export type SignUpOutcome =
 *     | { kind: "created"; destination: string }          // `/organisations/<id>`
 *     | { kind: "creation_failed"; destination: string }  // `/organisations?creation=echec`
 *     | { kind: "refused"; message: string }
 *   export function buildSignInRequest(input: { email: string; password: string }): FormRequest
 *   export function buildSignUpRequest(input: { email: string; password: string }): FormRequest
 *   export function buildCreateOrganizationRequest(input: { name: string }): FormRequest
 *   export function buildCreateCollectionRequest(organizationId: string, input: { name: string }): FormRequest
 *   export function buildInviteRequest(organizationId: string, input: { email: string }): FormRequest
 *   export function buildAddLinkRequest(organizationId: string, collectionId: string, input: { url: string; title: string }): FormRequest
 *   export function buildAcceptRequest(token: string): FormRequest
 *   export function buildSignOutRequest(): FormRequest
 *   export function tokenFromFragment(hash: string): string | null
 *   export function signUpWithOrganization(fetchFn: FetchLike, input: { email: string; password: string; organizationName: string }): Promise<SignUpOutcome>
 *
 * `ui/messages.ts`
 *   export type FormId = "sign-in" | "sign-up" | "create-organization" | "create-collection" | "invite" | "add-link" | "accept"
 *   export const FIXED_MESSAGES: readonly string[]   // liste fermee de tous les textes affichables
 *   export function chooseMessage(form: FormId, status: number, body: unknown): string
 *     // `status` 0 = erreur reseau ; `body` = corps JSON decode, ou texte, ou undefined.
 */
import { expect } from "vitest";

export interface FormRequest {
  path: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>;

export type SignUpOutcome =
  | { kind: "created"; destination: string }
  | { kind: "creation_failed"; destination: string }
  | { kind: "refused"; message: string };

export type FormId = "sign-in" | "sign-up" | "create-organization" | "create-collection" | "invite" | "add-link" | "accept";

export type SafeLink = { kind: "link"; href: string; hostname: string } | { kind: "text" };

export interface RequestsApi {
  buildSignInRequest(input: { email: string; password: string }): FormRequest;
  buildSignUpRequest(input: { email: string; password: string }): FormRequest;
  buildCreateOrganizationRequest(input: { name: string }): FormRequest;
  buildCreateCollectionRequest(organizationId: string, input: { name: string }): FormRequest;
  buildInviteRequest(organizationId: string, input: { email: string }): FormRequest;
  buildAddLinkRequest(organizationId: string, collectionId: string, input: { url: string; title: string }): FormRequest;
  buildAcceptRequest(token: string): FormRequest;
  buildSignOutRequest(): FormRequest;
  tokenFromFragment(hash: string): string | null;
  signUpWithOrganization(fetchFn: FetchLike, input: { email: string; password: string; organizationName: string }): Promise<SignUpOutcome>;
}

export interface MessagesApi {
  FIXED_MESSAGES: readonly string[];
  chooseMessage: (form: FormId, status: number, body: unknown) => string;
}

/** Chemins tenus dans des constantes : un import litteral d un module absent ferait echouer tsc sur tout le depot. */
const MODULES = {
  visibleText: "../../apps/web/src/ui/visible-text",
  safeLink: "../../apps/web/src/ui/safe-link",
  requests: "../../apps/web/src/ui/requests",
  messages: "../../apps/web/src/ui/messages",
} as const;

const PATHS: Record<keyof typeof MODULES, string> = {
  visibleText: "apps/web/src/ui/visible-text.ts",
  safeLink: "apps/web/src/ui/safe-link.tsx",
  requests: "apps/web/src/ui/requests.ts",
  messages: "apps/web/src/ui/messages.ts",
};

async function load(name: keyof typeof MODULES): Promise<Record<string, unknown>> {
  try {
    const loaded: unknown = await import(MODULES[name]);
    if (typeof loaded !== "object" || loaded === null) throw new Error("le module n'exporte rien");
    return loaded as Record<string, unknown>;
  } catch (error) {
    throw new Error(`[tests] ${PATHS[name]} introuvable ou en erreur a l'import : ${error instanceof Error ? error.message : String(error)}`);
  }
}

function need(module: Record<string, unknown>, file: string, names: readonly string[]): void {
  const missing = names.filter((name) => typeof module[name] !== "function");
  if (missing.length > 0) throw new Error(`[tests] ${file} doit exporter la ou les fonctions : ${missing.join(", ")}.`);
}

export async function loadVisibleText(): Promise<(value: string) => string> {
  const module = await load("visibleText");
  need(module, PATHS.visibleText, ["visibleText"]);
  return module.visibleText as (value: string) => string;
}

export async function loadSafeLink(): Promise<(url: string) => SafeLink> {
  const module = await load("safeLink");
  need(module, PATHS.safeLink, ["safeLink"]);
  return module.safeLink as (url: string) => SafeLink;
}

export async function loadRequests(): Promise<RequestsApi> {
  const module = await load("requests");
  need(module, PATHS.requests, [
    "buildSignInRequest",
    "buildSignUpRequest",
    "buildCreateOrganizationRequest",
    "buildCreateCollectionRequest",
    "buildInviteRequest",
    "buildAddLinkRequest",
    "buildAcceptRequest",
    "buildSignOutRequest",
    "tokenFromFragment",
    "signUpWithOrganization",
  ]);
  return module as unknown as RequestsApi;
}

export async function loadMessages(): Promise<MessagesApi> {
  const module = await load("messages");
  need(module, PATHS.messages, ["chooseMessage"]);
  if (!Array.isArray(module.FIXED_MESSAGES)) throw new Error(`[tests] ${PATHS.messages} doit exporter FIXED_MESSAGES (tableau de textes).`);
  return module as unknown as MessagesApi;
}

// ---------------------------------------------------------------------------
// Faux fetch injecte (le hors-controle : le reseau)
// ---------------------------------------------------------------------------

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export type FakeReply = { status: number; body?: unknown } | { throws: true };

/** `replies[i]` repond au i-eme appel ; un appel de plus que prevu echoue (aucune tentative supplementaire tolerée). */
export function fakeFetch(replies: readonly FakeReply[]): { fetchFn: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchFn: FetchLike = (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const reply = replies[calls.length - 1];
    if (reply === undefined) return Promise.reject(new Error(`fakeFetch : appel inattendu numero ${calls.length} (${init.method} ${url}) ; ${replies.length} reponse(s) prevue(s).`));
    if ("throws" in reply) return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve(new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    }));
  };
  return { fetchFn, calls };
}

/** Le corps d'une requete de formulaire est du JSON : le relit, ou echoue avec le corps brut. */
export function jsonBodyOf(request: { body: string }, label: string): unknown {
  try {
    return JSON.parse(request.body);
  } catch {
    throw new Error(`${label} : le corps de la requete n'est pas du JSON. Corps brut : ${request.body}`);
  }
}

export function expectJsonPost(request: FormRequest, path: string, body: unknown, label: string): void {
  expect(request.method, `${label} : methode`).toBe("POST");
  expect(request.path, `${label} : chemin`).toBe(path);
  expect(request.headers["Content-Type"], `${label} : type de contenu`).toBe("application/json");
  expect(jsonBodyOf(request, label), `${label} : corps`).toEqual(body);
}
