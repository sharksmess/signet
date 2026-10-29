/**
 * Tranche 012 — AC13 (soumission depuis un autre site) et releve des refus
 * reels de better-auth pour la table des messages (AC14, « code better-auth a
 * relever par les tests »).
 *
 * Ces tests decrivent des comportements DEJA presents (cookie better-auth,
 * 401 sans session) : ils peuvent passer avant l'implementation des pages,
 * c'est voulu (caracterisation de la garde sur laquelle repose D-144 Q-2, pas
 * une verification de tranche). Les tests de messages, eux, exigent
 * ui/messages.ts.
 *
 * Clause retiree par D-146 : « better-auth refuse une connexion d'Origin
 * etrangere (403) ». Vitest pose TEST=true, herite par le serveur de test, et
 * better-auth saute alors son controle d'origine ; le test ne pouvait pas
 * passer ici. Retablissement au backlog (correction d'usine 1.6.5).
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { baseUrl, signUp, uniqueEmail } from "../helpers/auth";
import { readResponse, expectError } from "../helpers/billing";
import { readCollections } from "../helpers/collections";
import { closeAllPools } from "../helpers/db";
import { createOrganizationFixture } from "../helpers/fixtures";
import { countLinks } from "../helpers/links";
import { loadMessages } from "../helpers/screens-ui";

afterAll(async () => {
  await closeAllPools();
});

const FOREIGN_ORIGIN = "https://autre-site.invalid";
const PASSWORD = "Mot-De-Passe-Invente-1";

function sessionCookiesOf(response: Response): string[] {
  return response.headers.getSetCookie().filter((cookie) => /session_token/i.test(cookie));
}

function expectLaxHttpOnly(cookies: readonly string[], label: string, rawHeaders: string): void {
  expect(cookies.length, `${label} : un cookie de session est pose. En-tetes Set-Cookie : ${rawHeaders}`).toBeGreaterThan(0);
  for (const cookie of cookies) {
    const attributes = cookie.split(";").map((part) => part.trim().toLowerCase());
    expect(attributes, `${label} : HttpOnly`).toContain("httponly");
    expect(attributes, `${label} : SameSite=Lax`).toContain("samesite=lax");
  }
}

describe("AC13 : cookie de session HttpOnly et SameSite=Lax", () => {
  it("AC13 : la connexion (sign-in/email) pose un cookie de session HttpOnly et SameSite=Lax", async () => {
    const account = await signUp({ password: PASSWORD });

    const response = await fetch(`${baseUrl()}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl() },
      body: JSON.stringify({ email: account.email, password: PASSWORD }),
    });

    const raw = response.headers.getSetCookie().join(" | ");
    expect(response.status, `connexion : corps ${await response.clone().text()}`).toBe(200);
    expectLaxHttpOnly(sessionCookiesOf(response), "connexion", raw);
  });

  it("AC13 : l'inscription (sign-up/email) pose un cookie de session HttpOnly et SameSite=Lax", async () => {
    const response = await fetch(`${baseUrl()}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl() },
      body: JSON.stringify({ email: uniqueEmail("cookie"), password: PASSWORD, name: "Test User" }),
    });

    const raw = response.headers.getSetCookie().join(" | ");
    expect(response.status, `inscription : corps ${await response.clone().text()}`).toBe(200);
    expectLaxHttpOnly(sessionCookiesOf(response), "inscription", raw);
  });
});

describe("AC13 : une ecriture sans cookie (forme d'une soumission inter-sites) recoit 401 et ne modifie rien", () => {
  it("AC13 : POST collections sans cookie, Origin etrangere, type de contenu de formulaire : 401, aucune collection creee", async () => {
    const org = await createOrganizationFixture("Org-Test-AC13-collection");
    const name = `Collection-Test-AC13-${randomUUID().slice(0, 8)}`;
    const before = (await readCollections(org.organizationId)).length;

    const result = await readResponse(
      await fetch(`${baseUrl()}/api/organizations/${org.organizationId}/collections`, {
        method: "POST",
        headers: { "Content-Type": "text/plain", Origin: FOREIGN_ORIGIN },
        body: JSON.stringify({ name }),
      }),
    );

    expectError(result, 401, "UNAUTHENTICATED", "POST collections sans cookie");
    expect(await readCollections(org.organizationId)).toHaveLength(before);
    expect(await readCollections(org.organizationId, name)).toHaveLength(0);
  });

  it("AC13 : POST organisations et POST invitations sans cookie : 401 chacun, aucune organisation creee", async () => {
    const org = await createOrganizationFixture("Org-Test-AC13-invitation");
    const name = `Org-Test-AC13-sans-cookie-${randomUUID().slice(0, 8)}`;

    const created = await readResponse(
      await fetch(`${baseUrl()}/api/organizations`, {
        method: "POST",
        headers: { "Content-Type": "text/plain", Origin: FOREIGN_ORIGIN },
        body: JSON.stringify({ name }),
      }),
    );
    const invited = await readResponse(
      await fetch(`${baseUrl()}/api/organizations/${org.organizationId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "text/plain", Origin: FOREIGN_ORIGIN },
        body: JSON.stringify({ email: "invite-ac13@exemple.invalid" }),
      }),
    );

    expectError(created, 401, "UNAUTHENTICATED", "POST organisations sans cookie");
    expectError(invited, 401, "UNAUTHENTICATED", "POST invitations sans cookie");
  });

  it("AC13 : POST lien sans cookie : 401, aucun lien cree", async () => {
    const org = await createOrganizationFixture("Org-Test-AC13-lien");
    const before = await countLinks(org.organizationId);

    const result = await readResponse(
      await fetch(`${baseUrl()}/api/organizations/${org.organizationId}/collections/${randomUUID()}/links`, {
        method: "POST",
        headers: { "Content-Type": "text/plain", Origin: FOREIGN_ORIGIN },
        body: JSON.stringify({ url: "https://exemple.invalid/ac13", title: "Titre-Test-AC13" }),
      }),
    );

    expectError(result, 401, "UNAUTHENTICATED", "POST lien sans cookie");
    expect(await countLinks(org.organizationId)).toBe(before);
  });
});

describe("AC14 : refus reels de better-auth -> texte fixe de la table", () => {
  it("AC14 : un compte existant (reponse reelle de sign-up/email) donne « Un compte existe deja pour cette adresse. »", async () => {
    const { chooseMessage } = await loadMessages();
    const account = await signUp({ password: PASSWORD });

    const second = await readResponse(
      await fetch(`${baseUrl()}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: baseUrl() },
        body: JSON.stringify({ email: account.email, password: PASSWORD, name: account.email }),
      }),
    );

    expect(second.status, `second sign-up : corps brut ${second.text}`).toBeGreaterThanOrEqual(400);
    expect(second.status).toBeLessThan(500);
    expect(chooseMessage("sign-up", second.status, second.body)).toBe("Un compte existe deja pour cette adresse.");
  });

  it("AC14 : un mot de passe trop court (reponse reelle) donne le texte d'adresse ou de mot de passe invalide", async () => {
    const { chooseMessage } = await loadMessages();

    const refused = await readResponse(
      await fetch(`${baseUrl()}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: baseUrl() },
        body: JSON.stringify({ email: uniqueEmail("court"), password: "abc", name: "x" }),
      }),
    );

    expect(refused.status, `sign-up mot de passe court : corps brut ${refused.text}`).toBeGreaterThanOrEqual(400);
    expect(chooseMessage("sign-up", refused.status, refused.body)).toBe(
      "Adresse e-mail invalide, ou mot de passe trop court (8 caracteres minimum).",
    );
  });

  it("AC14 : une adresse malformee (reponse reelle) donne le meme texte", async () => {
    const { chooseMessage } = await loadMessages();

    const refused = await readResponse(
      await fetch(`${baseUrl()}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: baseUrl() },
        body: JSON.stringify({ email: "pas-une-adresse", password: PASSWORD, name: "x" }),
      }),
    );

    expect(refused.status, `sign-up adresse malformee : corps brut ${refused.text}`).toBeGreaterThanOrEqual(400);
    expect(chooseMessage("sign-up", refused.status, refused.body)).toBe(
      "Adresse e-mail invalide, ou mot de passe trop court (8 caracteres minimum).",
    );
  });

  it("AC14 : un mauvais mot de passe (reponse reelle de sign-in/email, 401) donne « Adresse ou mot de passe incorrect. »", async () => {
    const { chooseMessage } = await loadMessages();
    const account = await signUp({ password: PASSWORD });

    const refused = await readResponse(
      await fetch(`${baseUrl()}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: baseUrl() },
        body: JSON.stringify({ email: account.email, password: "Mauvais-Mot-De-Passe-1" }),
      }),
    );

    expect(refused.status, `sign-in mauvais mot de passe : corps brut ${refused.text}`).toBe(401);
    expect(chooseMessage("sign-in", refused.status, refused.body)).toBe("Adresse ou mot de passe incorrect.");
  });
});
