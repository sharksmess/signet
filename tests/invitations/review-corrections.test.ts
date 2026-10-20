/**
 * Tranche 003 — corrections de la relecture (review-003, A CORRIGER 3 a 5 ;
 * D-095). Ajouts seulement : aucun test existant n'est modifie.
 *
 * - A CORRIGER 3 (AC16, cote route) : `createInvitation` (logique de la route)
 *   executee DANS ce processus avec `INVITATION_TOKEN_KEY` retiree ou mal
 *   formee : rejet qui nomme la variable sans sa valeur, aucune ligne, aucun
 *   evenement. Temoin positif avec la cle de test.
 * - A CORRIGER 4 (D-091) : `TimeZone=UTC` dans `proconfig` de
 *   `signet.create_invitation` (garde durable), et 168 h exactes sous un fuseau
 *   dont le changement d'heure tombe dans les 7 jours (fuseau POSIX construit
 *   par le test, donc discriminant quelle que soit la date d'execution).
 * - A CORRIGER 5 (D-093, ADR-0016) : `reportAbandonedInvitation` ecrit sur
 *   `console.error` seul, sans e-mail, jeton, `sealedToken` ni cle ; refus de
 *   cle REJOUABLE (pas `NonRetriableError`) ; AC14 journalise sur
 *   `console.error`.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { asBypassRls, asTenant, closeAllPools } from "../helpers/db";
import { applyServerEnvToProcess, errorMessage, errorName } from "../helpers/billing";
import { createOrganizationFixture } from "../helpers/fixtures";
import {
  eventsForEmail,
  invitationEnv,
  inviteeEmail,
  openSealedToken,
  resetInvitationFakes,
  runSender,
  startInvitationFakes,
  stopInvitationFakes,
  tokenForms,
  tokenFromPlaintext,
  type InvitationFakes,
} from "../helpers/invitations";
import { emitInvitation } from "../helpers/invitations-flow";
import { SEVEN_DAYS_SECONDS, randomTokenHash, readInvitations } from "../helpers/invitations-db";

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
  vi.restoreAllMocks();
});

afterAll(async () => {
  await stopInvitationFakes(fakes);
  await closeAllPools();
});

const INVITATIONS_MODULE = "../../apps/web/src/lib/invitations/invitations";
const SENDER_MODULE = "../../apps/web/src/lib/inngest/send-invitation-email";

interface EmissionModule {
  createInvitation: (params: { userId: string; organizationId: string; email: string }) => Promise<{ ok: boolean }>;
}

function isEmissionModule(value: unknown): value is EmissionModule {
  return typeof value === "object" && value !== null && "createInvitation" in value && typeof value.createInvitation === "function";
}

/** Logique d'emission chargee dans ce processus, environnement du serveur de test, surcharges appliquees. */
async function loadEmission(overrides?: Record<string, string | undefined>): Promise<EmissionModule> {
  applyServerEnvToProcess();
  for (const [name, value] of Object.entries(overrides ?? {})) vi.stubEnv(name, value);
  vi.resetModules();
  const loaded: unknown = await import(INVITATIONS_MODULE);
  if (!isEmissionModule(loaded)) throw new Error(`[tests] ${INVITATIONS_MODULE} doit exporter createInvitation().`);
  return loaded;
}

