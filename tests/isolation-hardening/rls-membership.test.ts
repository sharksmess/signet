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
import { asTenant, asTenantRaw, resetDatabase, closeAllPools } from "../helpers/db";
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
});

describe("AC3 — echec ferme : identite de session absente, inconnue ou malformee", () => {
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
   * jamais une ligne : les deux issues sont acceptables, le rendu d'une
   * ligne ne l'est jamais.
   */
  it("AC3 (c) : app.user_id malforme (pas un UUID) — jamais de ligne organization, erreur 22P02 tolerable", async () => {
    const { orgA } = await createTwoOrganizationsFixture();

    try {
      const rows = await asTenant(
        { organizationId: orgA.organizationId, userId: "not-a-uuid" },
        async (client) => (await client.query<Record<string, unknown>>("SELECT id FROM organization WHERE id = $1", [orgA.organizationId])).rows,
      );
      expect(rows).toEqual([]);
    } catch (err) {
      expect(err).toMatchObject({ code: "22P02" });
    }
  });

  it("AC3 (c) : app.user_id malforme (pas un UUID) — jamais de ligne member, erreur 22P02 tolerable", async () => {
    const { orgA } = await createTwoOrganizationsFixture();

    try {
      const rows = await asTenant(
        { organizationId: orgA.organizationId, userId: "not-a-uuid" },
        async (client) => (await client.query<Record<string, unknown>>("SELECT id FROM member WHERE organization_id = $1", [orgA.organizationId])).rows,
      );
      expect(rows).toEqual([]);
    } catch (err) {
      expect(err).toMatchObject({ code: "22P02" });
    }
  });

  it("AC3 (c) : app.user_id malforme (pas un UUID) — UPDATE organization jamais applique, erreur 22P02 tolerable", async () => {
    const { orgA } = await createTwoOrganizationsFixture();

    try {
      const rowCount = await asTenant(
        { organizationId: orgA.organizationId, userId: "not-a-uuid" },
        async (client) =>
          (await client.query("UPDATE organization SET name = 'Piratee (AC3c)' WHERE id = $1", [orgA.organizationId]))
            .rowCount,
      );
      expect(rowCount).toBe(0);
    } catch (err) {
      expect(err).toMatchObject({ code: "22P02" });
    }
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
   * Concurrence (ADR-0011 §c, STABLE) : `current_org()` ne doit pas mettre en
   * cache son resultat au-dela d'une seule instruction — un changement
   * d'appartenance dans la transaction doit etre vu par l'instruction
   * suivante. Le scenario litteral du contrat ("retrait de membre pris en
   * compte dans la meme transaction") n'est PAS reproductible avec les
   * moyens de cette tranche : `signet_app` n'a aucun privilege d'ecriture sur
   * `member` (migration 0003 : `GRANT SELECT` seul — le retrait de membre est
   * la tranche 008, hors perimetre), et forcer l'ecriture via `asBypassRls`
   * tricherait precisement la garantie a prouver (interdit explicitement par
   * le contrat de la tranche). Le mecanisme sous-jacent que ce cas limite
   * protege est le meme quel que soit ce qui varie entre deux instructions
   * de la transaction : la valeur de `app.user_id` (posee par SET LOCAL,
   * seul levier legitimement disponible a `signet_app`) change entre deux
   * requetes de la MEME transaction, et la seconde requete doit refleter le
   * nouveau contexte immediatement — pas une valeur mise en cache depuis la
   * premiere requete de la transaction. C'est exactement la propriete
   * `STABLE` (par instruction, jamais par transaction) que le retrait de
   * membre exploiterait une fois disponible.
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
