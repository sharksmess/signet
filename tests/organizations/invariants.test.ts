/**
 * Invariants de schema portes par la tranche 001, listes explicitement en
 * "Anti-regression" et dans le "Contrat de donnees" de
 * docs/03-slices/001-creation-organisation.md. Ce ne sont pas des criteres
 * d'acceptation numerotes (AC1-AC5), mais des garanties que la tranche
 * s'engage a maintenir pour toutes les tranches futures — elles doivent
 * casser bruyamment si une migration future les affaiblit par accident.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { asTenant, asBypassRls, resetDatabase, closeAllPools } from "../helpers/db";
import { createOrganizationFixture } from "../helpers/fixtures";

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeAllPools();
});

describe("Invariants de schema (anti-regression, tranche 001)", () => {
  it("signet.create_organization() reste l'unique chemin de creation : un INSERT direct sans contexte tenant est refuse", async () => {
    await expect(
      asTenant({}, async (client) => {
        await client.query(
          "INSERT INTO organization (name, slug) VALUES ('Contournement', 'contournement')",
        );
      }),
    ).rejects.toThrow();
  });

  it("member_single_owner_idx : une organisation ne peut jamais avoir une deuxieme ligne member(role='owner')", async () => {
    const org = await createOrganizationFixture("Owner Unique");

    await expect(
      asBypassRls(async (client) => {
        await client.query(
          "INSERT INTO member (organization_id, user_id, role) " +
            "VALUES ($1, (SELECT id FROM app_user WHERE id <> $2 LIMIT 1), 'owner')",
          [org.organizationId, org.owner.userId],
        );
      }),
    ).rejects.toThrow();
  });

  it("member_keep_last_owner : supprimer le dernier owner d'une organisation encore existante est refuse", async () => {
    const org = await createOrganizationFixture("Dernier Owner Protege");

    await expect(
      asBypassRls(async (client) => {
        await client.query(
          "DELETE FROM member WHERE organization_id = $1 AND role = 'owner'",
          [org.organizationId],
        );
      }),
    ).rejects.toThrow();
  });
});