describe("A CORRIGER 3 — AC16 cote route : refus de INVITATION_TOKEN_KEY avant toute ecriture", () => {
  it("temoin positif : avec la cle de test, createInvitation dans ce processus cree une ligne et met un evenement en file", async () => {
    const org = await createOrganizationFixture("AC16 route temoin");
    const email = inviteeEmail();
    const emission = await loadEmission();

    const result = await emission.createInvitation({ userId: org.owner.userId, organizationId: org.organizationId, email });

    expect(result.ok).toBe(true);
    expect(await readInvitations(org.organizationId, email)).toHaveLength(1);
    expect(eventsForEmail(fakes.inngest, email)).toHaveLength(1);
  });

  it.each([
    { label: "absente", value: undefined },
    { label: "texte quelconque", value: "SENTINELLE-cle-route-mal-formee" },
    { label: "31 octets", value: Buffer.alloc(31, 5).toString("base64url") },
    { label: "33 octets", value: Buffer.alloc(33, 5).toString("base64url") },
  ])("cle $label -> rejet nommant la variable sans sa valeur, aucune ligne, aucun evenement", async ({ value }) => {
    const org = await createOrganizationFixture("AC16 route refus");
    const email = inviteeEmail();
    const emission = await loadEmission({ INVITATION_TOKEN_KEY: value });

    let failure: unknown;
    try {
      await emission.createInvitation({ userId: org.owner.userId, organizationId: org.organizationId, email });
    } catch (error) {
      failure = error;
    }

    expect(failure, "la cle refusee doit faire echouer l'emission").toBeDefined();
    const message = errorMessage(failure);
    expect(message).toContain("INVITATION_TOKEN_KEY");
    if (value !== undefined) expect(message, "jamais la valeur refusee").not.toContain(value);
    expect(message).not.toContain(invitationEnv().tokenKey);
    expect(await readInvitations(org.organizationId, email), "aucune ligne").toEqual([]);
    expect(eventsForEmail(fakes.inngest, email), "aucun evenement").toEqual([]);
    expect(fakes.inngest.rawBodies.filter((body) => body.includes(email)), "aucun envoi a la file").toEqual([]);
  });
});

describe("A CORRIGER 4 — D-091 : create_invitation fige TimeZone = 'UTC'", () => {
  it("proconfig de signet.create_invitation contient TimeZone=UTC (garde durable, independante de la date et du fuseau de la CI)", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ config: string[] | null }>(
        `SELECT p.proconfig AS config FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'signet' AND p.proname = 'create_invitation'`,
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.config).toContain("TimeZone=UTC");
  });

  /**
   * Fuseau POSIX `AAA0BBB,<debut>,<fin>` (heure d'ete = +1 h) dont une seule
   * transition tombe dans les 7 prochains jours, choisi par le test pour que
   * `now() + interval '7 days'` y fasse 167 h ou 169 h. Precondition verifiee
   * sur la meme session : le fuseau est bien discriminant.
   */
  function candidateZones(): string[] {
    const zones: string[] = [];
    for (let ahead = 2; ahead <= 5; ahead += 1) {
      const day = new Date(Date.now() + ahead * 24 * 3600 * 1000);
      const start = Date.UTC(day.getUTCFullYear(), 0, 1);
      const julian = Math.floor((Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) - start) / (24 * 3600 * 1000)) + 1;
      const jn = Math.min(Math.max(julian, 2), 364);
      // Passage a l'heure d'ete au jour `jn`, retour 30 jours plus tard (regle
      // « hemisphere sud » si la fin tombe l'annee suivante) : une seule
      // transition dans la fenetre, y compris en fin d'annee.
      zones.push(`AAA0BBB,J${jn},J${jn > 330 ? 30 : jn + 30}`, `AAA0BBB,J1,J${jn}`);
    }
    return zones;
  }

  it("sous un fuseau a changement d'heure dans la semaine, create_invitation donne 168 h exactes (sans TimeZone=UTC : 167 ou 169 h)", async () => {
    const org = await createOrganizationFixture("D-091 fuseau");
    const ctx = { organizationId: org.organizationId, userId: org.owner.userId };

    const outcome = await asTenant(ctx, async (client) => {
      for (const zone of candidateZones()) {
        await client.query(`SELECT set_config('TimeZone', $1, true)`, [zone]);
        const probe = await client.query<{ wall: number }>(
          "SELECT extract(epoch FROM ((now() + interval '7 days') - now()))::float8 AS wall",
        );
        if (probe.rows[0]?.wall === SEVEN_DAYS_SECONDS) continue;
        const created = await client.query<{ lifetime: number }>(
          `SELECT extract(epoch FROM (expires_at - created_at))::float8 AS lifetime
             FROM signet.create_invitation($1::uuid, $2::text, $3::bytea)`,
          [org.organizationId, inviteeEmail(), randomTokenHash()],
        );
        return { zone, wall: probe.rows[0]?.wall, lifetime: created.rows[0]?.lifetime };
      }
      return undefined;
    });

    expect(outcome, `aucun fuseau candidat discriminant : ${candidateZones().join(" | ")}`).toBeDefined();
    expect(outcome?.wall, `precondition : sous ${outcome?.zone}, 7 jours muraux ne font pas 168 h`).not.toBe(SEVEN_DAYS_SECONDS);
    expect(outcome?.lifetime, `create_invitation sous ${outcome?.zone} : 168 h exactes`).toBe(SEVEN_DAYS_SECONDS);
  });
});

