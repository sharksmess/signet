/**
 * Tranche 003 — envoi de l'e-mail d'invitation par la fonction Inngest :
 * AC2, AC3, AC4 (a a d), AC14 (execution), AC16 (cle).
 *
 * Chaine : l'invitation est emise par la route reelle (serveur de test), le faux
 * Inngest capture l'evenement, puis la fonction est executee DANS CE PROCESSUS
 * par @inngest/test contre la fausse messagerie HTTP (EMAIL_CAPTURE_URL). Le
 * jeton n'est jamais lu en base ni dans l'evenement : les tests le recuperent
 * dans le lien de l'e-mail capture (ou, pour les controles d'authenticite, par
 * une ouverture independante du jeton scelle).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { closeAllPools } from "../helpers/db";
import { captureLogs, errorMessage, errorName, expectNoRetry, expectProcessed } from "../helpers/billing";
import {
  invitationEnv,
  linkFor,
  memoizedStepsOf,
  openSealedToken,
  otherTokenKey,
  resetInvitationFakes,
  runSender,
  settleWithin,
  startInvitationFakes,
  stepReturnValuesText,
  stopInvitationFakes,
  tokenForms,
  tokenFromPlaintext,
  tokenFromText,
  type InvitationFakes,
} from "../helpers/invitations";
import { emitInvitation, type EmittedInvitation } from "../helpers/invitations-flow";
import { columnTexts, readInvitations, readSingleInvitation, sha256 } from "../helpers/invitations-db";
import type { CapturedInngestEvent } from "../billing/fakes/fake-inngest";

let fakes: InvitationFakes;

beforeAll(async () => {
  fakes = await startInvitationFakes();
});

beforeEach(() => {
  resetInvitationFakes(fakes);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

afterAll(async () => {
  await stopInvitationFakes(fakes);
  await closeAllPools();
});

function sealedOf(event: CapturedInngestEvent): string {
  return String(event.data.sealedToken);
}

/** Le jeton de l'invitation, obtenu par ouverture independante du jeton scelle (cle de test). */
function tokenOf(emitted: EmittedInvitation): string {
  return tokenFromPlaintext(openSealedToken(sealedOf(emitted.event), emitted.invitationId, invitationEnv().tokenKey));
}

function withSealedToken(event: CapturedInngestEvent, sealedToken: string): CapturedInngestEvent {
  return { ...event, data: { ...event.data, sealedToken } };
}

