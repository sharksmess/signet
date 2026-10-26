/**
 * Tranche 005 — AC9 (coherence du compteur) et AC13 (a) (fonction definer).
 *
 * (a) `link_count = count(*)` apres chaque scenario d'ecriture est verifie dans
 * chaque fichier de la tranche (expectCounterAligned) ; ce fichier couvre
 * (b) une insertion refusee laisse le compteur inchange, pour chaque cause ;
 * (c) `signet_app` n'ecrit pas le compteur ; (d) compteur manquant = invariant
 * rompu, jamais absorbe. Role `signet_app` partout ou une assertion de
 * comportement est portee ; la connexion d'administration ne sert qu'a
 * l'arrangement (suppression du compteur) et aux lectures de controle.
 */
import { describe, it, expect, afterAll } from "vitest";
import { asBypassRls, asTenant, closeAllPools } from "../helpers/db";
import { createOrganizationFixture, createTwoOrganizationsFixture } from "../helpers/fixtures";
import { expectStatus } from "../helpers/billing";
import {
  beginAsApp,
  closeLinkPools,
  countLinks,
  createCollectionViaApi,
  expectCleanErrorBody,
  expectCounterAligned,
  expectUnchanged,
  failureOf,
  INSERT_LINK_SQL,
  linkState,
  postLink,
  seedLinks,
  uniqueUrl,
  urlOfLength,
  type AppContext,
  type LinkState,
  type PgFailure,
} from "../helpers/links";

afterAll(async () => {
  await closeLinkPools();
  await closeAllPools();
});

interface Attempt {
  failure: PgFailure | undefined;
  /** `link_count` lu DANS la transaction, apres le retour au point de sauvegarde pris avant l'insertion. */
  counterInside: number | undefined;
}

/**
 * Tente l'insertion sous `signet_app` dans un point de sauvegarde, y revient,
 * puis lit le compteur dans la meme transaction : si l'increment du trigger
 * n'etait pas annule avec l'insertion refusee, la lecture le montrerait.
 */
