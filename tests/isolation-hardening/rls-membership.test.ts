/**
 * Tranche 010 — durcissement de l'isolation tenant (ADR-0011).
 *
 * AC2 (contexte force) et AC3 (echec ferme) : verifient directement en base,
 * sous `signet_app`, que la RLS exige desormais l'appartenance de
 * l'**utilisateur de session** (`app.user_id`) a l'organisation du contexte
 * (`app.organization_id`), et non plus seulement l'egalite brute de
 * `organization_id`. Jamais via la couche HTTP (ADR-0011, ERD §1) : le
 * controle applicatif existant (`renameOrganization`) ne doit pas masquer une
 * regression de la RLS elle-meme.
 *
 * Avant la migration 0009 (implementation de cette tranche), `current_org()`
 * ne verifie pas l'appartenance : ces tests echouent alors pour la bonne
 * raison ("fonctionnalite absente"), pas pour un defaut d'infrastructure —
 * voir le rapport de la tranche.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { asTenant, asTenantRaw, asBypassRls, getBypassRlsPool, resetDatabase, closeAllPools } from "../helpers/db";
import { createTwoOrganizationsFixture, addMemberDirect } from "../helpers/fixtures";
import { signUp } from "../helpers/auth";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeAllPools();
});

/** Une valeur UUID syntaxiquement valide mais garantie sans ligne `app_user`. */
const UNKNOWN_USER_ID = "00000000-0000-7000-8000-0000000000aa";

interface ReadableTable {
  table: string;
  sql: string;
}

const READS_ON_B: ReadableTable[] = [
  { table: "organization", sql: "SELECT id FROM organization WHERE id = $1" },
  { table: "member", sql: "SELECT id FROM member WHERE organization_id = $1" },
  {
    table: "organization_link_usage",
    sql: "SELECT organization_id FROM organization_link_usage WHERE organization_id = $1",
  },
  { table: "subscription", sql: "SELECT organization_id FROM subscription WHERE organization_id = $1" },
];

/**
 * SQLSTATE d'une violation de politique RLS a l'ecriture (« new row violates
 * row-level security policy »), ERRCODE_INSUFFICIENT_PRIVILEGE. Le meme code
 * signale un GRANT manquant : `expectAppCanInsertOrganization` etablit d'abord
 * que signet_app detient INSERT sur organization (0003), de sorte qu'un 42501
 * ne puisse venir que du WITH CHECK de la RLS.
 */
const RLS_VIOLATION = "42501";

async function expectAppCanInsertOrganization(): Promise<void> {
  const { rows } = await asBypassRls((client) =>
    client.query<{ ok: boolean }>("SELECT has_table_privilege('signet_app', 'public.organization', 'INSERT') AS ok"),
  );
  expect(rows[0]?.ok, "precondition : signet_app detient INSERT sur organization (0003)").toBe(true);
}

