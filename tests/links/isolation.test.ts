/**
 * Tranche 005 — AC5 : isolation tenant (US-09) et AC13 (b), (c) : le trigger de
 * compteur sous contexte etranger.
 *
 * (a), (b), (e) par l'API avec deux tenants reels ; (c) directement en base,
 * sous le role applicatif `signet_app`, contexte etranger force : la RLS doit
 * refuser seule, sans l'aide du controle applicatif ; (d) la cle composite,
 * sous la connexion d'administration (qui contourne la RLS, donc seule la cle
 * etrangere peut refuser). Les lectures de controle (administration) sont
 * filtrees par les identifiants de l'organisation du test.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { asBypassRls, asTenant, closeAllPools } from "../helpers/db";
import { createOrganizationFixture, createTwoOrganizationsFixture } from "../helpers/fixtures";
import { expectError, expectStatus } from "../helpers/billing";
import {
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
  readLinks,
  seedLinks,
  uniqueUrl,
} from "../helpers/links";
import { createMemberSession } from "../helpers/collections";

afterAll(async () => {
  await closeLinkPools();
  await closeAllPools();
});

describe("AC5 (a) — isolation par l'API : organisation", () => {
  it("AC5 (a) : l'owner de B ajoute un lien dans une collection de A via le chemin de A -> 404 ORGANIZATION_NOT_FOUND, corps strictement identique a celui d'un UUID inexistant, rien d'ecrit", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const collectionA = await createCollectionViaApi(orgA.owner, orgA.organizationId, "Veille");
    const beforeA = await linkState(orgA.organizationId);
    const beforeB = await linkState(orgB.organizationId);
    const payload = { url: uniqueUrl(), title: "Intrusion" };

    const foreign = await postLink(orgB.owner, orgA.organizationId, collectionA, payload);
    const unknown = await postLink(orgB.owner, randomUUID(), collectionA, payload);

    expectError(foreign, 404, "ORGANIZATION_NOT_FOUND", "owner de B vers A");
    expectError(unknown, 404, "ORGANIZATION_NOT_FOUND", "owner de B vers un UUID d'organisation inexistant");
    expect(foreign.text, "corps octet pour octet identiques").toBe(unknown.text);
    await expectUnchanged(orgA.organizationId, beforeA, "A");
    await expectUnchanged(orgB.organizationId, beforeB, "B");
    expect(await readLinks(orgA.organizationId)).toEqual([]);
    expect(await readLinks(orgB.organizationId)).toEqual([]);

    const witness = await postLink(orgA.owner, orgA.organizationId, collectionA, payload);
    expectStatus(witness, 201, "temoin : l'owner de A ajoute chez lui");
    await expectCounterAligned(orgA.organizationId, "A apres le temoin");
  });

  it("AC5 (a) : un utilisateur sans aucune organisation recoit le meme 404", async () => {
    const { orgA } = await createTwoOrganizationsFixture();
    const collectionA = await createCollectionViaApi(orgA.owner, orgA.organizationId, "Veille");
    const lonely = await createOrganizationFixture("AC5 a isole");
    const payload = { url: uniqueUrl(), title: "Intrusion" };

    const foreign = await postLink(lonely.owner, orgA.organizationId, collectionA, payload);
    const unknown = await postLink(lonely.owner, randomUUID(), collectionA, payload);

    expectError(foreign, 404, "ORGANIZATION_NOT_FOUND", "tiers vers A");
    expect(foreign.text).toBe(unknown.text);
    expect(await countLinks(orgA.organizationId)).toBe(0);
    await expectCounterAligned(orgA.organizationId, "A");
  });

  it("AC5 (a) : le corps d'un 404 d'organisation ne contient ni identifiant ni fragment SQL", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const collectionA = await createCollectionViaApi(orgA.owner, orgA.organizationId, "Veille");

    const foreign = await postLink(orgB.owner, orgA.organizationId, collectionA, { url: uniqueUrl(), title: "Intrusion" });

    expectError(foreign, 404, "ORGANIZATION_NOT_FOUND", "tiers vers A");
    expectCleanErrorBody(foreign, "404 organisation", [orgA.organizationId, collectionA, orgB.owner.userId]);
  });
});

describe("AC5 (b) — isolation par l'API : collection", () => {
  it("AC5 (b) : un membre de A, sous le chemin de A, vise une collection de B -> 404 COLLECTION_NOT_FOUND, corps strictement identique a celui d'un UUID de collection inexistant", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const member = await createMemberSession(orgA.organizationId);
    const collectionB = await createCollectionViaApi(orgB.owner, orgB.organizationId, "Chez B");
    const beforeA = await linkState(orgA.organizationId);
    const beforeB = await linkState(orgB.organizationId);
    const payload = { url: uniqueUrl(), title: "Collection etrangere" };

    for (const [label, session] of [
      ["owner de A", orgA.owner],
      ["member de A", member],
    ] as const) {
      const foreign = await postLink(session, orgA.organizationId, collectionB, payload);
      const unknown = await postLink(session, orgA.organizationId, randomUUID(), payload);

      expectError(foreign, 404, "COLLECTION_NOT_FOUND", `${label} vers une collection de B`);
      expectError(unknown, 404, "COLLECTION_NOT_FOUND", `${label} vers une collection inexistante`);
      expect(foreign.text, `${label} : corps octet pour octet identiques`).toBe(unknown.text);
      expectCleanErrorBody(foreign, `${label} : 404 collection`, [collectionB, orgB.organizationId]);
    }

    expect(await readLinks(orgA.organizationId)).toEqual([]);
    expect(await readLinks(orgB.organizationId)).toEqual([]);
    await expectUnchanged(orgA.organizationId, beforeA, "A");
    await expectUnchanged(orgB.organizationId, beforeB, "B");
  });

  it("AC5 (b) : l'owner de B qui vise B dans le chemin avec la collection de A recoit aussi 404 COLLECTION_NOT_FOUND", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const collectionA = await createCollectionViaApi(orgA.owner, orgA.organizationId, "Chez A");
    const beforeA = await linkState(orgA.organizationId);
    const beforeB = await linkState(orgB.organizationId);

    const result = await postLink(orgB.owner, orgB.organizationId, collectionA, { url: uniqueUrl(), title: "Collection d'A" });

    expectError(result, 404, "COLLECTION_NOT_FOUND", "owner de B, collection de A");
    await expectUnchanged(orgA.organizationId, beforeA, "A");
    await expectUnchanged(orgB.organizationId, beforeB, "B");
  });

  it("AC5 (b) : un organizationId = B et un collectionId = collection de B dans le corps, sous le chemin de A, ne changent rien (le chemin fait autorite)", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const collectionA = await createCollectionViaApi(orgA.owner, orgA.organizationId, "Chez A");
    const collectionB = await createCollectionViaApi(orgB.owner, orgB.organizationId, "Chez B");

    const result = await postLink(orgA.owner, orgA.organizationId, collectionA, {
      url: uniqueUrl(),
      title: "Corps etranger",
      organizationId: orgB.organizationId,
      collectionId: collectionB,
    });

    expectStatus(result, 201, "corps portant B");
    expect((await readLinks(orgA.organizationId)).map((r) => r.collection_id)).toEqual([collectionA]);
    expect(await readLinks(orgB.organizationId)).toEqual([]);
    await expectCounterAligned(orgA.organizationId, "A");
    await expectCounterAligned(orgB.organizationId, "B");
  });
});

describe("AC5 (c) et AC13 (c) — contexte etranger force en base, role signet_app", () => {
  const selectSql = "SELECT id FROM link WHERE organization_id = $1";

  /** Precondition : un refus 42501 ne peut venir que de la RLS, pas d'un GRANT manquant. */
  async function expectAppCanInsertLink(): Promise<void> {
    const { rows } = await asBypassRls((client) =>
      client.query<{ ok: boolean }>("SELECT has_table_privilege('signet_app', 'public.link', 'INSERT') AS ok"),
    );
    expect(rows[0]?.ok, "precondition : signet_app detient INSERT sur link (migration 0017 attendue)").toBe(true);
  }

  async function fixture() {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const collectionA = await createCollectionViaApi(orgA.owner, orgA.organizationId, "Chez A");
    const collectionB = await createCollectionViaApi(orgB.owner, orgB.organizationId, "Chez B");
    await seedLinks({ organizationId: orgA.organizationId, userId: orgA.owner.userId, collectionIds: [collectionA], count: 2 });
    return { orgA, orgB, collectionA, collectionB };
  }

  it("AC5 (c) : contexte A + owner de B -> SELECT ne rend aucune ligne de A ; l'owner de A, lui, les voit (temoin)", async () => {
    const { orgA, orgB } = await fixture();
    await expectAppCanInsertLink();

    const witness = await asTenant({ organizationId: orgA.organizationId, userId: orgA.owner.userId }, async (client) =>
      (await client.query<{ id: string }>(selectSql, [orgA.organizationId])).rows,
    );
    expect(witness, "temoin positif : l'owner de A voit ses deux liens").toHaveLength(2);

    const seen = await asTenant({ organizationId: orgA.organizationId, userId: orgB.owner.userId }, async (client) => ({
      byOrg: (await client.query<{ id: string }>(selectSql, [orgA.organizationId])).rows,
      byId: (await client.query<{ id: string }>("SELECT id FROM link WHERE id = $1", [witness[0]?.id])).rows,
    }));
    expect(seen).toEqual({ byOrg: [], byId: [] });
  });

  it("AC5 (c) et AC13 (c) : contexte A + owner de B -> INSERT d'un lien de A refuse par la RLS (42501), compteurs de A et de B inchanges", async () => {
    const { orgA, orgB, collectionA } = await fixture();
    await expectAppCanInsertLink();
    const beforeA = await linkState(orgA.organizationId);
    const beforeB = await linkState(orgB.organizationId);

    const failure = await asTenant({ organizationId: orgA.organizationId, userId: orgB.owner.userId }, (client) =>
      failureOf(() => client.query(INSERT_LINK_SQL, [orgA.organizationId, collectionA, uniqueUrl(), "Intrusion", orgB.owner.userId])),
    );

    expect(failure, "INSERT dans A sous contexte etranger doit etre refuse").toBeDefined();
    expect(failure?.code, `refus par la RLS (${failure?.message})`).toBe("42501");
    await expectUnchanged(orgA.organizationId, beforeA, "A");
    await expectUnchanged(orgB.organizationId, beforeB, "B");
  });

  it("AC5 (c) : contexte B (owner de B) -> INSERT d'un lien dont organization_id = A refuse par le WITH CHECK (42501) ; le meme INSERT dans B reussit (temoin)", async () => {
    const { orgA, orgB, collectionA, collectionB } = await fixture();
    await expectAppCanInsertLink();
    const ctxB = { organizationId: orgB.organizationId, userId: orgB.owner.userId };
    const beforeA = await linkState(orgA.organizationId);

    const failure = await asTenant(ctxB, (client) =>
      failureOf(() => client.query(INSERT_LINK_SQL, [orgA.organizationId, collectionA, uniqueUrl(), "Intrusion", orgB.owner.userId])),
    );
    expect(failure, "INSERT organization_id = A depuis le contexte B doit etre refuse").toBeDefined();
    expect(failure?.code, `refus par WITH CHECK (${failure?.message})`).toBe("42501");

    const inserted = await asTenant(ctxB, async (client) =>
      (await client.query<{ id: string }>(INSERT_LINK_SQL, [orgB.organizationId, collectionB, uniqueUrl(), "Chez moi", orgB.owner.userId])).rows,
    );
    expect(inserted, "temoin positif : l'INSERT dans le contexte legitime reussit").toHaveLength(1);
    await expectUnchanged(orgA.organizationId, beforeA, "A");
    await expectCounterAligned(orgB.organizationId, "B (la transaction du temoin est annulee)");
  });

  it("AC5 (c) : sans app.user_id, aucun lien visible ni inserable malgre un app.organization_id valide", async () => {
    const { orgA, collectionA } = await fixture();
    await expectAppCanInsertLink();

    const seen = await asTenant({ organizationId: orgA.organizationId }, async (client) =>
      (await client.query<{ id: string }>(selectSql, [orgA.organizationId])).rows,
    );
    expect(seen).toEqual([]);

    const failure = await asTenant({ organizationId: orgA.organizationId }, (client) =>
      failureOf(() => client.query(INSERT_LINK_SQL, [orgA.organizationId, collectionA, uniqueUrl(), "Anonyme", orgA.owner.userId])),
    );
    expect(failure?.code, `refus par la RLS (${failure?.message})`).toBe("42501");
    await expectCounterAligned(orgA.organizationId, "A");
  });

  it("AC13 (c) : sous contexte etranger, la table de compteur de A reste illisible et inchangee", async () => {
    const { orgA, orgB } = await fixture();
    const beforeA = await linkState(orgA.organizationId);

    const visible = await asTenant({ organizationId: orgA.organizationId, userId: orgB.owner.userId }, async (client) =>
      (await client.query<{ organization_id: string }>("SELECT organization_id FROM organization_link_usage WHERE organization_id = $1", [orgA.organizationId])).rows,
    );

    expect(visible).toEqual([]);
    await expectUnchanged(orgA.organizationId, beforeA, "A");
  });

  it("AC5 (c) : un member de A voit et ajoute dans A sous son propre contexte (la RLS n'exige pas le role owner)", async () => {
    const { orgA, collectionA } = await fixture();
    const member = await createMemberSession(orgA.organizationId);

    const result = await asTenant({ organizationId: orgA.organizationId, userId: member.userId }, async (client) => ({
      seen: (await client.query<{ id: string }>(selectSql, [orgA.organizationId])).rows,
      inserted: (await client.query(INSERT_LINK_SQL, [orgA.organizationId, collectionA, uniqueUrl(), "Par un member", member.userId])).rowCount,
    }));

    expect(result.seen).toHaveLength(2);
    expect(result.inserted).toBe(1);
  });
});