describe("AC2 — e-mail et lien (US-02.3)", () => {
  it("AC2 : la fonction depose un seul message texte brut, a l'e-mail normalise, avec le nom de l'organisation et le lien APP_URL/invitations/accept#token=<jeton>", async () => {
    const env = invitationEnv();
    const emitted = await emitInvitation(fakes, { label: "AC2" });

    const output = await runSender(emitted.event);

    expectProcessed(output, "AC2 envoi");
    const messages = fakes.mailbox.messagesTo(emitted.email);
    expect(messages, `un seul message pour ${emitted.email} ; tentatives : ${fakes.mailbox.attempts}, refus : ${JSON.stringify(fakes.mailbox.rejected)}`).toHaveLength(1);
    const message = messages[0];
    expect(message?.text, "texte brut present").toBeTypeOf("string");
    expect(Object.keys(message?.body ?? {}), "texte brut : aucun champ html").not.toContain("html");
    expect(message?.text).toContain(emitted.org.name);
    expect(message?.subject, "sujet fixe : le nom de l'organisation (saisi par un owner) n'y figure jamais").not.toContain(emitted.org.name);
    expect(message?.subject?.length ?? 0).toBeGreaterThan(0);
    expect(message?.idempotencyKey, "cle d'idempotence = identifiant de l'invitation").toBe(emitted.invitationId);

    const token = tokenFromText(message?.text, env.appUrl);
    expect(token, `lien ${linkFor(env.appUrl, "<jeton>")} absent du texte : ${message?.text}`).toBeDefined();
    expect(token, "base64url de 32 octets (43 caracteres, sans remplissage)").toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token ?? "", "base64url").length).toBe(32);
    const row = await readSingleInvitation(emitted.org.organizationId, emitted.email);
    expect(sha256(token ?? "").equals(row.token_hash), "sha256(jeton) = token_hash de la ligne").toBe(true);
  });

  it("AC2 : le jeton scelle dans l'evenement s'ouvre avec la cle de test (AES-256-GCM, donnees authentifiees = invitationId) et correspond au lien de l'e-mail", async () => {
    const env = invitationEnv();
    const emitted = await emitInvitation(fakes, { label: "AC2 scelle" });

    expectProcessed(await runSender(emitted.event), "AC2 envoi");

    const linkToken = tokenFromText(fakes.mailbox.messagesTo(emitted.email)[0]?.text, env.appUrl);
    expect(tokenOf(emitted), "le jeton ouvert est celui du lien").toBe(linkToken);
  });

  it("AC2 : deux invitations distinctes ont deux jetons distincts, et deux scellements du meme jeton ne sont pas identiques", async () => {
    const env = invitationEnv();
    const first = await emitInvitation(fakes, { label: "AC2 a" });
    const second = await emitInvitation(fakes, { label: "AC2 b" });

    expectProcessed(await runSender(first.event), "AC2 envoi 1");
    expectProcessed(await runSender(second.event), "AC2 envoi 2");

    const tokenA = tokenFromText(fakes.mailbox.messagesTo(first.email)[0]?.text, env.appUrl);
    const tokenB = tokenFromText(fakes.mailbox.messagesTo(second.email)[0]?.text, env.appUrl);
    expect(tokenA).toBeDefined();
    expect(tokenB).toBeDefined();
    expect(tokenA).not.toBe(tokenB);
    const ivA = Buffer.from(sealedOf(first.event), "base64url").subarray(0, 12);
    const ivB = Buffer.from(sealedOf(second.event), "base64url").subarray(0, 12);
    expect(ivA.equals(ivB), "un iv aleatoire par scellement").toBe(false);
  });
});