async function attemptInsert(ctx: AppContext, params: unknown[]): Promise<Attempt> {
  const client = await beginAsApp(ctx);
  try {
    await client.query("SAVEPOINT attempt");
    const failure = await failureOf(() => client.query(INSERT_LINK_SQL, params));
    await client.query("ROLLBACK TO SAVEPOINT attempt");
    const { rows } = await client.query<{ link_count: number }>(
      "SELECT link_count FROM organization_link_usage WHERE organization_id = $1",
      [ctx.organizationId],
    );
    await client.query("COMMIT");
    return { failure, counterInside: rows[0]?.link_count };
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

describe("AC9 (b) — une insertion refusee laisse le compteur inchange, pour chaque cause", () => {
  it("AC9 (b) : quota (SG001) -> compteur lu dans la transaction egal a 50, etat final 50 = 50", async () => {
    const org = await createOrganizationFixture("AC9 b quota");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    await seedLinks({ organizationId: org.organizationId, userId: org.owner.userId, collectionIds: [collectionId], count: 50 });
    const before = await linkState(org.organizationId);
    const ctx = { organizationId: org.organizationId, userId: org.owner.userId };

    const attempt = await attemptInsert(ctx, [org.organizationId, collectionId, uniqueUrl(), "Cinquante et unieme", org.owner.userId]);

    expect(attempt.failure?.code, `erreur : ${attempt.failure?.message}`).toBe("SG001");
    expect(attempt.counterInside, "l'increment du trigger est annule avec l'insertion refusee").toBe(50);
    await expectUnchanged(org.organizationId, before, "apres le refus de quota");
  });

  const checkCases: Array<[string, () => { url: string; title: string }]> = [
    ["URL ftp", () => ({ url: "ftp://exemple.invalid/x", title: "Titre" })],
    ["URL sans schema", () => ({ url: "exemple.invalid/x", title: "Titre" })],
    ["URL avec espace", () => ({ url: "https://exemple.invalid/a b", title: "Titre" })],
    ["URL de 7 caracteres", () => ({ url: "http://", title: "Titre" })],
    ["URL de 2049 caracteres", () => ({ url: urlOfLength(2049), title: "Titre" })],
    ["titre vide", () => ({ url: "https://exemple.invalid/x", title: "" })],
    ["titre fait d'espaces", () => ({ url: "https://exemple.invalid/x", title: "   " })],
    ["titre de 201 caracteres", () => ({ url: "https://exemple.invalid/x", title: "t".repeat(201) })],
  ];

  it.each(checkCases)("AC9 (b) : CHECK, %s (23514) -> compteur inchange", async (label, build) => {
    const org = await createOrganizationFixture("AC9 b check");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    await seedLinks({ organizationId: org.organizationId, userId: org.owner.userId, collectionIds: [collectionId], count: 3 });
    const before = await linkState(org.organizationId);
    const { url, title } = build();

    const attempt = await attemptInsert(
      { organizationId: org.organizationId, userId: org.owner.userId },
      [org.organizationId, collectionId, url, title, org.owner.userId],
    );

    expect(attempt.failure?.code, `${label} : ${attempt.failure?.message}`).toBe("23514");
    expect(attempt.counterInside).toBe(3);
    await expectUnchanged(org.organizationId, before, label);
  });

  it("AC9 (b) : cle etrangere (23503), collection d'une autre organisation sous un contexte valide -> compteur inchange", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const collectionA = await createCollectionViaApi(orgA.owner, orgA.organizationId, "Chez A");
    const collectionB = await createCollectionViaApi(orgB.owner, orgB.organizationId, "Chez B");
    await seedLinks({ organizationId: orgA.organizationId, userId: orgA.owner.userId, collectionIds: [collectionA], count: 2 });
    const beforeA = await linkState(orgA.organizationId);
    const beforeB = await linkState(orgB.organizationId);

    const attempt = await attemptInsert(
      { organizationId: orgA.organizationId, userId: orgA.owner.userId },
      [orgA.organizationId, collectionB, uniqueUrl(), "Collection de B", orgA.owner.userId],
    );

    expect(attempt.failure?.code, `erreur : ${attempt.failure?.message}`).toBe("23503");
    expect(attempt.counterInside, "l'increment du trigger est annule avec l'insertion refusee").toBe(2);
    await expectUnchanged(orgA.organizationId, beforeA, "A");
    await expectUnchanged(orgB.organizationId, beforeB, "B");
  });

  it("AC9 (b) : auteur inexistant (23503) -> compteur inchange", async () => {
    const org = await createOrganizationFixture("AC9 b auteur");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    const before = await linkState(org.organizationId);

    const attempt = await attemptInsert(
      { organizationId: org.organizationId, userId: org.owner.userId },
      [org.organizationId, collectionId, uniqueUrl(), "Auteur fantome", "00000000-0000-7000-8000-000000000bad"],
    );

    expect(attempt.failure?.code, `erreur : ${attempt.failure?.message}`).toBe("23503");
    expect(attempt.counterInside).toBe(0);
    await expectUnchanged(org.organizationId, before, "apres l'auteur fantome");
  });

  it("AC9 (b) : RLS (42501), lien d'une organisation sous le contexte d'une autre -> compteurs inchanges", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const collectionA = await createCollectionViaApi(orgA.owner, orgA.organizationId, "Chez A");
    await seedLinks({ organizationId: orgA.organizationId, userId: orgA.owner.userId, collectionIds: [collectionA], count: 2 });
    const beforeA = await linkState(orgA.organizationId);
    const beforeB = await linkState(orgB.organizationId);

    const attempt = await attemptInsert(
      { organizationId: orgB.organizationId, userId: orgB.owner.userId },
      [orgA.organizationId, collectionA, uniqueUrl(), "Intrusion", orgB.owner.userId],
    );

    expect(attempt.failure?.code, `erreur : ${attempt.failure?.message}`).toBe("42501");
    await expectUnchanged(orgA.organizationId, beforeA, "A");
    await expectUnchanged(orgB.organizationId, beforeB, "B");
  });

  it("AC9 (b) : un lot de plusieurs refus de causes differentes, puis un ajout valide -> le compteur ne derive pas", async () => {
    const org = await createOrganizationFixture("AC9 b lot");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    const ctx = { organizationId: org.organizationId, userId: org.owner.userId };

    for (const url of ["ftp://exemple.invalid/1", "exemple.invalid/2", "javascript:alert(1)"]) {
      const attempt = await attemptInsert(ctx, [org.organizationId, collectionId, url, "Refuse", org.owner.userId]);
      expect(attempt.failure?.code).toBe("23514");
    }
    expectStatus(await postLink(org.owner, org.organizationId, collectionId, { url: uniqueUrl(), title: "Valide" }), 201, "ajout valide");

    expect(await expectCounterAligned(org.organizationId, "apres le lot")).toEqual({ rows: 1, counter: 1 });
  });
});

