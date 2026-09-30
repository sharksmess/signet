/**
 * Tranche 010 — AC5 : isolation tenant par l'API. `PATCH /api/organizations/:idB`
 * par un membre de A seulement (owner de A) doit rendre EXACTEMENT la meme
 * reponse (statut ET corps) qu'un `organizationId` inexistant — jamais un
 * signal qui laisserait deviner l'existence de B (US-09.2, nextjs.md).
 *
 * Attendu deja vert aujourd'hui (note de l'orchestrateur, a confirmer) :
 * le controle applicatif de `renameOrganization` (`SELECT ... FROM member
 * WHERE user_id = $2`, ADR-0011 §Contexte) protege deja cette route
 * independamment du durcissement RLS de cette tranche. Si ce test echoue,
 * c'est un signal sur le controle applicatif existant, pas sur la migration
 * 0009/0010.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { closeAllPools, resetDatabase } from "../helpers/db";
import { createTwoOrganizationsFixture, readOrganizationNameDirect } from "../helpers/fixtures";
import { renameOrganization } from "../helpers/organizationsApi";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeAllPools();
});

describe("AC5 — isolation tenant par l'API : PATCH /api/organizations/:organizationId", () => {
  it("AC5 : l'owner de A recoit la meme reponse (404 ORGANIZATION_NOT_FOUND) pour B que pour un id inexistant, et B n'est pas modifiee", async () => {
    const { orgA, orgB } = await createTwoOrganizationsFixture();
    // UUID syntaxiquement valide (passe la validation Zod du contrat) mais
    // garanti sans ligne organization correspondante.
    const nonExistentOrganizationId = "00000000-0000-7000-8000-000000000123";

    const responseForB = await renameOrganization(orgA.owner, orgB.organizationId, { name: "Piratee (AC5)" });
    const responseForNonExistent = await renameOrganization(orgA.owner, nonExistentOrganizationId, {
      name: "Piratee (AC5)",
    });

    expect(responseForB.status, `corps recu : ${JSON.stringify(responseForB.body)}`).toBe(404);
    expect(responseForB.body).toMatchObject({ code: "ORGANIZATION_NOT_FOUND" });

    expect(responseForB.status).toBe(responseForNonExistent.status);
    expect(responseForB.body).toEqual(responseForNonExistent.body);

    const nameAfter = await readOrganizationNameDirect(orgB.organizationId);
    expect(nameAfter).toBe(orgB.name);
  });
});
