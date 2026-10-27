/**
 * Tranche 005 — preuves en base du mecanisme d'atomicite (ADR-0002, ERD §7,
 * contrat « Mecanisme d'atomicite ») : AC7 (c) et (d), et la partie base de
 * AC10 (niveau d'isolation, `40001` en isolation stricte).
 *
 * Connexions `signet_app` reelles, contexte tenant pose comme le fait la couche
 * applicative. Aucune attente arbitraire comme synchronisation : l'etat attendu
 * est observe (`pg_stat_activity.wait_event_type = 'Lock'`) avant d'agir.
 */
import { describe, it, expect, afterAll } from "vitest";
import type { PoolClient } from "pg";
import { requireEnv } from "../_factory/env";
import { closeAllPools } from "../helpers/db";
import { createOrganizationFixture, type OrganizationFixture } from "../helpers/fixtures";
import {
  backendPid,
  beginAsApp,
  closeLinkPools,
  countLinksTitled,
  createCollectionViaApi,
  expectCounterAligned,
  failureOf,
  insertLink,
  seedLinks,
  startQuery,
  uniqueUrl,
  waitUntilBlockedOnLock,
  type PgFailure,
} from "../helpers/links";

const LONG_TEST = 90_000;

let withTenantPoolCloser: (() => Promise<void>) | undefined;

afterAll(async () => {
  await withTenantPoolCloser?.();
  await closeLinkPools();
  await closeAllPools();
});

interface Scene {
  org: OrganizationFixture;
  collectionId: string;
  ctx: { organizationId: string; userId: string };
}

/** Organisation Free neuve a 49 liens : le prochain est le 50e, le suivant le 51e. */
async function sceneAt49(label: string): Promise<Scene> {
  const org = await createOrganizationFixture(label);
  const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
  await seedLinks({ organizationId: org.organizationId, userId: org.owner.userId, collectionIds: [collectionId], count: 49 });
  return { org, collectionId, ctx: { organizationId: org.organizationId, userId: org.owner.userId } };
}

async function releaseAll(clients: PoolClient[]): Promise<void> {
  for (const client of clients) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

describe("AC7 (c) — preuve deterministe du verrou, deux connexions signet_app", () => {
  it("AC7 (c) : T1 insere le 50e lien sans valider ; T2 est observee en attente de verrou ; T1 valide -> T2 recoit SG001, aucune ligne de T2", async () => {
    const { org, collectionId, ctx } = await sceneAt49("AC7 c commit");
    const t1 = await beginAsApp(ctx);
    const t2 = await beginAsApp(ctx);
    try {
      await insertLink(t1, { ...ctx, collectionId, title: "T1 cinquantieme" });
      const pid2 = await backendPid(t2);

      const attempt = startQuery(() => insertLink(t2, { ...ctx, collectionId, title: "T2 cinquante et unieme" }));
      await waitUntilBlockedOnLock(pid2);
      expect(attempt.isSettled(), "T2 est bloquee tant que T1 n'a ni valide ni annule").toBe(false);

      await t1.query("COMMIT");
      const outcome = await attempt.result;

      expect(outcome.ok, "T2 ne doit pas reussir : T1 a pris le 50e").toBe(false);
      const error: PgFailure | undefined = outcome.ok ? undefined : outcome.error;
      expect(error?.code, `erreur de T2 : ${error?.message}`).toBe("SG001");
      expect(error?.message ?? "", "le message de la base ne contient pas d'identifiant client").not.toContain(org.organizationId);
      expect(error?.message ?? "").not.toContain(org.owner.userId);
      await t2.query("ROLLBACK");

      expect(await countLinksTitled(org.organizationId, "T1 cinquantieme")).toBe(1);
      expect(await countLinksTitled(org.organizationId, "T2 cinquante et unieme"), "aucune ligne de T2").toBe(0);
      expect(await expectCounterAligned(org.organizationId, "apres T1 valide / T2 refusee")).toEqual({ rows: 50, counter: 50 });
    } finally {
      await releaseAll([t1, t2]);
    }
  }, LONG_TEST);

  it("AC7 (c) variante : T1 annule -> T2 (qui attendait) reussit, compteur 50 = nombre reel", async () => {
    const { org, collectionId, ctx } = await sceneAt49("AC7 c rollback");
    const t1 = await beginAsApp(ctx);
    const t2 = await beginAsApp(ctx);
    try {
      await insertLink(t1, { ...ctx, collectionId, title: "T1 annule" });
      const pid2 = await backendPid(t2);

      const attempt = startQuery(() => insertLink(t2, { ...ctx, collectionId, title: "T2 reussit" }));
      await waitUntilBlockedOnLock(pid2);
      expect(attempt.isSettled(), "T2 est bloquee tant que T1 n'a ni valide ni annule").toBe(false);

      await t1.query("ROLLBACK");
      const outcome = await attempt.result;

      expect(outcome.ok, `T2 doit reussir apres l'annulation de T1 : ${outcome.ok ? "" : outcome.error.message}`).toBe(true);
      await t2.query("COMMIT");

      expect(await countLinksTitled(org.organizationId, "T1 annule"), "aucune ligne de T1").toBe(0);
      expect(await countLinksTitled(org.organizationId, "T2 reussit")).toBe(1);
      expect(await expectCounterAligned(org.organizationId, "apres T1 annulee / T2 validee")).toEqual({ rows: 50, counter: 50 });
    } finally {
      await releaseAll([t1, t2]);
    }
  }, LONG_TEST);

  it("AC7 (c) : l'attente de T2 ne tient pas a la collection : deux collections differentes de la meme organisation se serialisent aussi", async () => {
    const { org, collectionId, ctx } = await sceneAt49("AC7 c deux collections");
    const otherCollection = await createCollectionViaApi(org.owner, org.organizationId, "Autre");
    const t1 = await beginAsApp(ctx);
    const t2 = await beginAsApp(ctx);
    try {
      await insertLink(t1, { ...ctx, collectionId, title: "T1 premiere collection" });
      const pid2 = await backendPid(t2);

      const attempt = startQuery(() => insertLink(t2, { ...ctx, collectionId: otherCollection, title: "T2 seconde collection" }));
      await waitUntilBlockedOnLock(pid2);
      await t1.query("COMMIT");
      const outcome = await attempt.result;

      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? undefined : outcome.error.code).toBe("SG001");
      await t2.query("ROLLBACK");
      expect(await expectCounterAligned(org.organizationId, "apres les deux collections")).toEqual({ rows: 50, counter: 50 });
    } finally {
      await releaseAll([t1, t2]);
    }
  }, LONG_TEST);
});