describe("AC9 (c) — signet_app n'ecrit pas le compteur", () => {
  const statements: Array<[string, string]> = [
    ["INSERT", "INSERT INTO organization_link_usage (organization_id, link_count, link_quota) VALUES ($1, 0, NULL)"],
    ["UPDATE link_count", "UPDATE organization_link_usage SET link_count = 0 WHERE organization_id = $1"],
    ["UPDATE link_quota (lever le plafond)", "UPDATE organization_link_usage SET link_quota = NULL WHERE organization_id = $1"],
    ["DELETE", "DELETE FROM organization_link_usage WHERE organization_id = $1"],
  ];

  it.each(statements)("AC9 (c) : %s refuse a signet_app (42501), compteur intact", async (label, sql) => {
    const org = await createOrganizationFixture("AC9 c ecriture");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    await seedLinks({ organizationId: org.organizationId, userId: org.owner.userId, collectionIds: [collectionId], count: 4 });
    const before = await linkState(org.organizationId);

    const failure = await asTenant({ organizationId: org.organizationId, userId: org.owner.userId }, (client) =>
      failureOf(() => client.query(sql, [org.organizationId])),
    );

    expect(failure, `${label} doit etre refuse`).toBeDefined();
    expect(failure?.code, `${label} : ${failure?.message}`).toBe("42501");
    await expectUnchanged(org.organizationId, before, label);
  });

  it("AC9 (c) : signet_app ne peut ni modifier ni supprimer un lien (le compteur ne peut donc pas diverger par ces chemins)", async () => {
    const org = await createOrganizationFixture("AC9 c lien");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    await seedLinks({ organizationId: org.organizationId, userId: org.owner.userId, collectionIds: [collectionId], count: 2 });
    const ctx = { organizationId: org.organizationId, userId: org.owner.userId };

    for (const sql of [
      "UPDATE link SET title = 'modifie' WHERE organization_id = $1",
      "DELETE FROM link WHERE organization_id = $1",
      "TRUNCATE link",
    ]) {
      const failure = await asTenant(ctx, (client) => failureOf(() => client.query(sql, sql.startsWith("TRUNCATE") ? [] : [org.organizationId])));
      expect(failure?.code, `${sql} : ${failure?.message}`).toBe("42501");
    }
    expect(await expectCounterAligned(org.organizationId, "apres les ecritures refusees")).toEqual({ rows: 2, counter: 2 });
  });
});

describe("AC9 (d) — compteur manquant : invariant rompu, jamais absorbe", () => {
  async function deleteCounter(organizationId: string): Promise<void> {
    await asBypassRls(async (client) => {
      const result = await client.query("DELETE FROM organization_link_usage WHERE organization_id = $1", [organizationId]);
      expect(result.rowCount, "arrangement : suppression du compteur").toBe(1);
    });
  }

  it("AC9 (d) : en base, sans ligne de compteur, toute insertion de lien echoue (P0001), aucune ligne", async () => {
    const org = await createOrganizationFixture("AC9 d base");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    await deleteCounter(org.organizationId);

    const failure = await asTenant({ organizationId: org.organizationId, userId: org.owner.userId }, (client) =>
      failureOf(() => client.query(INSERT_LINK_SQL, [org.organizationId, collectionId, uniqueUrl(), "Sans compteur", org.owner.userId])),
    );

    expect(failure, "l'insertion doit echouer").toBeDefined();
    expect(failure?.code, `erreur : ${failure?.message}`).toBe("P0001");
    expect(await countLinks(org.organizationId)).toBe(0);
  });

  it("AC9 (d) : par l'API -> 500 generique, sans code SQL, message de base ni identifiant, aucune ligne", async () => {
    const org = await createOrganizationFixture("AC9 d api");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    await deleteCounter(org.organizationId);

    const result = await postLink(org.owner, org.organizationId, collectionId, { url: uniqueUrl(), title: "Sans compteur" });

    expect(result.status, `corps brut : ${result.text}`).toBe(500);
    expectCleanErrorBody(result, "500 sans compteur", [org.organizationId, collectionId, org.owner.userId]);
    expect(await countLinks(org.organizationId)).toBe(0);
  });
});

describe("AC13 (a) — la fonction de trigger n'est pas appelable par signet_app", () => {
  it("AC13 (a) : SELECT signet.link_usage_on_insert() sous signet_app est refuse (42501)", async () => {
    const org = await createOrganizationFixture("AC13 a appel direct");
    const before: LinkState = await linkState(org.organizationId);

    const failure = await asTenant({ organizationId: org.organizationId, userId: org.owner.userId }, (client) =>
      failureOf(() => client.query("SELECT signet.link_usage_on_insert()")),
    );

    expect(failure, "l'appel direct doit etre refuse").toBeDefined();
    expect(failure?.code, `erreur : ${failure?.message}`).toBe("42501");
    await expectUnchanged(org.organizationId, before, "apres l'appel direct");
  });
});
