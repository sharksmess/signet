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
 * Necessite TEST_APP_BASE_URL (application deja demarree, cf. tests/helpers/db.ts).
 */

function baseUrl(): string {
  const url = process.env.TEST_APP_BASE_URL;
  if (!url) {
    throw new Error(
      "TEST_APP_BASE_URL n'est pas definie. Ces tests HTTP exigent une instance " +
        "reelle de l'application (apps/web) deja demarree et pointee vers la base " +
        "de test — voir tests/helpers/db.ts.",
    );
  }
  return url;
}

/**
 * better-auth refuse (403 MISSING_OR_NULL_ORIGIN / INVALID_ORIGIN) toute
 * requete vers `/api/auth/*` dont l'origine ne peut pas etre validee — la
 * protection CSRF reste active volontairement (regle du projet : la corriger
 * cote client de test, jamais en la desactivant cote serveur). Un client
 * navigateur envoie toujours `Origin` ; `fetch` sous Node ne le fait pas,
 * d'ou ce header pose explicitement, egal a `TEST_APP_BASE_URL` lui-meme
 * (aucun `baseURL` n'etant configure cote serveur, better-auth deduit son
 * origine de confiance de la requete entrante — cf. apps/web/src/lib/auth.ts
 * et l'avertissement "Base URL is not set" au demarrage).
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
