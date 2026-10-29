/**
 * Construction des requetes des formulaires et enchainement de l'inscription
 * (tranche 012, AC2, AC11). Fonctions pures, `fetch` injecte : testees sans
 * navigateur.
 *
 * Toutes les requetes : `POST` meme origine, corps JSON, `Content-Type:
 * application/json`. Aucune valeur saisie n'est placee dans l'adresse : les
 * identifiants du chemin viennent de la page (lus cote serveur), tout le
 * reste est dans le corps. Le cookie de session est envoye par le navigateur
 * (`credentials` par defaut).
 */
import { chooseMessage } from "./messages";

export interface FormRequest {
  path: string;
  method: "POST";
  headers: { "Content-Type": "application/json" };
  body: string;
}

export type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>;

export type SignUpOutcome =
  | { kind: "created"; destination: string }
  | { kind: "creation_failed"; destination: string }
  | { kind: "refused"; message: string };

/** Destination fixe apres une inscription reussie et une creation d'organisation en echec (L-10). */
export const CREATION_FAILED_DESTINATION = "/organisations?creation=echec";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonPost(path: string, body: Record<string, string>): FormRequest {
  return { path, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function buildSignInRequest(input: { email: string; password: string }): FormRequest {
  return jsonPost("/api/auth/sign-in/email", { email: input.email, password: input.password });
}

/** `name` de better-auth = l'adresse (D-144 Q-1) : aucun champ « nom ». */
export function buildSignUpRequest(input: { email: string; password: string }): FormRequest {
  return jsonPost("/api/auth/sign-up/email", { email: input.email, password: input.password, name: input.email });
}

export function buildCreateOrganizationRequest(input: { name: string }): FormRequest {
  return jsonPost("/api/organizations", { name: input.name });
}

export function buildCreateCollectionRequest(organizationId: string, input: { name: string }): FormRequest {
  return jsonPost(`/api/organizations/${encodeURIComponent(organizationId)}/collections`, { name: input.name });
}

export function buildInviteRequest(organizationId: string, input: { email: string }): FormRequest {
  return jsonPost(`/api/organizations/${encodeURIComponent(organizationId)}/invitations`, { email: input.email });
}

export function buildAddLinkRequest(organizationId: string, collectionId: string, input: { url: string; title: string }): FormRequest {
  return jsonPost(
    `/api/organizations/${encodeURIComponent(organizationId)}/collections/${encodeURIComponent(collectionId)}/links`,
    { url: input.url, title: input.title },
  );
}

/** Jeton dans le corps SEULEMENT (AC11). */
export function buildAcceptRequest(token: string): FormRequest {
  return jsonPost("/api/invitations/accept", { token });
}

export function buildSignOutRequest(): FormRequest {
  return jsonPost("/api/auth/sign-out", {});
}

/**
 * Jeton d'invitation lu dans le FRAGMENT seulement (`location.hash`, forme
 * `#token=<jeton>`, d'autres paires `cle=valeur` separees par `&` admises).
 * Fragment absent, sans cle `token` ou valeur vide : `null`.
 */
export function tokenFromFragment(hash: string): string | null {
  if (!hash.startsWith("#")) return null;
  for (const pair of hash.slice(1).split("&")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator) !== "token") continue;
    const value = pair.slice(separator + 1);
    return value.length > 0 ? value : null;
  }
  return null;
}

export interface SentResult {
  /** 0 : erreur reseau. */
  status: number;
  /** Corps JSON decode, sinon texte brut, sinon `undefined`. */
  body: unknown;
}

/** Envoie une requete de formulaire ; une erreur reseau rend le statut 0, jamais une exception. */
export async function sendRequest(fetchFn: FetchLike, request: FormRequest): Promise<SentResult> {
  let response: Response;
  try {
    response = await fetchFn(request.path, { method: request.method, headers: { ...request.headers }, body: request.body });
  } catch {
    return { status: 0, body: undefined };
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { status: response.status, body: undefined };
  }
  if (text.length === 0) return { status: response.status, body: undefined };
  try {
    const parsed: unknown = JSON.parse(text);
    return { status: response.status, body: parsed };
  } catch {
    return { status: response.status, body: text };
  }
}

export function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/** Identifiant (UUID) d'une reponse de creation, ou `null`. */
export function createdIdOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("id" in body)) return null;
  const id = body.id;
  return typeof id === "string" && UUID.test(id) ? id.toLowerCase() : null;
}

/**
 * Inscription avec organisation (D-144 Q-1, AC2) : inscription, puis UNE SEULE
 * creation d'organisation. Inscription refusee : aucune creation, texte fixe.
 * Creation refusee ou en erreur : destination fixe, aucune seconde tentative.
 */
export async function signUpWithOrganization(
  fetchFn: FetchLike,
  input: { email: string; password: string; organizationName: string },
): Promise<SignUpOutcome> {
  const signUp = await sendRequest(fetchFn, buildSignUpRequest({ email: input.email, password: input.password }));
  if (!isSuccess(signUp.status)) return { kind: "refused", message: chooseMessage("sign-up", signUp.status, signUp.body) };

  const created = await sendRequest(fetchFn, buildCreateOrganizationRequest({ name: input.organizationName }));
  const id = isSuccess(created.status) ? createdIdOf(created.body) : null;
  if (id === null) return { kind: "creation_failed", destination: CREATION_FAILED_DESTINATION };
  return { kind: "created", destination: `/organisations/${id}` };
}
