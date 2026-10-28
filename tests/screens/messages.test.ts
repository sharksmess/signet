/**
 * Tranche 012 — AC14 (choix du message, fonction pure) et AC12 (chaque code du
 * contrat `acceptInvitation` a un texte fixe dans la table).
 *
 * Import attendu : apps/web/src/ui/messages.ts, signatures :
 *   type FormId = "sign-in" | "sign-up" | "create-organization" | "create-collection" | "invite" | "add-link" | "accept"
 *   const FIXED_MESSAGES: readonly string[]            // liste fermee de tous les textes affichables
 *   function chooseMessage(form: FormId, status: number, body: unknown): string
 *     // status 0 = erreur reseau ; body = corps JSON decode (objet { code, message }), texte, ou undefined.
 *     // Rend TOUJOURS un element de FIXED_MESSAGES, jamais le message brut de la reponse s'il n'y figure pas.
 *
 * Les textes « de la route » sont ceux de apps/web/src/lib/errors.ts (recopies dans messages.ts) :
 * le test les relit depuis ce module, qui ne change pas dans la tranche.
 */
import { describe, expect, it } from "vitest";
import { acceptInvitation } from "../../docs/02-architecture/api-contracts/invitations";
import {
  alreadyMember,
  alreadyMemberOnAcceptance,
  collectionNameTaken,
  collectionNotFound,
  freeTierQuotaExceeded,
  insufficientRole,
  invitationAlreadyPending,
  invitationAlreadyUsed,
  invitationEmailMismatch,
  invitationExpired,
  invitationNotFound,
  organizationNotFound,
  serviceUnavailable,
} from "../../apps/web/src/lib/errors";
import { loadMessages, type FormId } from "../helpers/screens-ui";

const GENERIC = "Une erreur est survenue. Reessayer.";
const SESSION_EXPIRED = "Session expiree.";
const THROTTLED = "Trop de tentatives. Reessayer dans quelques minutes.";
const SIGN_IN_FAILED = "Adresse ou mot de passe incorrect.";
const SIGN_UP_REFUSED = "Adresse e-mail invalide, ou mot de passe trop court (8 caracteres minimum).";
const ORGANIZATION_NAME_INVALID = "Nom d'organisation invalide : 1 a 120 caracteres, espaces de bord exclus.";
const COLLECTION_NAME_INVALID = "Nom de collection invalide : 1 a 100 caracteres, espaces de bord exclus.";
const INVITE_EMAIL_INVALID = "Adresse e-mail invalide.";
const URL_INVALID =
  "URL invalide : schema http ou https en minuscules, nom d'hote obligatoire, sans identifiants, espaces ni caracteres de controle, 8 a 2048 caracteres.";
const TITLE_INVALID = "Titre invalide : 1 a 200 caracteres, espaces de bord exclus, sans caractere nul.";
const LINK_INVALID = "Lien d'invitation invalide.";

type Case = readonly [form: FormId, status: number, code: string | undefined, expected: string];

const fromRoute = (error: { status: number; code: string; message: string }, form: FormId): Case => [form, error.status, error.code, error.message];

const TABLE: readonly Case[] = [
  ["sign-in", 401, undefined, SIGN_IN_FAILED],
  ["sign-in", 429, undefined, THROTTLED],
  ["sign-up", 429, undefined, THROTTLED],
  ["create-organization", 422, "VALIDATION_FAILED", ORGANIZATION_NAME_INVALID],
  ["create-collection", 422, "VALIDATION_FAILED", COLLECTION_NAME_INVALID],
  fromRoute(collectionNameTaken(), "create-collection"),
  ["invite", 422, "VALIDATION_FAILED", INVITE_EMAIL_INVALID],
  fromRoute(invitationAlreadyPending(), "invite"),
  fromRoute(alreadyMember(), "invite"),
  fromRoute(serviceUnavailable(), "invite"),
  fromRoute(insufficientRole(), "invite"),
  ["add-link", 409, "FREE_TIER_QUOTA_EXCEEDED", freeTierQuotaExceeded().message],
  fromRoute(collectionNotFound(), "add-link"),
  fromRoute(invitationNotFound(), "accept"),
  fromRoute(invitationExpired(), "accept"),
  fromRoute(invitationAlreadyUsed(), "accept"),
  fromRoute(invitationEmailMismatch(), "accept"),
  fromRoute(alreadyMemberOnAcceptance(), "accept"),
  ["accept", 422, "VALIDATION_FAILED", LINK_INVALID],
];

