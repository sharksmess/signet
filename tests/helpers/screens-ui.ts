/**
 * Fonctions pures d'interface de la tranche 012 : imports STATIQUES et types depuis `apps/web/src/ui/*`
 * (chemins relatifs, jamais d'alias `@/`). Les signatures ne sont plus recopiees ici : `tsc` verifie les
 * tests contre les modules reels. Les `load*` restent asynchrones pour ne pas toucher les appels des suites.
 */
import { expect } from "vitest";
import * as messages from "../../apps/web/src/ui/messages";
import * as requests from "../../apps/web/src/ui/requests";
import { visibleText } from "../../apps/web/src/ui/visible-text";
import type { FetchLike, FormRequest } from "../../apps/web/src/ui/requests";

export type { FetchLike, FormRequest, SignUpOutcome } from "../../apps/web/src/ui/requests";
export type { FormId } from "../../apps/web/src/ui/messages";

/**
 * EXCEPTION BORNEE : `ui/safe-link.tsx` ne peut pas etre importe statiquement ici, car le tsconfig racine (hors
 * perimetre de la tranche) n'a pas `jsx` et `tsc` refuse tout module `.tsx` (TS6142), meme sans JSX. Le module est donc
 * charge a l'execution, verifie par un garde de type (aucun `as`, aucun `any`). Cette copie de `SafeLink` est la seule
 * signature recopiee ; elle disparait avec `"jsx": "preserve"` dans le tsconfig racine (voir le compte rendu de la review).
 */
export type SafeLink = { kind: "link"; href: string; hostname: string } | { kind: "text" };

const SAFE_LINK_MODULE = "../../apps/web/src/ui/safe-link";

function hasSafeLink(value: unknown): value is { safeLink: (url: string) => SafeLink } {
  return typeof value === "object" && value !== null && "safeLink" in value && typeof value.safeLink === "function";
}

export function loadVisibleText(): Promise<typeof visibleText> {
  return Promise.resolve(visibleText);
}

export async function loadSafeLink(): Promise<(url: string) => SafeLink> {
  const loaded: unknown = await import(SAFE_LINK_MODULE);
  if (!hasSafeLink(loaded)) throw new Error("[tests] apps/web/src/ui/safe-link.tsx doit exporter la fonction safeLink.");
  return loaded.safeLink;
}

export function loadRequests(): Promise<typeof requests> {
  return Promise.resolve(requests);
}

export function loadMessages(): Promise<typeof messages> {
  return Promise.resolve(messages);
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
