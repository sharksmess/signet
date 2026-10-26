/**
 * Tranche 006, reouverture D-111 : preuves automatiques de trois decisions
 * locales que review-006 (A CORRIGER 1 a 3) a trouvees sans test.
 *
 * - D-106 : forme canonique du jeton. Une variante non canonique d'un jeton
 *   reellement emis (meme 32 octets, dernier caractere dont seuls les 2 bits
 *   ignores different) est un jeton malforme : 404 identique, rien de consomme.
 * - D-107 : textes fixes des erreurs de `POST /api/invitations/accept`, compares a
 *   la liste EXACTE du registre (ecrite ici en clair, jamais importee de
 *   `lib/errors.ts` : un texte modifie doit faire echouer le test) ; 422 a un seul
 *   corps, jamais le message de Zod.
 * - D-108 : apres une consommation refusee, invitation `pending` a l'adresse de la
 *   session -> 401, sinon 403 ; et traduction `SG002` / `23503` -> 401. La route ne
 *   peut pas atteindre ces branches (un compte supprime perd sa session des
 *   `getSession`) : `acceptInvitation` est appelee dans le processus de test, sur la
 *   base de test, sous `signet_app`.
 *
 * Chaque test a ete verifie par mutation temporaire du code de production (journal
 * `docs/03-slices/006-progress.md`, « Reouverture D-111 »). Valeurs inventees,
 * visiblement fausses.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signUp } from "../helpers/auth";
import { expectError, expectStatus, type HttpResult } from "../helpers/billing";
import { closeAllPools, getBypassRlsPool } from "../helpers/db";
import { addMemberDirect, createOrganizationFixture } from "../helpers/fixtures";
import { inviteeEmail, resetInvitationFakes, startInvitationFakes, stopInvitationFakes, type InvitationFakes } from "../helpers/invitations";
import {
  closeServerAppPool,
  deleteAccountDirect,
  forgeInvitation,
  forgeInvitationWindow,
  issueInvitation,
  loadAcceptModule,
  mixedCase,
  newTestToken,
  nonCanonicalVariants,
  postAccept,
  readMembersOfUser,
  settledWithin,
  snapshotOf,
  waitForAcceptBlockedOnLock,
} from "../helpers/invitations-accept";
import { readInvitationById, sha256 } from "../helpers/invitations-db";
import { linkTokenToHash } from "../../apps/web/src/lib/invitations/token";

let fakes: InvitationFakes;
let serverModuleLoaded = false;

beforeAll(async () => {
  fakes = await startInvitationFakes();
});

beforeEach(() => {
  resetInvitationFakes(fakes);
});

afterAll(async () => {
  await stopInvitationFakes(fakes);
  if (serverModuleLoaded) await closeServerAppPool();
  await closeAllPools();
});

async function acceptModule(): ReturnType<typeof loadAcceptModule> {
  const module = await loadAcceptModule();
  serverModuleLoaded = true;
  return module;
}

// ---------------------------------------------------------------------------
// D-107 : liste exacte du registre (statut, code, message)
// ---------------------------------------------------------------------------

const D107 = {
  unauthenticated: { status: 401, code: "UNAUTHENTICATED", message: "Aucune session valide." },
  mismatch: {
    status: 403,
    code: "INVITATION_EMAIL_MISMATCH",
    message: "Cette invitation est adressee a une autre adresse e-mail que celle du compte connecte.",
  },
  notFound: { status: 404, code: "INVITATION_NOT_FOUND", message: "Invitation introuvable." },
  alreadyUsed: { status: 409, code: "INVITATION_ALREADY_USED", message: "Cette invitation a deja ete utilisee." },
  alreadyMember: { status: 409, code: "ALREADY_MEMBER", message: "Le compte connecte est deja membre de cette organisation." },
  expired: {
    status: 410,
    code: "INVITATION_EXPIRED",
    message: "Cette invitation a expire. Demander une nouvelle invitation a l'organisation.",
  },
  invalid: {
    status: 422,
    code: "VALIDATION_FAILED",
    message: "Corps JSON attendu, avec un champ token textuel de 256 caracteres au plus.",
  },
} as const;

type Expected = (typeof D107)[keyof typeof D107];

/** Statut, puis corps strictement egal a `{ code, message }` de D-107 : aucun autre champ. */
function expectExactBody(result: HttpResult, expected: Expected, label: string): void {
  expect(result.status, `${label} : statut (corps brut : ${result.text})`).toBe(expected.status);
  expect(result.body, `${label} : corps exact de D-107 (corps brut : ${result.text})`).toStrictEqual({
    code: expected.code,
    message: expected.message,
  });
}

