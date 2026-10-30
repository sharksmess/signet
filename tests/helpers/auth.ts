/**
 * Helper d'authentification pour les tests HTTP de bout en bout.
 *
 * Hypothese explicite (a confirmer par l'implementation, cf. rapport de la
 * tranche de tests) : better-auth est monte sur `/api/auth/*` (convention par
 * defaut du plugin Next.js de better-auth) avec le fournisseur `credential`
 * (email + mot de passe, seul fournisseur du MVP — ERD §2.2, PRD). Ces tests
 * n'inventent aucune regle metier : ils s'appuient sur l'API HTTP publique de
 * better-auth lui-meme, pas sur le code de cette tranche.
 *
 * Necessite TEST_APP_BASE_URL : le serveur est demarre sur la base de test par
 * le globalSetup de l'usine (tests/_factory/global-setup.ts).
 */
import { loadTestEnv, requireEnv } from "../_factory/env";

loadTestEnv();

export function baseUrl(): string {
  return requireEnv(["TEST_APP_BASE_URL"]).TEST_APP_BASE_URL ?? "";
}

/**
 * Controles d'origine de better-auth 1.7.7 (dist/api/middlewares/origin-check.mjs).
 *
 * 1. `sign-up/email` et `sign-in/email` (`formCsrfMiddleware`), sans cookie :
 *    - `Sec-Fetch-Site: cross-site` + `Sec-Fetch-Mode: navigate`
 *      -> 403 CROSS_SITE_NAVIGATION_LOGIN_BLOCKED ;
 *    - sinon, si `Sec-Fetch-Site`, `Sec-Fetch-Mode` ou `Sec-Fetch-Dest` est
 *      present, ou `Origin` ou `Referer` : validation forcee de l'origine ;
 *    - aucun de ces en-tetes : non controle (constat d'AC6, a valider par
 *      l'humain, D-158). Avec un cookie : validation de l'origine.
 * 2. `originCheckMiddleware` (toutes les routes, dist/api/index.mjs) valide
 *    l'origine de tout `POST` de better-auth qui porte un cookie : c'est
 *    pourquoi `authHeaders` pose aussi `Origin`.
 *
 * Validation de l'origine : origine = `Origin`, a defaut `Referer` ; absente
 * ou `null` -> 403 MISSING_OR_NULL_ORIGIN, sauf `Origin: null` avec
 * `Sec-Fetch-Site: same-origin` (origine deduite de la requete, acceptee) ;
 * hors de la liste de confiance -> 403 INVALID_ORIGIN.
 *
 * Pourquoi ce header : `fetch` sous Node envoie de lui-meme
 * `sec-fetch-mode: cors` ; sans `Origin`, la requete serait refusee en
 * MISSING_OR_NULL_ORIGIN. La valeur posee est `baseUrl()` tel quel
 * (= `TEST_APP_BASE_URL`), egale a l'origine de l'application tant que cette
 * URL n'a ni chemin ni barre finale. Elle est acceptee car, sans `baseURL` ni
 * `trustedOrigins` (apps/web/src/lib/auth.ts), better-auth fait confiance a
 * l'origine deduite de la requete recue.
 *
 * Ce controle n'est actif sur le serveur de test que depuis l'usine 1.6.5
 * (usine D-033 : serveur sans `TEST` ni `VITEST`) ; auparavant `isTest()` le
 * sautait (FRICTION 2026-10-28). Regle conservee : corriger cote client de
 * test, jamais desactiver la protection cote serveur.
 *
 * Preuve executable : tranche 014, `tests/auth/origin.test.ts`. `Referer`
 * seul, la navigation entre sites et `null` + `same-origin` sont decrits
 * d'apres le code, non prouves (D-158, point 5).
 */
function originHeader(): Record<string, string> {
  return { Origin: baseUrl() };
}

export interface AuthenticatedSession {
  cookie: string;
  userId: string;
  email: string;
}

let counter = 0;

/** Genere un e-mail unique par test pour eviter toute collision entre tests independants. */
export function uniqueEmail(prefix = "test-user"): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@example.test`;
}

/**
 * Inscrit un nouvel utilisateur via l'endpoint standard better-auth et retourne
 * le cookie de session utilisable pour les requetes authentifiees suivantes.
 */
export async function signUp(options?: {
  email?: string;
  password?: string;
  name?: string;
}): Promise<AuthenticatedSession> {
  const email = options?.email ?? uniqueEmail();
  const password = options?.password ?? "Correct-Horse-Battery-Staple-1";
  const name = options?.name ?? "Test User";

  const response = await fetch(`${baseUrl()}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...originHeader() },
    body: JSON.stringify({ email, password, name }),
  });

  if (!response.ok) {
    throw new Error(
      `Echec de l'inscription de test (${response.status}) : ${await response.text()}`,
    );
  }

  const cookie = extractCookie(response);
  const body = (await response.json()) as { user?: { id?: string } };
  const userId = body.user?.id;
  if (!cookie || !userId) {
    throw new Error(
      "Reponse d'inscription better-auth inattendue : cookie de session ou id utilisateur absent.",
    );
  }

  return { cookie, userId, email };
}

function extractCookie(response: Response): string | null {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) return null;
  // Ne conserve que la paire nom=valeur, sans les attributs (Path, HttpOnly, ...).
  return setCookie.split(";")[0] ?? null;
}

/** En-tetes d'une requete authentifiee avec la session fournie. */
export function authHeaders(session: AuthenticatedSession): Record<string, string> {
  return { Cookie: session.cookie, "Content-Type": "application/json", ...originHeader() };
}
