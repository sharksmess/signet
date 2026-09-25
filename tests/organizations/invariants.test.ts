/**
 * Invariants de schema portes par la tranche 001, listes explicitement en
 * "Anti-regression" et dans le "Contrat de donnees" de
 * docs/03-slices/001-creation-organisation.md. Ce ne sont pas des criteres
 * d'acceptation numerotes (AC1-AC5), mais des garanties que la tranche
 * s'engage a maintenir pour toutes les tranches futures — elles doivent
 * casser bruyamment si une migration future les affaiblit par accident.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { asTenant, asBypassRls, asTableOwner, resetDatabase, closeAllPools } from "../helpers/db";
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

  /**
   * Anti-regression audit-001 (MAJEUR-2, migration 0005), corrigee suite au
   * re-audit (MAJEUR-3) : la version precedente de ce test attendait
   * l'INVERSE de ce que le correctif produit. Le correctif ne rend pas la
   * fonction dependante d'un contexte ambiant qui doit exister — il la rend
   * AUTONOME : elle pose son propre contexte (NEW.organization_id, une valeur
   * qu'elle connait toujours, quelle que soit la session appelante) avant
   * d'ecrire. Donc un changement de palier sous BYPASSRLS, sans jamais poser
   * app.organization_id ambiant — exactement l'etat de session d'un futur
   * webhook Stripe, ERD §8.1 — doit desormais REUSSIR, et le quota doit
   * suivre le palier. C'est cette reussite-la qui est la garantie a proteger :
   * avant le correctif, elle echouait silencieusement a mettre a jour le
   * quota (zero ligne affectee, aucune erreur).
   */
  it("propagate_subscription_quota (SECURITY DEFINER) met a jour le quota sans contexte tenant ambiant, car elle pose desormais le sien", async () => {
    const org = await createOrganizationFixture("Contexte Quota Autonome");

    await asBypassRls(async (client) => {
      await client.query(
        "UPDATE subscription SET tier = 'pro', stripe_subscription_id = $2 WHERE organization_id = $1",
        [org.organizationId, `sub_test_upgrade_${org.organizationId}`],
      );
    });

    const afterUpgrade = await asBypassRls(async (client) => {
      const result = await client.query<{ link_quota: number | null }>(
        "SELECT link_quota FROM organization_link_usage WHERE organization_id = $1",
        [org.organizationId],
      );
      return result.rows[0];
    });
    // pro -> illimite (signet.quota_for_tier('pro') = NULL, seul endroit ou
    // cette valeur existe, ERD §8.1).
    expect(afterUpgrade?.link_quota).toBeNull();

    await asBypassRls(async (client) => {
      await client.query("UPDATE subscription SET tier = 'free' WHERE organization_id = $1", [
        org.organizationId,
      ]);
    });

    const afterDowngrade = await asBypassRls(async (client) => {
      const result = await client.query<{ link_quota: number | null }>(
        "SELECT link_quota FROM organization_link_usage WHERE organization_id = $1",
        [org.organizationId],
      );
      return result.rows[0];
    });
    expect(afterDowngrade?.link_quota).toBe(50);
  });

  /**
   * Anti-regression audit-001 (MAJEUR-2, migration 0005) — garde-fou
   * ROW_COUNT proprement dit : la fonction pose toujours son propre contexte
   * (test precedent), donc la seule facon legitime de la faire echouer est
   * qu'il n'existe reellement aucune ligne organization_link_usage a mettre a
   * jour. ERD §7 : « une organisation sans compteur est un bug, pas un cas a
   * absorber silencieusement ».
   *
   * Re-audit (MINEUR-9) : `.rejects.toThrow()` seul accepterait n'importe
   * quelle erreur (par exemple une future revocation du GRANT UPDATE sur
   * organization_link_usage, qui echouerait en 42501 sans que ce test
   * detecte que ce n'est plus le garde-fou ROW_COUNT qui a parle). Le
   * `RAISE EXCEPTION` sans ERRCODE explicite (0005:47) remonte en `P0001`
   * (SQLSTATE par defaut de plpgsql) : c'est ce code precis qu'on verifie.
   */
  it("propagate_subscription_quota (SECURITY DEFINER) echoue bruyamment si le compteur de quota est reellement absent", async () => {
    const org = await createOrganizationFixture("Compteur Quota Absent");

    await asBypassRls(async (client) => {
      await client.query("DELETE FROM organization_link_usage WHERE organization_id = $1", [
        org.organizationId,
      ]);
    });

    await expect(
      asBypassRls(async (client) => {
        await client.query(
          "UPDATE subscription SET tier = 'pro', stripe_subscription_id = $2 WHERE organization_id = $1",
          [org.organizationId, `sub_test_missing_counter_${org.organizationId}`],
        );
      }),
    ).rejects.toMatchObject({ code: "P0001" });
  });

  /**
   * Anti-regression audit-001 (MAJEUR-1, migration 0005) : EXECUTE sur les
   * fonctions SECURITY DEFINER etait implicitement accorde a PUBLIC (defaut
   * Postgres, jamais revoque avant 0005). signet_owner et signet_auth ne
   * doivent jamais pouvoir appeler signet.create_organization() : ni l'un ni
   * l'autre n'a de raison legitime de creer une organisation, et aucun des
   * deux n'a de GRANT EXECUTE explicite dessus (ADR-0007 : signet_owner ne
   * sert jamais aux requetes applicatives, signet_auth est limite aux quatre
   * tables d'authentification).
   */
  // SQLSTATE 42501 (insufficient_privilege), verifiee via `.code` plutot que
  // le texte du message : ce dernier depend de `lc_messages` du serveur et
  // rendrait ce test fragile sur une instance non anglophone.
  it("signet_owner ne peut pas executer signet.create_organization (EXECUTE non accorde a PUBLIC)", async () => {
    await expect(
      asTableOwner(async (client) => {
        await client.query("SELECT signet.create_organization($1, $2)", [
          "00000000-0000-7000-8000-000000000001",
          "Ne Devrait Jamais Exister (owner)",
        ]);
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("signet_auth ne peut pas executer signet.create_organization (EXECUTE non accorde a PUBLIC)", async () => {
    await expect(
      asBypassRls(async (client) => {
        await client.query("SET ROLE signet_auth");
        try {
          await client.query("SELECT signet.create_organization($1, $2)", [
            "00000000-0000-7000-8000-000000000002",
            "Ne Devrait Jamais Exister (auth)",
          ]);
        } finally {
          await client.query("RESET ROLE");
        }
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