// ---------------------------------------------------------------------------
// D-106
// ---------------------------------------------------------------------------

describe("D-106 — forme canonique du jeton", () => {
  it("D-106 (unitaire) : linkTokenToHash rend l'empreinte des 32 octets pour le texte canonique et null pour ses trois variantes non canoniques (memes octets)", () => {
    const { token, tokenHash } = newTestToken();
    const variants = nonCanonicalVariants(token);

    expect(linkTokenToHash(token)?.equals(tokenHash), "texte canonique : empreinte des octets").toBe(true);
    for (const variant of variants) {
      expect(variant, "variante : 43 caracteres de l'alphabet base64url").toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(variant, "variante : texte different").not.toBe(token);
      expect(Buffer.from(variant, "base64url").equals(Buffer.from(token, "base64url")), "precondition : memes 32 octets au decodage").toBe(true);
      expect(linkTokenToHash(variant), `variante non canonique ${JSON.stringify(variant.slice(-1))} : refusee`).toBeNull();
    }
  });

  it("D-106 (API) : les variantes non canoniques d'un jeton reellement emis -> 404 INVITATION_NOT_FOUND au corps identique a celui d'un jeton inconnu, rien de consomme, puis le vrai jeton est accepte", async () => {
    const org = await createOrganizationFixture("Org D-106 canonique");
    const email = inviteeEmail();
    const issued = await issueInvitation(fakes, { org, email, label: "D-106" });
    const invitee = await signUp({ email });
    const snapshotBefore = snapshotOf(await readInvitationById(issued.invitationId));
    const variants = nonCanonicalVariants(issued.token);
    for (const variant of variants) {
      expect(sha256(Buffer.from(variant, "base64url")).equals(issued.tokenHash), "precondition : la variante decode en le secret emis").toBe(true);
    }

    const unknown = await postAccept(invitee, { token: newTestToken().token });
    expectExactBody(unknown, D107.notFound, "D-106 temoin : jeton inconnu");
    for (const variant of variants) {
      const result = await postAccept(invitee, { token: variant });
      expectError(result, 404, "INVITATION_NOT_FOUND", `D-106 : variante ${JSON.stringify(variant.slice(-1))}`);
      expect(result.text, "D-106 : corps identique octet pour octet a celui d'un jeton inconnu").toBe(unknown.text);
    }

    expect(snapshotOf(await readInvitationById(issued.invitationId)), "invitation non consommee").toBe(snapshotBefore);
    expect(await readMembersOfUser(invitee.userId), "aucune ligne member").toEqual([]);
    const genuine = await postAccept(invitee, { token: issued.token });
    expectStatus(genuine, 200, "D-106 : le vrai jeton reste acceptable");
    expect(genuine.body).toEqual({ organizationId: org.organizationId, role: "member" });
  });
});

// ---------------------------------------------------------------------------
// D-107
// ---------------------------------------------------------------------------