/** Slug conforme a organization_slug_format_chk, unique pour ne jamais buter sur l'index d'unicite. */
function freshSlug(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/**
 * Tente `INSERT INTO organization (id, ...)` sous signet_app avec le contexte
 * fourni ; renvoie l'erreur Postgres (ou `undefined` si l'INSERT a reussi).
 */
async function tryInsertOrganization(
  ctx: { organizationId?: string; userId?: string },
  id: string,
  label: string,
): Promise<{ code?: string } | undefined> {
  try {
    await asTenant(ctx, async (client) => {
      await client.query("INSERT INTO organization (id, name, slug) VALUES ($1, $2, $3)", [
        id,
        `Piratee (${label})`,
        freshSlug("piratee"),
      ]);
    });
    return undefined;
  } catch (err) {
    return err as { code?: string };
  }
}

describe("AC2 — contexte force : org B + utilisateur membre de A seulement", () => {
  it.each([
    ["owner de A", "owner"] as const,
    ["member (non owner) de A", "member"] as const,
  ])("AC2 : %s ne voit aucune ligne de B (organization/member/organization_link_usage/subscription)", async (_label, role) => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    let sessionUserId = orgA.owner.userId;
    if (role === "member") {
      const memberSession = await signUp();
      await addMemberDirect({ organizationId: orgA.organizationId, userId: memberSession.userId, role: "member" });
      sessionUserId = memberSession.userId;
    }

    for (const { table, sql } of READS_ON_B) {
      const rows = await asTenant(
        { organizationId: orgB.organizationId, userId: sessionUserId },
        async (client) => (await client.query<Record<string, unknown>>(sql, [orgB.organizationId])).rows,
      );
      expect(rows, `table ${table} : contexte force sur B avec un utilisateur de A seulement`).toEqual([]);
    }
  });

  it.each([
    ["owner de A", "owner"] as const,
    ["member (non owner) de A", "member"] as const,
  ])("AC2 : %s ne voit aucun compte app_user de B (via co-appartenance)", async (_label, role) => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    let sessionUserId = orgA.owner.userId;
    if (role === "member") {
      const memberSession = await signUp();
      await addMemberDirect({ organizationId: orgA.organizationId, userId: memberSession.userId, role: "member" });
      sessionUserId = memberSession.userId;
    }

    const rows = await asTenant(
      { organizationId: orgB.organizationId, userId: sessionUserId },
      async (client) => (await client.query<Record<string, unknown>>("SELECT id FROM app_user WHERE id = $1", [orgB.owner.userId])).rows,
    );
    expect(rows).toEqual([]);
  });

  it.each([
    ["owner de A", "owner"] as const,
    ["member (non owner) de A", "member"] as const,
  ])("AC2 : %s ne peut pas modifier organization de B (UPDATE touche 0 ligne)", async (_label, role) => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    let sessionUserId = orgA.owner.userId;
    if (role === "member") {
      const memberSession = await signUp();
      await addMemberDirect({ organizationId: orgA.organizationId, userId: memberSession.userId, role: "member" });
      sessionUserId = memberSession.userId;
    }

    const rowCount = await asTenant(
      { organizationId: orgB.organizationId, userId: sessionUserId },
      async (client) =>
        (await client.query("UPDATE organization SET name = 'Piratee (AC2)' WHERE id = $1", [orgB.organizationId]))
          .rowCount,
    );
    expect(rowCount).toBe(0);
  });

  /**
   * INSERT (review-010 BLOQUANT-1) : signet_app detient INSERT sur
   * organization. Avec l'ancienne current_org() brute, (1) l'id de B passait
   * le WITH CHECK et n'echouait que sur la cle primaire (23505), (2) un id
   * neuf pose comme contexte etait INSERE (organisation sans owner, hors de
   * create_organization). Exiger 42501 discrimine les deux.
   */
  it.each([
    ["owner de A", "owner"] as const,
    ["member (non owner) de A", "member"] as const,
  ])("AC2 : %s ne peut pas inserer organization avec l'id de B (42501, violation RLS)", async (_label, role) => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    let sessionUserId = orgA.owner.userId;
    if (role === "member") {
      const memberSession = await signUp();
      await addMemberDirect({ organizationId: orgA.organizationId, userId: memberSession.userId, role: "member" });
      sessionUserId = memberSession.userId;
    }
    await expectAppCanInsertOrganization();

    const err = await tryInsertOrganization(
      { organizationId: orgB.organizationId, userId: sessionUserId },
      orgB.organizationId,
      "AC2 insert id B",
    );
    expect(err, "INSERT INTO organization (id = B) sous contexte force doit etre refuse").toBeDefined();
    expect(err?.code).toBe(RLS_VIOLATION);
  });

  it.each([
    ["owner de A", "owner"] as const,
    ["member (non owner) de A", "member"] as const,
  ])("AC2 : %s ne peut pas inserer organization avec un id neuf pose comme contexte (42501)", async (_label, role) => {
    const { orgA } = await createTwoOrganizationsFixture();
    let sessionUserId = orgA.owner.userId;
    if (role === "member") {
      const memberSession = await signUp();
      await addMemberDirect({ organizationId: orgA.organizationId, userId: memberSession.userId, role: "member" });
      sessionUserId = memberSession.userId;
    }
    await expectAppCanInsertOrganization();
    const newOrganizationId = randomUUID();

    const err = await tryInsertOrganization(
      { organizationId: newOrganizationId, userId: sessionUserId },
      newOrganizationId,
      "AC2 insert id neuf",
    );
    expect(err, "INSERT INTO organization (id neuf = contexte) doit etre refuse").toBeDefined();
    expect(err?.code).toBe(RLS_VIOLATION);
  });
});