describe("AC5 (d) — cle composite (collection_id, organization_id)", () => {
  const insertSql = "INSERT INTO link (organization_id, collection_id, url, title, added_by_user_id) VALUES ($1, $2, $3, $4, $5)";

  it("AC5 (d) : sous la connexion d'administration, un lien organization_id = A et collection_id = collection de B est refuse (23503), aucune ligne, compteurs inchanges", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const collectionB = await createCollectionViaApi(orgB.owner, orgB.organizationId, "Chez B");
    const beforeA = await linkState(orgA.organizationId);
    const beforeB = await linkState(orgB.organizationId);

    const failure = await failureOf(() =>
      asBypassRls((client) => client.query(insertSql, [orgA.organizationId, collectionB, uniqueUrl(), "Croise", orgA.owner.userId])),
    );

    expect(failure, "le lien croise doit etre refuse").toBeDefined();
    expect(failure?.code, failure?.message).toBe("23503");
    expect(await readLinks(orgA.organizationId)).toEqual([]);
    expect(await readLinks(orgB.organizationId)).toEqual([]);
    await expectUnchanged(orgA.organizationId, beforeA, "A");
    await expectUnchanged(orgB.organizationId, beforeB, "B");
  });

  it("AC5 (d) : le sens inverse (organization_id = B, collection de A) est refuse de la meme facon", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const collectionA = await createCollectionViaApi(orgA.owner, orgA.organizationId, "Chez A");

    const failure = await failureOf(() =>
      asBypassRls((client) => client.query(insertSql, [orgB.organizationId, collectionA, uniqueUrl(), "Croise", orgB.owner.userId])),
    );

    expect(failure?.code, failure?.message).toBe("23503");
    await expectCounterAligned(orgA.organizationId, "A");
    await expectCounterAligned(orgB.organizationId, "B");
  });

  it("AC5 (d) : un lien dont la collection n'existe pas est refuse (23503) ; le meme lien dans une collection de l'organisation est accepte (temoin)", async () => {
    const org = await createOrganizationFixture("AC5 d inexistante");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");

    const failure = await failureOf(() =>
      asBypassRls((client) => client.query(insertSql, [org.organizationId, randomUUID(), uniqueUrl(), "Orphelin", org.owner.userId])),
    );
    expect(failure?.code, failure?.message).toBe("23503");

    await asBypassRls((client) => client.query(insertSql, [org.organizationId, collectionId, uniqueUrl(), "Legitime", org.owner.userId]));
    expect(await expectCounterAligned(org.organizationId, "apres le temoin")).toEqual({ rows: 1, counter: 1 });
  });
});