describe("D-107 — textes fixes des erreurs de la route", () => {
  it.each([
    [
      "401 UNAUTHENTICATED (sans session)",
      D107.unauthenticated,
      async (): Promise<HttpResult> => postAccept(null, { token: newTestToken().token }),
    ],
    [
      "403 INVITATION_EMAIL_MISMATCH",
      D107.mismatch,
      async (): Promise<HttpResult> => {
        const forged = await forgeInvitation({ label: "D-107 403" });
        return postAccept(await signUp(), { token: forged.token });
      },
    ],
    [
      "404 INVITATION_NOT_FOUND",
      D107.notFound,
      async (): Promise<HttpResult> => postAccept(await signUp(), { token: newTestToken().token }),
    ],
    [
      "409 INVITATION_ALREADY_USED",
      D107.alreadyUsed,
      async (): Promise<HttpResult> => {
        const other = await signUp();
        const email = inviteeEmail();
        const forged = await forgeInvitation({ email, acceptedBy: other.userId, label: "D-107 409 utilisee" });
        return postAccept(await signUp({ email }), { token: forged.token });
      },
    ],
    [
      "409 ALREADY_MEMBER",
      D107.alreadyMember,
      async (): Promise<HttpResult> => {
        const email = inviteeEmail();
        const forged = await forgeInvitation({ email, label: "D-107 409 membre" });
        const invitee = await signUp({ email });
        await addMemberDirect({ organizationId: forged.org.organizationId, userId: invitee.userId, role: "member" });
        return postAccept(invitee, { token: forged.token });
      },
    ],
    [
      "410 INVITATION_EXPIRED",
      D107.expired,
      async (): Promise<HttpResult> => {
        const email = inviteeEmail();
        const forged = await forgeInvitationWindow({ agoSeconds: 2 * 24 * 3600, lifetimeSeconds: 2 * 24 * 3600 - 1, email, label: "D-107 410" });
        return postAccept(await signUp({ email }), { token: forged.token });
      },
    ],
  ] as const)("D-107 : %s a le corps exact du registre (code et message seulement)", async (label, expected, scenario) => {
    expectExactBody(await scenario(), expected, `D-107 ${label}`);
  }, 60_000);

  it("D-107 : 422 VALIDATION_FAILED au corps strictement identique et exact pour les entrees invalides (corps non JSON, token absent, non textuel, nul, de 257 caracteres), jamais le message de Zod", async () => {
    const forged = await forgeInvitation({ label: "D-107 422" });
    const invitee = await signUp();
    const bodies: Array<[string, Record<string, unknown> | string]> = [
      ["corps non JSON", "ceci n'est pas du JSON"],
      ["token absent", {}],
      ["token numerique (non textuel)", { token: 12345 }],
      ["token nul", { token: null }],
      ["token de 257 caracteres", { token: "A".repeat(257) }],
    ];

    const results: Array<[string, HttpResult]> = [];
    for (const [label, body] of bodies) results.push([label, await postAccept(invitee, body)]);

    const reference = results[0]?.[1];
    for (const [label, result] of results) {
      expectExactBody(result, D107.invalid, `D-107 422 : ${label}`);
      expect(result.text, `D-107 422 : ${label} : corps identique octet pour octet`).toBe(reference?.text);
      expect(result.text, `D-107 422 : ${label} : aucun vocabulaire de Zod`).not.toMatch(/expected|received|invalid_type|too_big|issues|path/i);
    }
    expect((await readInvitationById(forged.row.id))?.accepted_at, "rien ne touche l'invitation").toBeNull();
  });
});

// ---------------------------------------------------------------------------
// D-108
// ---------------------------------------------------------------------------