describe("AC14 : choix du message, texte fixe attendu pour chaque formulaire et chaque code de la table", () => {
  it.each(TABLE)("AC14 : %s, statut %i, code %s -> texte fixe", async (form, status, code, expected) => {
    const { chooseMessage } = await loadMessages();
    const body = code === undefined ? { message: "message brut du serveur" } : { code, message: expected };
    expect(chooseMessage(form, status, body)).toBe(expected);
  });

  it("AC14 : les textes de la route sont ceux de lib/errors (recopies sans alteration)", async () => {
    const { chooseMessage } = await loadMessages();
    expect(chooseMessage("add-link", 422, { code: "VALIDATION_FAILED", message: URL_INVALID })).toBe(URL_INVALID);
    expect(chooseMessage("add-link", 422, { code: "VALIDATION_FAILED", message: TITLE_INVALID })).toBe(TITLE_INVALID);
  });

  it("AC14 : le meme code donne le texte du formulaire (ALREADY_MEMBER : invitation d'un membre vs acceptation par un membre)", async () => {
    const { chooseMessage } = await loadMessages();
    expect(chooseMessage("invite", 409, { code: "ALREADY_MEMBER", message: "x" })).toBe(alreadyMember().message);
    expect(chooseMessage("accept", 409, { code: "ALREADY_MEMBER", message: "x" })).toBe(alreadyMemberOnAcceptance().message);
  });

  it.each(["create-organization", "create-collection", "invite", "add-link", "accept"] as const)(
    "AC14 : %s, 401 -> « Session expiree. »",
    async (form) => {
      const { chooseMessage } = await loadMessages();
      expect(chooseMessage(form, 401, { code: "UNAUTHENTICATED", message: "Aucune session valide." })).toBe(SESSION_EXPIRED);
    },
  );

  it.each(["create-organization", "create-collection", "invite", "add-link"] as const)(
    "AC14 : %s, 404 ORGANIZATION_NOT_FOUND -> « Organisation introuvable. »",
    async (form) => {
      const { chooseMessage } = await loadMessages();
      expect(chooseMessage(form, 404, { code: "ORGANIZATION_NOT_FOUND", message: organizationNotFound().message })).toBe("Organisation introuvable.");
    },
  );

  it.each(["sign-in", "sign-up", "create-organization", "create-collection", "invite", "add-link", "accept"] as const)(
    "AC14 : %s, autre statut (500, 502, 418) et erreur reseau (0) -> « Une erreur est survenue. Reessayer. »",
    async (form) => {
      const { chooseMessage } = await loadMessages();
      for (const status of [500, 502, 418]) expect(chooseMessage(form, status, { code: "AUTRE", message: "detail interne" }), `statut ${status}`).toBe(GENERIC);
      expect(chooseMessage(form, 0, undefined)).toBe(GENERIC);
      expect(chooseMessage(form, 500, "<html>Erreur</html>")).toBe(GENERIC);
    },
  );

  it("AC14 : inscription, refus de better-auth (autre qu'un compte existant, 429) -> texte d'adresse ou de mot de passe invalide", async () => {
    const { chooseMessage } = await loadMessages();
    expect(chooseMessage("sign-up", 400, { code: "PASSWORD_TOO_SHORT", message: "Password too short" })).toBe(SIGN_UP_REFUSED);
    expect(chooseMessage("sign-up", 400, { code: "INVALID_EMAIL", message: "Invalid email" })).toBe(SIGN_UP_REFUSED);
  });

  it("AC14 : une reponse dont le message contient la valeur soumise donne le texte fixe du formulaire, jamais ce message", async () => {
    const { chooseMessage } = await loadMessages();
    const submitted = "Org-Test-<img src=x onerror=alert(1)>-VALEUR-SOUMISE";
    const cases: readonly [FormId, number, string][] = [
      ["create-organization", 422, "VALIDATION_FAILED"],
      ["create-collection", 422, "VALIDATION_FAILED"],
      ["invite", 422, "VALIDATION_FAILED"],
      ["add-link", 422, "VALIDATION_FAILED"],
      ["accept", 422, "VALIDATION_FAILED"],
      ["sign-up", 422, "USER_ALREADY_EXISTS"],
      ["sign-in", 401, "INVALID_EMAIL_OR_PASSWORD"],
    ];
    for (const [form, status, code] of cases) {
      const message = chooseMessage(form, status, { code, message: `Valeur invalide : ${submitted}` });
      expect(message, `${form} ${status}`).not.toContain(submitted);
      expect(message, `${form} ${status}`).not.toContain("VALEUR-SOUMISE");
      expect(message, `${form} ${status}`).not.toContain("Valeur invalide");
    }
    // Cas des 422 de createOrganization et createInvitation : la route renvoie le message de Zod ; jamais affiche.
    const zod = '[{"origin":"string","code":"too_big","maximum":120,"path":["name"],"message":"Too big: expected string to have <=120 characters"}]';
    expect(chooseMessage("create-organization", 422, { code: "VALIDATION_FAILED", message: zod })).toBe(ORGANIZATION_NAME_INVALID);
    expect(chooseMessage("invite", 422, { code: "VALIDATION_FAILED", message: zod })).toBe(INVITE_EMAIL_INVALID);
  });

  it("AC14 : un texte hors liste, meme avec un code connu, n'est jamais repris ; le resultat est toujours dans la liste fermee", async () => {
    const { chooseMessage, FIXED_MESSAGES } = await loadMessages();
    const outcomes = [
      chooseMessage("add-link", 422, { code: "VALIDATION_FAILED", message: "Texte invente hors liste" }),
      chooseMessage("create-collection", 409, { code: "COLLECTION_NAME_TAKEN", message: "Texte invente hors liste" }),
      chooseMessage("accept", 410, { code: "INVITATION_EXPIRED", message: "Texte invente hors liste" }),
      chooseMessage("invite", 503, { code: "SERVICE_UNAVAILABLE", message: "Texte invente hors liste" }),
      chooseMessage("add-link", 500, { message: "Texte invente hors liste" }),
    ];
    for (const outcome of outcomes) {
      expect(outcome).not.toContain("Texte invente hors liste");
      expect(FIXED_MESSAGES).toContain(outcome);
    }
  });

  it("AC14 : corps absent, texte brut ou de forme inattendue : message fixe, aucune exception", async () => {
    const { chooseMessage, FIXED_MESSAGES } = await loadMessages();
    for (const body of [undefined, null, "", "<html>", 42, [], { code: 12 }, { message: { x: 1 } }]) {
      for (const status of [0, 401, 404, 409, 422, 500]) {
        expect(FIXED_MESSAGES, `statut ${status}, corps ${JSON.stringify(body)}`).toContain(chooseMessage("accept", status, body));
      }
    }
  });

  it("AC14 : tous les elements de la liste fermee sont des textes non vides, sans doublon", async () => {
    const { FIXED_MESSAGES } = await loadMessages();
    expect(FIXED_MESSAGES.length).toBeGreaterThan(10);
    for (const text of FIXED_MESSAGES) expect(text.trim().length).toBeGreaterThan(0);
    expect(new Set(FIXED_MESSAGES).size).toBe(FIXED_MESSAGES.length);
  });
});