describe("AC3 — le jeton ne fuit nulle part (ADR-0003)", () => {
  it("AC3 : jeton absent de la reponse HTTP, des colonnes de la ligne, du corps de l'evenement, des valeurs de pas Inngest et des journaux", async () => {
    const emitted = await emitInvitation(fakes, { label: "AC3 fuite" });

    const logs = captureLogs();
    let output: Awaited<ReturnType<typeof runSender>>;
    try {
      output = await runSender(emitted.event);
    } finally {
      logs.restore();
    }
    expectProcessed(output, "AC3 envoi");
    const token = tokenFromText(fakes.mailbox.messagesTo(emitted.email)[0]?.text, invitationEnv().appUrl);
    expect(token, "le lien porte un jeton (sinon la verification serait vide)").toBeDefined();

    const row = await readSingleInvitation(emitted.org.organizationId, emitted.email);
    const haystacks: Array<[string, string]> = [
      ["reponse HTTP", emitted.response.text],
      ["colonnes de la ligne invitation", columnTexts(row).join("\n")],
      ["corps brut de l'evenement recu par le faux Inngest", fakes.inngest.rawBodies.join("\n")],
      ["valeurs retournees par les pas Inngest", await stepReturnValuesText(output)],
      ["journaux de l'envoi", logs.text()],
    ];
    for (const form of tokenForms(token ?? "")) {
      for (const [where, text] of haystacks) {
        expect(text, `le jeton (${form.length} caracteres) ne doit pas figurer dans : ${where}`).not.toContain(form);
      }
    }
  });

  const tamperings: Array<{
    label: string;
    apply: (emitted: EmittedInvitation) => { event: CapturedInngestEvent; env?: Record<string, string | undefined> };
  }> = [
    {
      label: "un octet modifie (zone chiffree)",
      apply: ({ event }) => {
        const raw = Buffer.from(sealedOf(event), "base64url");
        raw[14] = (raw[14] ?? 0) ^ 0xff;
        return { event: withSealedToken(event, raw.toString("base64url")) };
      },
    },
    {
      label: "un octet modifie (etiquette d'authentification)",
      apply: ({ event }) => {
        const raw = Buffer.from(sealedOf(event), "base64url");
        raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 0x01;
        return { event: withSealedToken(event, raw.toString("base64url")) };
      },
    },
    {
      label: "tronque",
      apply: ({ event }) => {
        const raw = Buffer.from(sealedOf(event), "base64url");
        return { event: withSealedToken(event, raw.subarray(0, raw.length - 5).toString("base64url")) };
      },
    },
    {
      label: "presente avec un autre invitationId (donnees authentifiees)",
      apply: ({ event }) => ({ event: { ...event, data: { ...event.data, invitationId: randomUUID() } } }),
    },
    {
      label: "ouvert avec une autre cle",
      apply: ({ event }) => ({ event, env: { INVITATION_TOKEN_KEY: otherTokenKey() } }),
    },
  ];

  it.each(tamperings)(
    "AC3 : sealedToken $label -> echec NON rejouable, aucun message, journal sans jeton, sans sealedToken et sans cle",
    async ({ apply }) => {
      const emitted = await emitInvitation(fakes, { label: "AC3 altere" });
      const token = tokenOf(emitted);
      const tampered = apply(emitted);
      const env = invitationEnv();

      const logs = captureLogs();
      let output: Awaited<ReturnType<typeof runSender>>;
      try {
        output = await runSender(tampered.event, { env: tampered.env });
      } finally {
        logs.restore();
      }

      expect(output.error, "la fonction doit echouer").toBeDefined();
      expect(errorName(output.error), `echec non rejouable attendu, recu ${errorName(output.error)} : ${errorMessage(output.error)}`).toBe(
        "NonRetriableError",
      );
      expect(fakes.mailbox.messagesTo(emitted.email), "aucun message").toEqual([]);
      expect(fakes.mailbox.attempts, "la messagerie n'est meme pas contactee").toBe(0);
      const everything = `${logs.text()}\n${errorMessage(output.error)}`;
      const forbidden = [
        ...tokenForms(token),
        sealedOf(emitted.event),
        String(tampered.event.data.sealedToken),
        env.tokenKey,
        otherTokenKey(),
      ];
      for (const secret of forbidden) {
        expect(everything, "journaux et message d'erreur : aucun jeton, sealedToken ni cle").not.toContain(secret);
      }
      expect(logs.text(), "le journal identifie l'invitation").toContain(String(tampered.event.data.invitationId));
    },
  );
});