describe("AC3 — echec ferme : identite de session absente, inconnue ou malformee", () => {
  it("AC3 (a) : sans app.user_id, INSERT organization avec un id neuf pose comme contexte est refuse (42501)", async () => {
    await expectAppCanInsertOrganization();
    const newOrganizationId = randomUUID();

    const err = await tryInsertOrganization(
      { organizationId: newOrganizationId },
      newOrganizationId,
      "AC3a insert id neuf",
    );
    expect(err, "INSERT INTO organization sans app.user_id doit etre refuse").toBeDefined();
    expect(err?.code).toBe(RLS_VIOLATION);
  });

  /**
   * AC3 (a)/(b)/(c vide) sur les tables que les tests ci-dessous
   * (organization, member) ne couvrent pas : organization_link_usage,
   * subscription, et app_user (politique propre, co-appartenance).
   */
  it.each([
    ["(a) sans app.user_id", undefined] as const,
    ["(b) app.user_id inconnu", UNKNOWN_USER_ID] as const,
    ["(c) app.user_id vide", ""] as const,
  ])("AC3 %s : aucune ligne organization_link_usage, subscription ni app_user visible", async (_label, userId) => {
    const { orgA } = await createTwoOrganizationsFixture();
    const reads = [
      ...READS_ON_B.filter((r) => r.table === "organization_link_usage" || r.table === "subscription"),
      { table: "app_user", sql: "SELECT id FROM app_user WHERE id = $1" },
    ];

    for (const { table, sql } of reads) {
      const param = table === "app_user" ? orgA.owner.userId : orgA.organizationId;
      const rows = await asTenantRaw(
        userId === undefined ? { organizationId: orgA.organizationId } : { organizationId: orgA.organizationId, userId },
        async (client) => (await client.query<Record<string, unknown>>(sql, [param])).rows,
      );
      expect(rows, `table ${table} : contexte A valide, identite de session ${_label}`).toEqual([]);
    }
  });

  it("AC3 (a) : sans app.user_id, aucune ligne organization visible malgre un app.organization_id valide", async () => {
    const { orgA } = await createTwoOrganizationsFixture();

    const rows = await asTenant({ organizationId: orgA.organizationId }, async (client) => {
      const result = await client.query<Record<string, unknown>>("SELECT id FROM organization WHERE id = $1", [orgA.organizationId]);
      return result.rows;
    });

    expect(rows).toEqual([]);
  });

  it("AC3 (a) : sans app.user_id, aucune ligne member visible malgre un app.organization_id valide", async () => {
    const { orgA } = await createTwoOrganizationsFixture();

    const rows = await asTenant({ organizationId: orgA.organizationId }, async (client) => {
      const result = await client.query<Record<string, unknown>>("SELECT id FROM member WHERE organization_id = $1", [orgA.organizationId]);
      return result.rows;
    });

    expect(rows).toEqual([]);
  });

  it("AC3 (a) : sans app.user_id, UPDATE organization touche 0 ligne malgre un app.organization_id valide", async () => {
    const { orgA } = await createTwoOrganizationsFixture();

    const rowCount = await asTenant({ organizationId: orgA.organizationId }, async (client) => {
      const result = await client.query("UPDATE organization SET name = 'Piratee (AC3a)' WHERE id = $1", [
        orgA.organizationId,
      ]);
      return result.rowCount;
    });

    expect(rowCount).toBe(0);
  });

  it("AC3 (b) : app.user_id inconnu (UUID sans ligne app_user), aucune ligne organization visible", async () => {
    const { orgA } = await createTwoOrganizationsFixture();

    const rows = await asTenant(
      { organizationId: orgA.organizationId, userId: UNKNOWN_USER_ID },
      async (client) => (await client.query<Record<string, unknown>>("SELECT id FROM organization WHERE id = $1", [orgA.organizationId])).rows,
    );

    expect(rows).toEqual([]);
  });

  it("AC3 (b) : app.user_id inconnu (UUID sans ligne app_user), aucune ligne member visible", async () => {
    const { orgA } = await createTwoOrganizationsFixture();

    const rows = await asTenant(
      { organizationId: orgA.organizationId, userId: UNKNOWN_USER_ID },
      async (client) => (await client.query<Record<string, unknown>>("SELECT id FROM member WHERE organization_id = $1", [orgA.organizationId])).rows,
    );

    expect(rows).toEqual([]);
  });

  it("AC3 (b) : app.user_id inconnu, UPDATE organization touche 0 ligne", async () => {
    const { orgA } = await createTwoOrganizationsFixture();

    const rowCount = await asTenant(
      { organizationId: orgA.organizationId, userId: UNKNOWN_USER_ID },
      async (client) =>
        (await client.query("UPDATE organization SET name = 'Piratee (AC3b)' WHERE id = $1", [orgA.organizationId]))
          .rowCount,
    );

    expect(rowCount).toBe(0);
  });

  /**
   * ADR-0011 §g : un `app.user_id` non-UUID fait lever le cast `::uuid`
   * (`22P02`) des la premiere politique qui l'evalue. C'est une erreur,
   * jamais une ligne. Le comportement retenu par l'ADR est epingle : 22P02
   * est EXIGE (review-010 SUGGESTION-2). Un « 0 ligne » silencieux
   * signalerait qu'une erreur de cast est avalee (option ecartee par l'ADR,
   * qui masquerait un defaut du serveur).
   */
  it("AC3 (c) : app.user_id malforme (pas un UUID) — lecture organization leve 22P02", async () => {
    const { orgA } = await createTwoOrganizationsFixture();

    await expect(
      asTenant(
        { organizationId: orgA.organizationId, userId: "not-a-uuid" },
        async (client) => (await client.query<Record<string, unknown>>("SELECT id FROM organization WHERE id = $1", [orgA.organizationId])).rows,
      ),
    ).rejects.toMatchObject({ code: "22P02" });
  });

  it("AC3 (c) : app.user_id malforme (pas un UUID) — lecture member leve 22P02", async () => {
    const { orgA } = await createTwoOrganizationsFixture();

    await expect(
      asTenant(
        { organizationId: orgA.organizationId, userId: "not-a-uuid" },
        async (client) => (await client.query<Record<string, unknown>>("SELECT id FROM member WHERE organization_id = $1", [orgA.organizationId])).rows,
      ),
    ).rejects.toMatchObject({ code: "22P02" });
  });

  it("AC3 (c) : app.user_id malforme (pas un UUID) — UPDATE organization leve 22P02", async () => {
    const { orgA } = await createTwoOrganizationsFixture();

    await expect(
      asTenant(
        { organizationId: orgA.organizationId, userId: "not-a-uuid" },
        async (client) =>
          (await client.query("UPDATE organization SET name = 'Piratee (AC3c)' WHERE id = $1", [orgA.organizationId]))
            .rowCount,
      ),
    ).rejects.toMatchObject({ code: "22P02" });
  });

  /**
   * AC3 (c), second cas : app.user_id vide. Distinct de "absent" — `asTenantRaw`
   * pose explicitement `SET LOCAL app.user_id = ''` (`asTenant` ignorerait cet
   * appel, cf. son commentaire). ADR-0011 §g : `nullif('', '')` ramene cette
   * valeur a `NULL`, fermeture par defaut, jamais d'erreur ici.
   */
  it("AC3 (c) : app.user_id vide — aucune ligne organization, sans erreur (fermeture par defaut)", async () => {
    const { orgA } = await createTwoOrganizationsFixture();

    const rows = await asTenantRaw(
      { organizationId: orgA.organizationId, userId: "" },
      async (client) => (await client.query<Record<string, unknown>>("SELECT id FROM organization WHERE id = $1", [orgA.organizationId])).rows,
    );

    expect(rows).toEqual([]);
  });

  it("AC3 (c) : app.user_id vide — aucune ligne member, sans erreur (fermeture par defaut)", async () => {
    const { orgA } = await createTwoOrganizationsFixture();

    const rows = await asTenantRaw(
      { organizationId: orgA.organizationId, userId: "" },
      async (client) => (await client.query<Record<string, unknown>>("SELECT id FROM member WHERE organization_id = $1", [orgA.organizationId])).rows,
    );

    expect(rows).toEqual([]);
  });

  it("AC3 (c) : app.user_id vide — UPDATE organization touche 0 ligne, sans erreur", async () => {
    const { orgA } = await createTwoOrganizationsFixture();

    const rowCount = await asTenantRaw(
      { organizationId: orgA.organizationId, userId: "" },
      async (client) =>
        (await client.query("UPDATE organization SET name = 'Piratee (AC3c-vide)' WHERE id = $1", [orgA.organizationId]))
          .rowCount,
    );

    expect(rowCount).toBe(0);
  });
});

