/**
 * Tests de renommage d'organisation — `PATCH /api/organizations/:organizationId`.
 * Source : docs/03-slices/001-creation-organisation.md (AC2, AC3, AC4, AC5)
 *          docs/02-architecture/api-contracts/organizations.ts (contrat, lecture seule)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { renameOrganization as renameOrganizationContract } from "../../docs/02-architecture/api-contracts/organizations";
import { renameOrganization } from "../helpers/organizationsApi";
import { signUp } from "../helpers/auth";
import { resetDatabase, closeAllPools } from "../helpers/db";
import {
  createOrganizationFixture,
  createTwoOrganizationsFixture,
  addMemberDirect,
  readOrganizationNameDirect,
} from "../helpers/fixtures";

beforeAll(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeAllPools();
});

describe("PATCH /api/organizations/:organizationId", () => {
  it("AC2 : un member (non-owner) tente le renommage -> 403 INSUFFICIENT_ROLE, nom inchange", async () => {
    const org = await createOrganizationFixture("Nom Original");
    const memberSession = await signUp();
    await addMemberDirect({
      organizationId: org.organizationId,
      userId: memberSession.userId,
      role: "member",
    });

    const { status, body } = await renameOrganization(memberSession, org.organizationId, {
      organizationId: org.organizationId,
      name: "Nom Impose Par Un Membre",
    });

    expect(status).toBe(403);
    expect((body as { code?: string }).code).toBe("INSUFFICIENT_ROLE");
    expect(await readOrganizationNameDirect(org.organizationId)).toBe("Nom Original");
  });

  it("AC2 : l'owner peut renommer son organisation", async () => {
    const org = await createOrganizationFixture("Nom Avant");

    const { status, body } = await renameOrganization(org.owner, org.organizationId, {
      organizationId: org.organizationId,
      name: "Nom Apres",
    });

    expect(status).toBe(200);
    const parsed = renameOrganizationContract.output.parse(body);
    expect(parsed.name).toBe("Nom Apres");
    expect(await readOrganizationNameDirect(org.organizationId)).toBe("Nom Apres");
  });

  describe("AC3c : valeurs absentes ou invalides sur le renommage", () => {
    it.each([
      ["name vide", ""],
      ["name uniquement des espaces", "   "],
      ["name > 120 caracteres", "a".repeat(121)],
    ])("%s -> 422 VALIDATION_FAILED, nom inchange", async (_label, name) => {
      const org = await createOrganizationFixture("Nom Stable");

      const { status, body } = await renameOrganization(org.owner, org.organizationId, {
        organizationId: org.organizationId,
        name,
      });

      expect(status).toBe(422);
      expect((body as { code?: string }).code).toBe("VALIDATION_FAILED");
      expect(await readOrganizationNameDirect(org.organizationId)).toBe("Nom Stable");
    });

    it("organizationId non-UUID -> 422 VALIDATION_FAILED", async () => {
      const org = await createOrganizationFixture("Nom Avec Id Invalide");

      const { status, body } = await renameOrganization(org.owner, "pas-un-uuid", {
        organizationId: "pas-un-uuid",
        name: "Peu Importe",
      });

      expect(status).toBe(422);
      expect((body as { code?: string }).code).toBe("VALIDATION_FAILED");
      expect(await readOrganizationNameDirect(org.organizationId)).toBe("Nom Avec Id Invalide");
    });
  });

  it("AC4 : aucune session valide -> 401 UNAUTHENTICATED, nom inchange", async () => {
    const org = await createOrganizationFixture("Nom Protege");

    const { status, body } = await renameOrganization(null, org.organizationId, {
      organizationId: org.organizationId,
      name: "Renomme Sans Session",
    });

    expect(status).toBe(401);
    expect((body as { code?: string }).code).toBe("UNAUTHENTICATED");
    expect(await readOrganizationNameDirect(org.organizationId)).toBe("Nom Protege");
  });

  it("AC5 (isolation tenant, obligatoire) : l'owner de A renomme B -> 404 ORGANIZATION_NOT_FOUND, jamais 403", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();

    const { status, body } = await renameOrganization(orgA.owner, orgB.organizationId, {
      organizationId: orgB.organizationId,
      name: "Vole Par A",
    });

    expect(status).toBe(404);
    expect((body as { code?: string }).code).toBe("ORGANIZATION_NOT_FOUND");
    expect(status).not.toBe(403); // US-09.2 : ne jamais reveler l'existence de la ressource d'autrui.
    expect(await readOrganizationNameDirect(orgB.organizationId)).toBe(orgB.name);
  });

  it("AC5 (isolation tenant, obligatoire) : un id d'organisation totalement inexistant -> 404 ORGANIZATION_NOT_FOUND", async () => {
    const org = await createOrganizationFixture("Existe Bel Et Bien");
    const nonExistentId = "00000000-0000-7000-8000-000000000000";

    const { status, body } = await renameOrganization(org.owner, nonExistentId, {
      organizationId: nonExistentId,
      name: "Peu Importe",
    });

    expect(status).toBe(404);
    expect((body as { code?: string }).code).toBe("ORGANIZATION_NOT_FOUND");
  });
});