describe("AC4 — envoi decouple et rejouable (ADR-0006)", () => {
  it("AC4 (a) : messagerie en 500 -> erreur rejouable, aucun message, l'invitation reste valide, aucune ligne supplementaire", async () => {
    const emitted = await emitInvitation(fakes, { label: "AC4 a 500" });
    fakes.mailbox.failWith500();

    const output = await runSender(emitted.event);

    expect(output.error, "le pas d'envoi doit echouer").toBeDefined();
    expect(errorName(output.error), `erreur rejouable attendue : ${errorName(output.error)} ${errorMessage(output.error)}`).not.toBe(
      "NonRetriableError",
    );
    expect(fakes.mailbox.attempts, "la messagerie a ete contactee").toBeGreaterThanOrEqual(1);
    expect(fakes.mailbox.messagesTo(emitted.email)).toEqual([]);
    const rows = await readInvitations(emitted.org.organizationId, emitted.email);
    expect(rows.map((r) => r.id)).toEqual([emitted.invitationId]);
    expect(rows[0]?.expires_at.getTime()).toBeGreaterThan(Date.now());
    expect(rows[0]?.accepted_at).toBeNull();
  });

  it("AC4 (a) : messagerie muette -> l'envoi echoue en erreur rejouable dans un delai borne (l'expediteur a un delai d'attente), aucun message", async () => {
    const emitted = await emitInvitation(fakes, { label: "AC4 a muette" });
    fakes.mailbox.hang();

    const output = await settleWithin(runSender(emitted.event), 25_000);

    expect(output, "la fonction doit rendre la main en moins de 25 s : l'expediteur doit borner sa requete (delai d'attente <= 10 s)").toBeDefined();
    expect(output?.error, "le pas d'envoi doit echouer").toBeDefined();
    expect(errorName(output?.error)).not.toBe("NonRetriableError");
    expect(fakes.mailbox.messagesTo(emitted.email)).toEqual([]);
    expect(await readInvitations(emitted.org.organizationId, emitted.email)).toHaveLength(1);
  }, 40_000);

  it("AC4 (b) : rejeu apres retour de la messagerie -> un seul message, avec le meme lien que le premier envoi aurait porte ; toujours une seule ligne", async () => {
    const env = invitationEnv();
    const emitted = await emitInvitation(fakes, { label: "AC4 b" });
    const expectedLink = linkFor(env.appUrl, tokenOf(emitted));
    fakes.mailbox.failWith500();
    const failed = await runSender(emitted.event);
    expect(failed.error, "premier envoi en echec").toBeDefined();
    const replaySteps = await memoizedStepsOf(failed);
    fakes.mailbox.succeed();

    const replayed = await runSender(emitted.event, { steps: replaySteps });

    expectProcessed(replayed, "AC4 b rejeu");
    const messages = fakes.mailbox.messagesTo(emitted.email);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toContain(expectedLink);
    expect(await readInvitations(emitted.org.organizationId, emitted.email)).toHaveLength(1);
  });

  it("AC4 (c) : la fonction executee une seconde fois apres un envoi reussi (pas memorise) n'envoie rien de plus", async () => {
    const emitted = await emitInvitation(fakes, { label: "AC4 c" });
    const first = await runSender(emitted.event);
    expectProcessed(first, "AC4 c premier envoi");
    const memoized = await memoizedStepsOf(first);
    expect(memoized.length, "le pas d'envoi est un pas Inngest distinct, donc memorisable").toBeGreaterThanOrEqual(1);
    expect(fakes.mailbox.messagesTo(emitted.email)).toHaveLength(1);

    const second = await runSender(emitted.event, { steps: memoized });

    expectProcessed(second, "AC4 c seconde execution");
    expect(fakes.mailbox.messagesTo(emitted.email), "toujours un seul message").toHaveLength(1);
  });

  it("AC4 (d) : double envoi residuel (la messagerie accepte mais la reponse est perdue) -> deux messages portant le meme lien et la meme cle d'idempotence", async () => {
    const emitted = await emitInvitation(fakes, { label: "AC4 d" });
    fakes.mailbox.loseResponse();
    const lost = await runSender(emitted.event);
    expect(lost.error, "la reponse perdue fait echouer le pas d'envoi").toBeDefined();
    expect(errorName(lost.error)).not.toBe("NonRetriableError");
    const replaySteps = await memoizedStepsOf(lost);
    fakes.mailbox.succeed();

    const replayed = await runSender(emitted.event, { steps: replaySteps });

    expectProcessed(replayed, "AC4 d rejeu");
    const messages = fakes.mailbox.messagesTo(emitted.email);
    expect(messages, "la messagerie a bien recu le message deux fois").toHaveLength(2);
    expect(messages[0]?.text).toBeDefined();
    expect(messages[1]?.text, "meme lien").toBe(messages[0]?.text);
    expect(messages[0]?.idempotencyKey).toBe(emitted.invitationId);
    expect(messages[1]?.idempotencyKey, "meme cle d'idempotence transmise au fournisseur").toBe(emitted.invitationId);
  });
});