describe("AC12 : chaque code d'erreur du contrat acceptInvitation a un texte fixe dans la table", () => {
  it("AC12 : pour chaque erreur de acceptInvitation (hors 401, traite comme « Session expiree. »), le texte est dans la liste fermee et n'est pas le texte generique", async () => {
    const { chooseMessage, FIXED_MESSAGES } = await loadMessages();
    expect(acceptInvitation.errors.length).toBeGreaterThanOrEqual(6);
    for (const error of acceptInvitation.errors) {
      const message = chooseMessage("accept", error.status, { code: error.code, message: "message brut a ne pas reprendre" });
      expect(FIXED_MESSAGES, `${error.status} ${error.code}`).toContain(message);
      expect(message, `${error.status} ${error.code} : pas le texte generique`).not.toBe(GENERIC);
      expect(message).not.toContain("message brut");
    }
  });

  it("AC12 : le 401 d'acceptation (session absente) donne « Session expiree. »", async () => {
    const { chooseMessage } = await loadMessages();
    expect(acceptInvitation.errors.some((e) => e.status === 401)).toBe(true);
    expect(chooseMessage("accept", 401, { code: "UNAUTHENTICATED", message: "Aucune session valide." })).toBe(SESSION_EXPIRED);
  });

  it("AC12 : les textes des codes d'acceptation sont deux a deux distincts", async () => {
    const { chooseMessage } = await loadMessages();
    const texts = acceptInvitation.errors.map((e) => chooseMessage("accept", e.status, { code: e.code, message: "x" }));
    expect(new Set(texts).size).toBe(texts.length);
  });
});