describe("D-108 — compte disparu ou modifie entre la session et l'acceptation (logique appelee dans le processus de test)", () => {
  it("D-108 : userId sans ligne app_user (compte supprime, puis identifiant jamais cree) et adresse de session = adresse invitee -> 401 UNAUTHENTICATED ; adresse differente -> 403 ; invitation toujours en attente", async () => {
    const { acceptInvitation } = await acceptModule();
    const email = inviteeEmail();
    const forged = await forgeInvitation({ email, label: "D-108 401" });
    const vanished = await signUp({ email });
    await deleteAccountDirect(vanished.userId);
    const snapshotBefore = snapshotOf(await readInvitationById(forged.row.id));

    for (const [label, userId] of [
      ["compte supprime", vanished.userId],
      ["identifiant jamais cree", randomUUID()],
    ] as const) {
      expect(await acceptInvitation({ userId, sessionEmail: email, token: forged.token }), `D-108 ${label}, meme adresse`).toStrictEqual({
        ok: false,
        error: D107.unauthenticated,
      });
      expect(
        await acceptInvitation({ userId, sessionEmail: mixedCase(email), token: forged.token }),
        `D-108 ${label}, meme adresse en casse differente`,
      ).toStrictEqual({ ok: false, error: D107.unauthenticated });
      expect(
        await acceptInvitation({ userId, sessionEmail: inviteeEmail(), token: forged.token }),
        `D-108 ${label}, autre adresse`,
      ).toStrictEqual({ ok: false, error: D107.mismatch });
    }

    expect(snapshotOf(await readInvitationById(forged.row.id)), "invitation toujours en attente, inchangee").toBe(snapshotBefore);
    expect(await readMembersOfUser(vanished.userId), "aucune ligne member").toEqual([]);
  });

  it("D-108 / SG002 : identifiant de session vide (app.user_id vide, accept_invitation leve SG002) -> 401 UNAUTHENTICATED, invitation intacte", async () => {
    const { acceptInvitation } = await acceptModule();
    const email = inviteeEmail();
    const forged = await forgeInvitation({ email, label: "D-108 SG002" });
    const snapshotBefore = snapshotOf(await readInvitationById(forged.row.id));

    expect(await acceptInvitation({ userId: "", sessionEmail: email, token: forged.token }), "SG002 -> 401").toStrictEqual({
      ok: false,
      error: D107.unauthenticated,
    });
    expect(snapshotOf(await readInvitationById(forged.row.id)), "invitation intacte").toBe(snapshotBefore);
  });

  it("D-108 / 23503 : compte supprime pendant l'acceptation (suppression non validee tenue, l'UPDATE attend la cle etrangere, puis la suppression est validee) -> 401 UNAUTHENTICATED, invitation intacte", async () => {
    const { acceptInvitation } = await acceptModule();
    const email = inviteeEmail();
    const forged = await forgeInvitation({ email, label: "D-108 23503" });
    const invitee = await signUp({ email });
    const snapshotBefore = snapshotOf(await readInvitationById(forged.row.id));

    const deleter = await getBypassRlsPool().connect();
    let finished = false;
    try {
      await deleter.query("BEGIN");
      await deleter.query("SET LOCAL lock_timeout = '10s'");
      await deleter.query("DELETE FROM app_user WHERE id = $1", [invitee.userId]);

      const pending = acceptInvitation({ userId: invitee.userId, sessionEmail: email, token: forged.token });
      // Le rejet eventuel est lu plus bas ; ne pas laisser une promesse rejetee non observee.
      pending.catch(() => undefined);
      const blocked = await waitForAcceptBlockedOnLock(5_000);
      const early = blocked ? "pending" : await settledWithin(pending, 0);
      expect(blocked, `precondition : accept_invitation attend la suppression non validee (resultat precoce : ${JSON.stringify(early)})`).toBe(true);

      await deleter.query("COMMIT");
      finished = true;

      expect(await pending, "23503 -> 401").toStrictEqual({ ok: false, error: D107.unauthenticated });
    } finally {
      if (!finished) await deleter.query("ROLLBACK").catch(() => undefined);
      deleter.release();
    }

    expect(snapshotOf(await readInvitationById(forged.row.id)), "invitation intacte").toBe(snapshotBefore);
    expect(await readMembersOfUser(invitee.userId), "aucune ligne member").toEqual([]);
  });
});