describe("AC7 (d) — 10 connexions signet_app simultanees a 49 liens", () => {
  it("AC7 (d) : une seule transaction validee, neuf SG001, compteur = nombre reel = 50", async () => {
    const { org, collectionId, ctx } = await sceneAt49("AC7 d dix connexions");
    const clients = await Promise.all(Array.from({ length: 10 }, () => beginAsApp(ctx)));
    try {
      const outcomes = await Promise.all(
        clients.map(async (client, index) => {
          const failure = await failureOf(async () => {
            await insertLink(client, { ...ctx, collectionId, title: `Connexion ${index}` });
            await client.query("COMMIT");
          });
          if (failure) await client.query("ROLLBACK").catch(() => undefined);
          return failure?.code ?? "ok";
        }),
      );

      expect([...outcomes].sort(), `issues par connexion : ${outcomes.join(", ")}`).toEqual(["SG001", "SG001", "SG001", "SG001", "SG001", "SG001", "SG001", "SG001", "SG001", "ok"]);
      expect(await expectCounterAligned(org.organizationId, "apres les 10 connexions")).toEqual({ rows: 50, counter: 50 });
    } finally {
      await releaseAll(clients);
    }
  }, LONG_TEST);
});

describe("AC10 — niveau d'isolation et 40001 (ADR-0002, contrat)", () => {
  it("AC10 : withTenant ouvre une transaction en read committed (defaut sur lequel repose l'argument de re-evaluation)", async () => {
    const org = await createOrganizationFixture("AC10 niveau d'isolation");
    process.env.DATABASE_URL_APP ??= requireEnv(["TEST_DATABASE_URL_APP"]).TEST_DATABASE_URL_APP;
    const { withTenant, getAppPool } = await import("../../apps/web/src/lib/db");
    withTenantPoolCloser = async () => {
      await getAppPool().end();
    };

    const level = await withTenant({ userId: org.owner.userId, organizationId: org.organizationId }, async (client) => {
      const { rows } = await client.query<{ level: string }>("SELECT current_setting('transaction_isolation') AS level");
      return rows[0]?.level;
    });

    expect(level).toBe("read committed");
  });

  it("AC10 : deux transactions REPEATABLE READ a 49 liens -> la seconde recoit 40001 (et non SG001), aucune ligne de la seconde", async () => {
    const { org, collectionId, ctx } = await sceneAt49("AC10 repeatable read");
    const t1 = await beginAsApp(ctx, "REPEATABLE READ");
    const t2 = await beginAsApp(ctx, "REPEATABLE READ");
    try {
      await insertLink(t1, { ...ctx, collectionId, title: "RR premiere" });
      const pid2 = await backendPid(t2);

      const attempt = startQuery(() => insertLink(t2, { ...ctx, collectionId, title: "RR seconde" }));
      await waitUntilBlockedOnLock(pid2);
      await t1.query("COMMIT");
      const outcome = await attempt.result;

      expect(outcome.ok, "la seconde transaction doit etre refusee").toBe(false);
      expect(outcome.ok ? undefined : outcome.error.code, `erreur : ${outcome.ok ? "" : outcome.error.message}`).toBe("40001");
      await t2.query("ROLLBACK");

      expect(await countLinksTitled(org.organizationId, "RR seconde")).toBe(0);
      expect(await expectCounterAligned(org.organizationId, "apres le 40001")).toEqual({ rows: 50, counter: 50 });
    } finally {
      await releaseAll([t1, t2]);
    }
  }, LONG_TEST);

  it("AC10 : en read committed, le meme enchainement donne SG001, jamais 40001 (la route n'a donc a traduire 40001 qu'en isolation stricte)", async () => {
    const { org, collectionId, ctx } = await sceneAt49("AC10 read committed");
    const t1 = await beginAsApp(ctx, "READ COMMITTED");
    const t2 = await beginAsApp(ctx, "READ COMMITTED");
    try {
      await insertLink(t1, { ...ctx, collectionId, title: "RC premiere", url: uniqueUrl() });
      const pid2 = await backendPid(t2);

      const attempt = startQuery(() => insertLink(t2, { ...ctx, collectionId, title: "RC seconde" }));
      await waitUntilBlockedOnLock(pid2);
      await t1.query("COMMIT");
      const outcome = await attempt.result;

      expect(outcome.ok ? undefined : outcome.error.code).toBe("SG001");
      await t2.query("ROLLBACK");
      await expectCounterAligned(org.organizationId, "apres SG001");
    } finally {
      await releaseAll([t1, t2]);
    }
  }, LONG_TEST);
});