describe("A CORRIGER 5 — D-093 et journal d'abandon (ADR-0016)", () => {
  interface ReporterModule {
    reportAbandonedInvitation: (event: { data?: unknown }, runId: string, error: { name?: string }) => void;
  }
  function isReporterModule(value: unknown): value is ReporterModule {
    return typeof value === "object" && value !== null && "reportAbandonedInvitation" in value && typeof value.reportAbandonedInvitation === "function";
  }

  it("reportAbandonedInvitation : une ligne sur console.error, identifiant de l'invitation et nom de l'erreur, jamais l'e-mail, le sealedToken ni la cle", async () => {
    const loaded: unknown = await import(SENDER_MODULE);
    if (!isReporterModule(loaded)) throw new Error(`[tests] ${SENDER_MODULE} doit exporter reportAbandonedInvitation().`);
    const invitationId = randomUUID();
    const email = inviteeEmail();
    const sealedToken = Buffer.alloc(60, 3).toString("base64url");
    const key = invitationEnv().tokenKey;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const others = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn")].map((spy) =>
      spy.mockImplementation(() => undefined),
    );

    loaded.reportAbandonedInvitation(
      { data: { invitationId, organizationId: randomUUID(), email, organizationName: "Org abandon", sealedToken } },
      "run_abandon_1",
      { name: "EmailSendError" },
    );

    expect(error).toHaveBeenCalledTimes(1);
    const line = error.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    expect(line).toContain(invitationId);
    expect(line).toContain("EmailSendError");
    for (const secret of [email, sealedToken, key]) expect(line).not.toContain(secret);
    for (const spy of others) expect(spy).not.toHaveBeenCalled();
  });

  it("D-093 : cle INVITATION_TOKEN_KEY refusee a l'envoi -> erreur REJOUABLE (pas NonRetriableError), aucun message", async () => {
    const emitted = await emitInvitation(fakes, { label: "D-093 rejouable" });

    const output = await runSender(emitted.event, { env: { INVITATION_TOKEN_KEY: "SENTINELLE" } });

    expect(output.error).toBeDefined();
    expect(errorMessage(output.error)).toContain("INVITATION_TOKEN_KEY");
    expect(errorName(output.error), "refus de cle rejouable (D-093)").not.toBe("NonRetriableError");
    expect(fakes.mailbox.attempts).toBe(0);
  });

  it("AC14 : EMAIL_PROVIDER_NOT_CONFIGURED journalise sur console.error (et non log/info/warn), avec l'identifiant, sans e-mail ni secret", async () => {
    const emitted = await emitInvitation(fakes, { label: "AC14 console.error" });
    const token = tokenFromPlaintext(openSealedToken(String(emitted.event.data.sealedToken), emitted.invitationId, invitationEnv().tokenKey));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const output = await runSender(emitted.event, { env: { EMAIL_CAPTURE_URL: undefined } });

    expect(errorName(output.error)).toBe("NonRetriableError");
    const lines = error.mock.calls.map((call) => call.map(String).join(" "));
    const named = lines.filter((line) => line.includes("EMAIL_PROVIDER_NOT_CONFIGURED"));
    expect(named.length, `console.error : ${JSON.stringify(lines)}`).toBeGreaterThanOrEqual(1);
    expect(named.join("\n")).toContain(emitted.invitationId);
    for (const secret of [emitted.email, ...tokenForms(token), String(emitted.event.data.sealedToken), invitationEnv().tokenKey]) {
      expect(lines.join("\n")).not.toContain(secret);
    }
  });
});