describe("AC5 (e) — les quotas sont par organisation", () => {
  it("AC5 (e) : B (Free) a 50 liens, A ajoute -> 201 ; les ajouts de A ne changent pas le compteur de B ; B, lui, est refuse (temoin)", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const collectionA = await createCollectionViaApi(orgA.owner, orgA.organizationId, "Chez A");
    const collectionB = await createCollectionViaApi(orgB.owner, orgB.organizationId, "Chez B");
    await seedLinks({ organizationId: orgB.organizationId, userId: orgB.owner.userId, collectionIds: [collectionB], count: 50 });
    expect(await linkState(orgB.organizationId), "precondition : B est a 50").toEqual({ rows: 50, counter: 50 });

    const inA = await postLink(orgA.owner, orgA.organizationId, collectionA, { url: uniqueUrl(), title: "Chez A" });
    const inB = await postLink(orgB.owner, orgB.organizationId, collectionB, { url: uniqueUrl(), title: "Chez B" });

    expectStatus(inA, 201, "A n'est pas gene par le quota de B");
    expectError(inB, 409, "FREE_TIER_QUOTA_EXCEEDED", "B est a son plafond");
    expect(await expectCounterAligned(orgA.organizationId, "A")).toEqual({ rows: 1, counter: 1 });
    expect(await expectCounterAligned(orgB.organizationId, "B")).toEqual({ rows: 50, counter: 50 });
  });
});

