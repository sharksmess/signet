/**
 * Tests de creation d'organisation — `POST /api/organizations`.
 * Source : docs/03-slices/001-creation-organisation.md (AC1, AC3, AC4)
 *          docs/02-architecture/api-contracts/organizations.ts (contrat, lecture seule)
 *
 * Ecrits avant l'implementation : ils echouent aujourd'hui parce que
 * `apps/web`, `packages/db` et la base de test n'existent pas encore, pas a
 * cause d'une erreur de configuration de ce fichier.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createOrganization as createOrganizationOutput } from "../../docs/02-architecture/api-contracts/organizations";
import { createOrganization } from "../helpers/organizationsApi";
import { signUp, uniqueEmail } from "../helpers/auth";
import { asTenant, resetDatabase, closeAllPools } from "../helpers/db";
import { countOrganizationsDirect } from "../helpers/fixtures";

beforeAll(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeAllPools();
});

describe("POST /api/organizations", () => {
  it("AC1 : creation nominale — reponse et etat base coherents dans la meme transaction", async () => {
    const session = await signUp();

    const { status, body } = await createOrganization(session, { name: "Acme Corp" });

    expect(status).toBe(201);
    // La reponse respecte exactement la forme du contrat (source de verite unique).
    const parsed = createOrganizationOutput.output.parse(body);
    expect(parsed.role).toBe("owner");
    expect(parsed.name).toBe("Acme Corp");

    // Effets de bord garantis "dans la meme transaction que sa creation" (AC1) :
    // deja visibles immediatement apres la reponse HTTP, sans attente ni retry.
    await asTenant(
      { organizationId: parsed.id, userId: session.userId },
      async (client) => {
        const member = await client.query(
          "SELECT role FROM member WHERE organization_id = $1 AND user_id = $2",
          [parsed.id, session.userId],
        );
        expect(member.rows).toEqual([{ role: "owner" }]);

        const usage = await client.query(
          "SELECT link_count, link_quota FROM organization_link_usage WHERE organization_id = $1",
          [parsed.id],
        );
        expect(usage.rows).toEqual([{ link_count: 0, link_quota: 50 }]);

        const subscription = await client.query(
          "SELECT tier, status FROM subscription WHERE organization_id = $1",
          [parsed.id],
        );
        expect(subscription.rows).toEqual([{ tier: "free", status: "active" }]);
      },
    );
  });

  it("AC3a : deux organisations distinctes peuvent porter le meme name, sans jamais lever une 500", async () => {
    const sessionOne = await signUp();
    const sessionTwo = await signUp();

    const first = await createOrganization(sessionOne, { name: "Studio Duplique" });
    const second = await createOrganization(sessionTwo, { name: "Studio Duplique" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.status).not.toBe(500);

    const firstBody = createOrganizationOutput.output.parse(first.body);
    const secondBody = createOrganizationOutput.output.parse(second.body);

    expect(firstBody.name).toBe(secondBody.name);
    expect(firstBody.id).not.toBe(secondBody.id);
    // Collision de slug resolue par un suffixe numerique deterministe.
    expect(firstBody.slug).not.toBe(secondBody.slug);
    expect(secondBody.slug.startsWith(firstBody.slug)).toBe(true);
  });

  it("AC3b : deux creations concurrentes du meme utilisateur avec le meme name produisent deux organisations distinctes", async () => {
    const session = await signUp();

    const [first, second] = await Promise.all([
      createOrganization(session, { name: "Concurrence SAS" }),
      createOrganization(session, { name: "Concurrence SAS" }),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const firstBody = createOrganizationOutput.output.parse(first.body);
    const secondBody = createOrganizationOutput.output.parse(second.body);

    expect(firstBody.id).not.toBe(secondBody.id);
    expect(firstBody.slug).not.toBe(secondBody.slug);

    // Le retry applicatif sur violation d'unicite ne doit jamais degenerer en 500.
    expect(first.status).not.toBe(500);
    expect(second.status).not.toBe(500);
  });

  describe("AC3c : valeurs absentes ou invalides — 422 sans creation", () => {
    it.each([
      ["name vide", ""],
      ["name uniquement des espaces", "   "],
      ["name > 120 caracteres", "a".repeat(121)],
    ])("%s -> 422 VALIDATION_FAILED, aucune organisation creee", async (_label, name) => {
      const session = await signUp();
      const before = await countOrganizationsDirect();

      const { status, body } = await createOrganization(session, { name });

      expect(status).toBe(422);
      expect((body as { code?: string }).code).toBe("VALIDATION_FAILED");
      expect(await countOrganizationsDirect()).toBe(before);
    });

    it("AC3c : name absent du corps -> 422 VALIDATION_FAILED", async () => {
      const session = await signUp();
      const before = await countOrganizationsDirect();

      const { status, body } = await createOrganization(session, {});

      expect(status).toBe(422);
      expect((body as { code?: string }).code).toBe("VALIDATION_FAILED");
      expect(await countOrganizationsDirect()).toBe(before);
    });
  });

  it("AC4 : aucune session valide -> 401 UNAUTHENTICATED, aucune organisation creee", async () => {
    const before = await countOrganizationsDirect();

    const { status, body } = await createOrganization(null, { name: "Sans Session" });

    expect(status).toBe(401);
    expect((body as { code?: string }).code).toBe("UNAUTHENTICATED");
    expect(await countOrganizationsDirect()).toBe(before);
  });

  it("AC4 : immediatement apres inscription et creation, organizations_for_user retourne l'organisation", async () => {
    const session = await signUp({ email: uniqueEmail("ac4") });
    const { body } = await createOrganization(session, { name: "Appartenance Immediate" });
    const organizationId = (body as { id: string }).id;

    const rows = await asTenant({ userId: session.userId }, async (client) => {
      const result = await client.query(
        "SELECT id FROM signet.organizations_for_user($1::uuid)",
        [session.userId],
      );
      return result.rows;
    });

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.map((r: { id: string }) => r.id)).toContain(organizationId);
  });
});
