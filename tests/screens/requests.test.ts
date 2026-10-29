/**
 * Tranche 012 — AC2 (b, c, d : enchainement de l'inscription, `fetch` injecte) et
 * AC11 (jeton lu dans le fragment seulement, requete d'acceptation = jeton dans le
 * corps seulement), plus la forme des requetes des formulaires.
 *
 * Import attendu : apps/web/src/ui/requests.ts (pas d'alias `@/`), signatures :
 *   type FormRequest = { path: string; method: "POST"; headers: { "Content-Type": "application/json" }; body: string }
 *   type FetchLike = (input: string, init: { method: string; headers: Record<string,string>; body: string }) => Promise<Response>
 *   type SignUpOutcome = { kind: "created"; destination: string }
 *                      | { kind: "creation_failed"; destination: string }
 *                      | { kind: "refused"; message: string }
 *   buildSignInRequest(input: { email; password }): FormRequest              -> POST /api/auth/sign-in/email, corps { email, password }
 *   buildSignUpRequest(input: { email; password }): FormRequest              -> POST /api/auth/sign-up/email, corps { email, password, name: email }
 *   buildCreateOrganizationRequest(input: { name }): FormRequest             -> POST /api/organizations, corps { name }
 *   buildCreateCollectionRequest(organizationId, input: { name }): FormRequest -> POST /api/organizations/:id/collections
 *   buildInviteRequest(organizationId, input: { email }): FormRequest        -> POST /api/organizations/:id/invitations
 *   buildAddLinkRequest(organizationId, collectionId, input: { url; title }): FormRequest -> POST .../collections/:cid/links
 *   buildAcceptRequest(token: string): FormRequest                           -> POST /api/invitations/accept, corps { token } seulement
 *   buildSignOutRequest(): FormRequest                                       -> POST /api/auth/sign-out, corps {}
 *   tokenFromFragment(hash: string): string | null                           -> `#token=<jeton>` (valeur de `location.hash`), sinon null
 *   signUpWithOrganization(fetchFn, { email, password, organizationName }): Promise<SignUpOutcome>
 *     1. POST sign-up (name = email) ; refus (statut non 2xx ou erreur reseau) -> { kind: "refused", message: chooseMessage("sign-up", ...) }, AUCUN autre appel ;
 *     2. sinon UN SEUL POST /api/organizations { name: organizationName } (tel que saisi) ;
 *        succes (2xx avec `id` texte) -> { kind: "created", destination: `/organisations/${id}` } ;
 *        tout autre issue (4xx, 5xx, erreur reseau, 2xx sans id) -> { kind: "creation_failed", destination: "/organisations?creation=echec" } ;
 *     3. jamais d'appel supplementaire.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { expectJsonPost, fakeFetch, loadMessages, loadRequests, jsonBodyOf, type FakeReply } from "../helpers/screens-ui";

const EMAIL = "inscrit-1@exemple.invalid";
const PASSWORD = "Mot-De-Passe-Invente-1";
const ORG_NAME = "  Org-Test-Inscription  ";
const ORG_ID = randomUUID();
const COL_ID = randomUUID();

describe("formulaires : construction des requetes (aucune valeur dans l'adresse, tout dans le corps JSON)", () => {
  it("connexion, inscription (name = adresse), deconnexion", async () => {
    const r = await loadRequests();
    expectJsonPost(r.buildSignInRequest({ email: EMAIL, password: PASSWORD }), "/api/auth/sign-in/email", { email: EMAIL, password: PASSWORD }, "connexion");
    expectJsonPost(r.buildSignUpRequest({ email: EMAIL, password: PASSWORD }), "/api/auth/sign-up/email", { email: EMAIL, password: PASSWORD, name: EMAIL }, "inscription");
    expectJsonPost(r.buildSignOutRequest(), "/api/auth/sign-out", {}, "deconnexion");
  });

  it("organisation, collection, invitation, lien : chemin avec les identifiants, corps avec les seuls champs saisis", async () => {
    const r = await loadRequests();
    expectJsonPost(r.buildCreateOrganizationRequest({ name: "Org-Test-1" }), "/api/organizations", { name: "Org-Test-1" }, "organisation");
    expectJsonPost(r.buildCreateCollectionRequest(ORG_ID, { name: "Veille" }), `/api/organizations/${ORG_ID}/collections`, { name: "Veille" }, "collection");
    expectJsonPost(r.buildInviteRequest(ORG_ID, { email: "invite@exemple.invalid" }), `/api/organizations/${ORG_ID}/invitations`, { email: "invite@exemple.invalid" }, "invitation");
    expectJsonPost(
      r.buildAddLinkRequest(ORG_ID, COL_ID, { url: "https://exemple.invalid/a", title: "Titre" }),
      `/api/organizations/${ORG_ID}/collections/${COL_ID}/links`,
      { url: "https://exemple.invalid/a", title: "Titre" },
      "lien",
    );
  });

  it("les valeurs saisies ne sont jamais placees dans l'adresse de la requete (pas de ? ni de #)", async () => {
    const r = await loadRequests();
    const requests = [
      r.buildSignInRequest({ email: EMAIL, password: PASSWORD }),
      r.buildSignUpRequest({ email: EMAIL, password: PASSWORD }),
      r.buildCreateOrganizationRequest({ name: "a b&c=d?e#f" }),
      r.buildInviteRequest(ORG_ID, { email: EMAIL }),
      r.buildAddLinkRequest(ORG_ID, COL_ID, { url: "https://exemple.invalid/?x=1#y", title: "a&b" }),
      r.buildAcceptRequest("jeton-invente"),
    ];
    for (const request of requests) {
      expect(request.path, request.path).not.toMatch(/[?#]/);
      expect(request.path).not.toContain(EMAIL);
      expect(request.path).not.toContain(PASSWORD);
    }
  });

  it("une valeur avec guillemets et caracteres speciaux est serialisee en JSON valide, sans alteration", async () => {
    const r = await loadRequests();
    const name = 'Org-Test-"quote" <b> \\ ‮';
    expect(jsonBodyOf(r.buildCreateOrganizationRequest({ name }), "organisation")).toEqual({ name });
  });
});

describe("AC11 : le jeton est lu dans le fragment seulement et envoye dans le corps seulement", () => {
  it("AC11 : tokenFromFragment lit #token=<jeton> dans le fragment", async () => {
    const r = await loadRequests();
    const token = "A".repeat(42) + "Q";
    expect(r.tokenFromFragment(`#token=${token}`)).toBe(token);
    expect(r.tokenFromFragment(`#token=${token}&autre=1`)).toBe(token);
  });

  it("AC11 : fragment absent, vide, sans jeton ou jeton vide -> null (la page affiche « Lien d'invitation incomplet », aucun appel)", async () => {
    const r = await loadRequests();
    for (const hash of ["", "#", "#autre=1", "#token=", "#tokens=abc", "#x=1&y=2"]) {
      expect(r.tokenFromFragment(hash), JSON.stringify(hash)).toBeNull();
    }
  });

  it("AC11 : seul le fragment est lu : une chaine de requete (?token=) n'est jamais un jeton", async () => {
    const r = await loadRequests();
    expect(r.tokenFromFragment("?token=abc")).toBeNull();
    expect(r.tokenFromFragment("?token=abc#autre=1")).toBeNull();
  });

  it("AC11 : la requete d'acceptation est POST /api/invitations/accept avec le jeton dans le corps SEUL, jamais dans l'adresse ni les en-tetes", async () => {
    const r = await loadRequests();
    const token = "B".repeat(42) + "A";
    const request = r.buildAcceptRequest(token);
    expectJsonPost(request, "/api/invitations/accept", { token }, "acceptation");
    expect(Object.keys(jsonBodyOf(request, "acceptation") as object)).toEqual(["token"]);
    expect(request.path).not.toContain(token);
    expect(JSON.stringify(request.headers)).not.toContain(token);
  });
});

describe("AC2 : enchainement de l'inscription avec organisation (fetch injecte)", () => {
  const OK_SIGNUP: FakeReply = { status: 200, body: { token: "t", user: { id: randomUUID() } } };

  it("AC2 (b) : sign-up/email avec name = adresse, puis UN SEUL POST /api/organizations avec le nom saisi tel quel ; rend la page de l'organisation creee", async () => {
    const r = await loadRequests();
    const { fetchFn, calls } = fakeFetch([OK_SIGNUP, { status: 201, body: { id: ORG_ID, name: ORG_NAME.trim(), slug: "s", createdAt: new Date().toISOString(), role: "owner" } }]);

    const outcome = await r.signUpWithOrganization(fetchFn, { email: EMAIL, password: PASSWORD, organizationName: ORG_NAME });

    expect(outcome).toEqual({ kind: "created", destination: `/organisations/${ORG_ID}` });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /api/auth/sign-up/email", "POST /api/organizations"]);
    expect(JSON.parse(calls[0]?.body ?? "null")).toEqual({ email: EMAIL, password: PASSWORD, name: EMAIL });
    expect(JSON.parse(calls[1]?.body ?? "null")).toEqual({ name: ORG_NAME });
    for (const call of calls) expect(call.headers["Content-Type"]).toBe("application/json");
  });

  it("AC2 (c) : inscription refusee (compte existant, mot de passe court, 429, 500, reseau) -> aucune creation tentee, texte fixe", async () => {
    const r = await loadRequests();
    const messages = await loadMessages();
    // Textes exacts de la table « Messages d'erreur » du contrat.
    const generic = "Une erreur est survenue. Reessayer.";
    const refusals: { refusal: FakeReply; text: string }[] = [
      { refusal: { status: 422, body: { code: "USER_ALREADY_EXISTS", message: `Adresse ${EMAIL} deja utilisee` } }, text: "Un compte existe deja pour cette adresse." },
      { refusal: { status: 400, body: { code: "PASSWORD_TOO_SHORT", message: "Password too short" } }, text: "Adresse e-mail invalide, ou mot de passe trop court (8 caracteres minimum)." },
      { refusal: { status: 429, body: { message: "Too many requests" } }, text: "Trop de tentatives. Reessayer dans quelques minutes." },
      { refusal: { status: 500, body: { message: "boom" } }, text: generic },
      { refusal: { throws: true }, text: generic },
    ];
    for (const { refusal, text } of refusals) {
      const { fetchFn, calls } = fakeFetch([refusal, { status: 201, body: { id: ORG_ID } }]);

      const outcome = await r.signUpWithOrganization(fetchFn, { email: EMAIL, password: PASSWORD, organizationName: ORG_NAME });

      expect(calls, `refus ${JSON.stringify(refusal)} : un seul appel (l'inscription), aucune creation`).toHaveLength(1);
      expect(calls[0]?.url).toBe("/api/auth/sign-up/email");
      expect(outcome.kind).toBe("refused");
      if (outcome.kind !== "refused") throw new Error(`issue inattendue : ${JSON.stringify(outcome)}`);
      expect(messages.FIXED_MESSAGES, `le message ${JSON.stringify(outcome.message)} est dans la liste fermee`).toContain(outcome.message);
      expect(outcome.message, `texte exact attendu pour ${JSON.stringify(refusal)}`).toBe(text);
      expect(outcome.message).not.toContain(EMAIL);
      expect(outcome.message).not.toContain(PASSWORD);
      expect(outcome.message).not.toContain(ORG_NAME.trim());
    }
  });

  it("AC2 (d) : creation refusee ou en erreur apres inscription reussie -> UN seul POST /api/organizations (aucune seconde tentative), destination /organisations?creation=echec", async () => {
    const r = await loadRequests();
    const failures: FakeReply[] = [
      { status: 422, body: { code: "VALIDATION_FAILED", message: "[Zod ...]" } },
      { status: 401, body: { code: "UNAUTHENTICATED", message: "Aucune session valide." } },
      { status: 500, body: { message: "boom" } },
      { status: 503, body: { code: "SERVICE_UNAVAILABLE", message: "x" } },
      { throws: true },
      { status: 201, body: { name: "sans identifiant" } },
    ];
    for (const failure of failures) {
      // Des reponses de rechange sont prevues : si l'implementation reessayait, le nombre d'appels le montrerait.
      const { fetchFn, calls } = fakeFetch([OK_SIGNUP, failure, { status: 201, body: { id: ORG_ID } }, { status: 201, body: { id: ORG_ID } }]);

      const outcome = await r.signUpWithOrganization(fetchFn, { email: EMAIL, password: PASSWORD, organizationName: ORG_NAME });

      expect(outcome, `echec ${JSON.stringify(failure)}`).toEqual({ kind: "creation_failed", destination: "/organisations?creation=echec" });
      expect(calls.filter((c) => c.url === "/api/organizations"), "un seul POST /api/organizations").toHaveLength(1);
      expect(calls, "deux appels au total : inscription, creation").toHaveLength(2);
    }
  });

  it("AC2 (d) : la destination d'echec ne contient ni le nom de l'organisation ni l'adresse (aucune valeur reprise)", async () => {
    const r = await loadRequests();
    const { fetchFn } = fakeFetch([OK_SIGNUP, { status: 500, body: {} }]);
    const outcome = await r.signUpWithOrganization(fetchFn, { email: EMAIL, password: PASSWORD, organizationName: ORG_NAME });
    if (outcome.kind !== "creation_failed") throw new Error(`issue inattendue : ${JSON.stringify(outcome)}`);
    expect(outcome.destination).not.toContain(EMAIL);
    expect(outcome.destination).not.toContain("Org-Test");
  });
});