describe("Cas limites (ADR-0011, tests exiges)", () => {
  /**
   * Recursion : la politique `signet_app` de `member` appelle `current_org()`,
   * qui s'execute sous `signet_definer` et relit elle-meme `member` — sans la
   * separation de politiques d'ADR-0011 (R1), Postgres refuserait
   * ("infinite recursion detected in policy for relation member") ou une
   * fonction SECURITY INVOKER ferait deborder la pile a l'execution. Un
   * contexte valide doit renvoyer exactement la ligne attendue, sans erreur.
   */
  it("Recursion : lecture de member sous signet_app avec un contexte valide renvoie la ligne attendue, sans erreur", async () => {
    const { orgA } = await createTwoOrganizationsFixture();

    const rows = await asTenant(
      { organizationId: orgA.organizationId, userId: orgA.owner.userId },
      async (client) => {
        const result = await client.query<{ user_id: string }>(
          "SELECT user_id FROM member WHERE organization_id = $1",
          [orgA.organizationId],
        );
        return result.rows;
      },
    );

    expect(rows).toEqual([{ user_id: orgA.owner.userId }]);
  });

  /**
   * Concurrence (ADR-0011 §c, STABLE), scenario du contrat : un RETRAIT DE
   * MEMBRE dans la transaction est vu par l'instruction suivante.
   *
   * `signet_app` n'a aucun privilege d'ecriture sur `member` (retrait de
   * membre = tranche 008). Le retrait est donc fait par la connexion
   * d'administration, DANS LA MEME transaction, entre deux lectures faites
   * sous `SET LOCAL ROLE signet_app` : ce sont ces lectures, soumises a la
   * RLS, que le test juge ; l'ecriture privilegiee ne fait que produire
   * l'etat. Transaction toujours annulee (`finally ROLLBACK`) : le DELETE ne
   * persiste jamais, et le constraint trigger differe member_keep_last_owner
   * ne s'execute pas (le membre retire n'est de toute facon pas l'owner).
   *
   * La volatilite STABLE elle-meme (et non IMMUTABLE) est epinglee par un
   * test de catalogue (definer-functions.test.ts) : sur des requetes non
   * preparees, un test comportemental ne distingue pas les deux.
   */
  it("Concurrence : un retrait de membre dans la transaction est pris en compte des l'instruction suivante", async () => {
    const { orgB } = await createTwoOrganizationsFixture();
    const memberSession = await signUp();
    await addMemberDirect({ organizationId: orgB.organizationId, userId: memberSession.userId, role: "member" });

    const client = await getBypassRlsPool().connect();
    try {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL ROLE signet_app");
        await client.query("SELECT set_config('app.organization_id', $1, true)", [orgB.organizationId]);
        await client.query("SELECT set_config('app.user_id', $1, true)", [memberSession.userId]);

        const before = await client.query<{ id: string }>("SELECT id FROM organization WHERE id = $1", [
          orgB.organizationId,
        ]);
        expect(before.rows, "avant retrait : le member de B voit B sous signet_app").toEqual([{ id: orgB.organizationId }]);

        await client.query("RESET ROLE");
        const removed = await client.query("DELETE FROM member WHERE organization_id = $1 AND user_id = $2", [
          orgB.organizationId,
          memberSession.userId,
        ]);
        expect(removed.rowCount, "retrait du membre non owner (administration)").toBe(1);

        await client.query("SET LOCAL ROLE signet_app");
        const who = await client.query<{ u: string }>("SELECT current_user AS u");
        expect(who.rows[0]?.u, "la relecture est bien jugee sous signet_app").toBe("signet_app");

        const afterOrg = await client.query("SELECT id FROM organization WHERE id = $1", [orgB.organizationId]);
        expect(afterOrg.rows, "instruction suivante : l'ancien membre ne voit plus B").toEqual([]);
        const afterMember = await client.query("SELECT id FROM member WHERE organization_id = $1", [
          orgB.organizationId,
        ]);
        expect(afterMember.rows, "instruction suivante : l'ancien membre ne voit plus les membres de B").toEqual([]);
      } finally {
        await client.query("ROLLBACK");
      }
    } finally {
      client.release();
    }
  });

  /**
   * Complement : le contexte de session (app.user_id) change entre deux
   * instructions de la meme transaction. Premiere version du cas limite
   * (substitut au retrait de membre, remplace comme preuve principale par le
   * test ci-dessus, review-010 A CORRIGER-1) ; conservee comme couverture
   * supplementaire.
   */
  it("Concurrence : un changement de app.user_id au sein de la meme transaction est vu des l'instruction suivante", async () => {
    const { orgA } = await createTwoOrganizationsFixture();
    const outsider = await signUp(); // n'est membre d'aucune organisation

    await asTenant({ organizationId: orgA.organizationId, userId: orgA.owner.userId }, async (client) => {
      const asOwner = await client.query<Record<string, unknown>>("SELECT id FROM organization WHERE id = $1", [orgA.organizationId]);
      expect(asOwner.rows, "premiere instruction : owner de A voit A").toEqual([{ id: orgA.organizationId }]);

      // Meme transaction, meme connexion : seul app.user_id change.
      await client.query<Record<string, unknown>>("SELECT set_config('app.user_id', $1, true)", [outsider.userId]);

      const asOutsider = await client.query<Record<string, unknown>>("SELECT id FROM organization WHERE id = $1", [orgA.organizationId]);
      expect(
        asOutsider.rows,
        "instruction suivante, meme transaction : le nouveau contexte est pris en compte immediatement (pas de cache)",
      ).toEqual([]);
    });
  });

  /**
   * Permission insuffisante (US-08.2) : un member (non owner) de B, dans le
   * contexte B (son propre contexte, legitime), garde sa visibilite d'avant
   * sur organization/member/organization_link_usage, et ne voit toujours pas
   * subscription.
   */
  it("Permission insuffisante : un member non owner de B voit organization/member/organization_link_usage mais pas subscription", async () => {
    const { orgB } = await createTwoOrganizationsFixture();
    const memberSession = await signUp();
    await addMemberDirect({ organizationId: orgB.organizationId, userId: memberSession.userId, role: "member" });

    const [orgRows, memberRows, usageRows, subscriptionRows] = await asTenant(
      { organizationId: orgB.organizationId, userId: memberSession.userId },
      async (client) => {
        const org = await client.query<Record<string, unknown>>("SELECT id FROM organization WHERE id = $1", [orgB.organizationId]);
        const member = await client.query<Record<string, unknown>>("SELECT user_id FROM member WHERE organization_id = $1", [
          orgB.organizationId,
        ]);
        const usage = await client.query(
          "SELECT organization_id FROM organization_link_usage WHERE organization_id = $1",
          [orgB.organizationId],
        );
        const subscription = await client.query(
          "SELECT organization_id FROM subscription WHERE organization_id = $1",
          [orgB.organizationId],
        );
        return [org.rows, member.rows, usage.rows, subscription.rows];
      },
    );

    expect(orgRows).toEqual([{ id: orgB.organizationId }]);
    expect(memberRows.map((r) => String(r.user_id)).sort()).toEqual(
      [orgB.owner.userId, memberSession.userId].sort(),
    );
    expect(usageRows).toEqual([{ organization_id: orgB.organizationId }]);
    expect(subscriptionRows).toEqual([]);
  });
});