describe("AC13 (b) — la fonction definer se borne a NEW.organization_id", () => {
  it("AC13 (b) : sous la connexion d'administration avec app.organization_id = B, l'insertion d'un lien de A fait monter le compteur de A, jamais celui de B", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    const collectionA = await createCollectionViaApi(orgA.owner, orgA.organizationId, "Chez A");
    await seedLinks({ organizationId: orgB.organizationId, userId: orgB.owner.userId, collectionIds: [await createCollectionViaApi(orgB.owner, orgB.organizationId, "Chez B")], count: 3 });
    const beforeA = await linkState(orgA.organizationId);
    const beforeB = await linkState(orgB.organizationId);

    const inside = await asBypassRls(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query("SELECT set_config('app.organization_id', $1, true)", [orgB.organizationId]);
        await client.query(
          "INSERT INTO link (organization_id, collection_id, url, title, added_by_user_id) VALUES ($1, $2, $3, $4, $5)",
          [orgA.organizationId, collectionA, uniqueUrl(), "Sous contexte etranger", orgA.owner.userId],
        );
        const counters = await client.query<{ organization_id: string; link_count: number }>(
          "SELECT organization_id, link_count FROM organization_link_usage WHERE organization_id = ANY($1::uuid[])",
          [[orgA.organizationId, orgB.organizationId]],
        );
        return new Map(counters.rows.map((r) => [r.organization_id, r.link_count]));
      } finally {
        // Transaction toujours annulee : l'effet est lu a l'interieur, rien ne persiste.
        await client.query("ROLLBACK");
      }
    });

    expect(inside.get(orgA.organizationId), "le compteur de A augmente").toBe(beforeA.counter + 1);
    expect(inside.get(orgB.organizationId), "le compteur de B est inchange").toBe(beforeB.counter);
    await expectUnchanged(orgA.organizationId, beforeA, "A apres l'annulation");
    await expectUnchanged(orgB.organizationId, beforeB, "B apres l'annulation");
  });
});