describe("AC14 — aucun fournisseur reel (D-083, D-087)", () => {
  it("AC14 : sans EMAIL_CAPTURE_URL, le premier envoi echoue en erreur NON rejouable EMAIL_PROVIDER_NOT_CONFIGURED, journalisee avec l'identifiant de l'invitation seulement", async () => {
    const env = invitationEnv();
    const emitted = await emitInvitation(fakes, { label: "AC14" });
    const token = tokenOf(emitted);

    const logs = captureLogs();
    let output: Awaited<ReturnType<typeof runSender>>;
    try {
      output = await runSender(emitted.event, { env: { EMAIL_CAPTURE_URL: undefined } });
    } finally {
      logs.restore();
    }

    expect(output.error, "aucun chemin ne rend un succes").toBeDefined();
    expect(errorName(output.error)).toBe("NonRetriableError");
    const named = `${errorName(output.error)} ${errorMessage(output.error)} ${logs.text()}`;
    expect(named, "l'erreur nommee EMAIL_PROVIDER_NOT_CONFIGURED est signalee").toContain("EMAIL_PROVIDER_NOT_CONFIGURED");
    expect(logs.text(), "journal : identifiant de l'invitation").toContain(emitted.invitationId);
    expect(logs.text(), "journal : jamais l'adresse du destinataire").not.toContain(emitted.email);
    for (const secret of [...tokenForms(token), sealedOf(emitted.event), env.tokenKey]) {
      expect(logs.text()).not.toContain(secret);
    }
    expect(fakes.mailbox.attempts, "aucune requete vers une messagerie").toBe(0);
  });
});

describe("AC16 — INVITATION_TOKEN_KEY validee au premier usage, jamais citee", () => {
  const malformed: Array<{ label: string; value: string | undefined }> = [
    { label: "absente", value: undefined },
    { label: "texte quelconque", value: "SENTINELLE-cle-mal-formee" },
    { label: "31 octets seulement", value: Buffer.alloc(31, 9).toString("base64url") },
    { label: "33 octets", value: Buffer.alloc(33, 9).toString("base64url") },
  ];

  it.each(malformed)("AC16 : cle $label -> refus nommant la variable, sans jamais afficher sa valeur, aucun message", async ({ value }) => {
    const emitted = await emitInvitation(fakes, { label: "AC16 cle" });

    const logs = captureLogs();
    let output: Awaited<ReturnType<typeof runSender>>;
    try {
      output = await runSender(emitted.event, { env: { INVITATION_TOKEN_KEY: value } });
    } finally {
      logs.restore();
    }

    expect(output.error, "la fonction doit refuser de s'executer").toBeDefined();
    const text = `${errorMessage(output.error)}\n${logs.text()}`;
    expect(text, "le refus nomme la variable").toContain("INVITATION_TOKEN_KEY");
    if (value !== undefined) expect(text, "le refus n'affiche jamais la valeur").not.toContain(value);
    expect(text).not.toContain(invitationEnv().tokenKey);
    expect(fakes.mailbox.messagesTo(emitted.email), "aucun message").toEqual([]);
  });

  it("AC16 : le refus d'une cle invalide n'empeche pas la fonction de s'executer ensuite avec la bonne cle (temoin)", async () => {
    const emitted = await emitInvitation(fakes, { label: "AC16 temoin" });

    const refused = await runSender(emitted.event, { env: { INVITATION_TOKEN_KEY: "SENTINELLE" } });
    expect(refused.error).toBeDefined();
    vi.unstubAllEnvs();
    vi.resetModules();
    const accepted = await runSender(emitted.event);

    expectNoRetry(accepted, "AC16 temoin");
    expectProcessed(accepted, "AC16 temoin");
    expect(fakes.mailbox.messagesTo(emitted.email)).toHaveLength(1);
  });
});
