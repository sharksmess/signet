/**
 * Tranche 012 — AC11 (le jeton ne quitte pas le fragment), partie lue par le
 * serveur : la page `/invitations/accept` est une coquille sans donnee, identique
 * avec et sans `?token=<jeton reel>`, sans nom d'organisation ni adresse invitee
 * (P-4 ferme) ; sans session, les formulaires de connexion et d'inscription sont
 * incorpores (sans champ d'organisation) et aucun lien ne renvoie vers /connexion.
 * Les fonctions pures (lecture du fragment, requete d'acceptation) sont dans
 * requests.test.ts ; les verifications de source dans sources.test.ts.
 *
 * Le jeton vient du lien de l'e-mail depose dans la fausse messagerie (parcours
 * reel 003).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signUp } from "../helpers/auth";
import { closeAllPools } from "../helpers/db";
import { resetInvitationFakes, startInvitationFakes, stopInvitationFakes, tokenForms, type InvitationFakes } from "../helpers/invitations";
import { issueInvitation } from "../helpers/invitations-accept";
import { createOrganizationFixture } from "../helpers/fixtures";
import {
  allTags,
  expectAbsent,
  expectFullStatus,
  getFullPage,
  hasTestId,
  hrefsOf,
  tagsNamed,
  textOf,
  uniqueOrgName,
} from "../helpers/screens";

let fakes: InvitationFakes;

beforeAll(async () => {
  fakes = await startInvitationFakes();
});

beforeEach(() => {
  resetInvitationFakes(fakes);
});

afterAll(async () => {
  await stopInvitationFakes(fakes);
  await closeAllPools();
});

describe("AC11 : la page d'acceptation ne depend pas du jeton et ne contient aucune donnee d'invitation", () => {
  it("AC11 : la reponse complete (HTML et charge RSC) est identique avec et sans ?token=<jeton reel>, et ne contient ni le jeton, ni le nom de l'organisation, ni l'adresse invitee", async () => {
    const org = await createOrganizationFixture(uniqueOrgName("AC11"));
    const issued = await issueInvitation(fakes, { org, label: "AC11" });

    const without = await getFullPage("/invitations/accept", null);
    const withToken = await getFullPage(`/invitations/accept?token=${issued.token}`, null);

    expectFullStatus(without, 200, "AC11 : sans parametre");
    expectFullStatus(withToken, 200, "AC11 : avec ?token=");
    expect(withToken.html.text, "HTML identique").toBe(without.html.text);
    expect(withToken.rsc.text, "charge RSC identique").toBe(without.rsc.text);
    expectAbsent(withToken, [...tokenForms(issued.token), org.name, issued.email, org.organizationId, org.owner.email], "AC11 : donnees d'invitation");
  });

  it("AC11 : la meme page avec une session de l'invite (adresse correcte) ne contient ni le nom de l'organisation ni le jeton non plus, et montre l'adresse du compte connecte", async () => {
    const org = await createOrganizationFixture(uniqueOrgName("AC11-session"));
    const invited = await signUp();
    const issued = await issueInvitation(fakes, { org, email: invited.email, label: "AC11 session" });

    const full = await getFullPage(`/invitations/accept?token=${issued.token}`, invited);

    expectFullStatus(full, 200, "AC11 : page d'acceptation avec session");
    expectAbsent(full, [...tokenForms(issued.token), org.name, org.organizationId, org.owner.email], "AC11 : avec session, aucune donnee d'invitation avant l'acceptation");
    expect(textOf(full.html.text), "adresse du compte connecte").toContain(invited.email);
    expect(textOf(full.html.text), "bouton pour changer de compte (L-9)").toContain("Se deconnecter");
    expect(hasTestId(full.html.text, "sign-in-form"), "pas de formulaire de connexion avec une session").toBe(false);
  });

  it("AC11 : sans session, la page sert les formulaires de connexion et d'inscription incorpores", async () => {
    const full = await getFullPage("/invitations/accept", null);

    expectFullStatus(full, 200, "AC11 : sans session");
    expect(hasTestId(full.html.text, "sign-in-form"), "formulaire de connexion").toBe(true);
    expect(hasTestId(full.html.text, "sign-up-form"), "formulaire d'inscription").toBe(true);
  });

  it("AC11 : sans session, aucun lien ni renvoi vers /connexion ou /inscription (le fragment serait perdu)", async () => {
    const full = await getFullPage("/invitations/accept", null);

    expectFullStatus(full, 200, "AC11 : precondition");
    const hrefs = hrefsOf(full.html.text);
    expect(hrefs.filter((href) => /^\/(connexion|inscription)/.test(href)), `liens vers les autres pages. Corps brut : ${full.html.text}`).toEqual([]);
    expect(tagsNamed(full.html.text, "meta").filter((tag) => tag.attributes["http-equiv"]?.toLowerCase() === "refresh")).toEqual([]);
  });

  it("AC11 : sans session, l'inscription incorporee n'a aucun champ d'organisation : exactement adresse et mot de passe", async () => {
    const full = await getFullPage("/invitations/accept", null);

    expectFullStatus(full, 200, "AC11 : precondition");
    const fields = ["input", "textarea", "select"].flatMap((name) => tagsNamed(full.html.text, name)).filter((tag) => tag.attributes.type !== "hidden");
    const kinds = fields.map((tag) => `${tag.name}:${tag.attributes.type ?? "text"}`).sort();
    // Un formulaire de connexion (adresse, mot de passe) + un d'inscription (adresse, mot de passe) : aucun champ texte libre.
    expect(kinds, `champs de la page. Corps brut : ${full.html.text}`).toEqual(["input:email", "input:email", "input:password", "input:password"]);
    expect(allTags(full.html.text).some((tag) => tag.name === "input" && (tag.attributes.type ?? "text") === "text")).toBe(false);
  });
});
