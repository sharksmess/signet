/**
 * Tranche 010 — AC6 : migration 0010 reimpose les attributs des quatre roles
 * `signet_*`, et leve si l'un d'eux est membre d'un role quelconque
 * (ADR-0011 §h). Teste sous la connexion d'administration de la base de test
 * (superutilisateur, seule autorisee a modifier des roles), TOUJOURS dans une
 * transaction annulee : `ALTER ROLE`/`CREATE ROLE` sont transactionnels, mais
 * les roles sont communs a tout le cluster — le `ROLLBACK` est garanti par un
 * `finally`, y compris si une assertion echoue, pour ne jamais laisser le
 * cluster altere par ce test.
 */
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { getBypassRlsPool, asBypassRls, closeAllPools } from "../helpers/db";
import { ROOT } from "../_factory/env";

const MIGRATION_0010_PATH = path.join(ROOT, "packages/db/migrations/0010_reimpose_role_attributes.sql");

/**
 * Lit le fichier de migration 0010 depuis le disque (jamais un texte SQL
 * recopie dans le test : c'est le contenu REEL que `pnpm db:migrate` jouera
 * qui est exerce ici). Une erreur de lecture explicite si le fichier n'existe
 * pas encore (l'implementeur ne l'a pas encore ecrit) plutot qu'un message
 * Node generique sur `readFileSync`.
 */
function readMigration0010(): string {
  try {
    return readFileSync(MIGRATION_0010_PATH, "utf8");
  } catch (err) {
    throw new Error(
      `[AC6] packages/db/migrations/0010_reimpose_role_attributes.sql est introuvable ` +
        `(${(err as Error).message}). C'est la migration que ce test exerce.`,
    );
  }
}

const ROLE_NAMES = ["signet_owner", "signet_app", "signet_auth", "signet_definer"] as const;

interface RoleRow {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  rolcanlogin: boolean;
}

async function readRoles(client: PoolClient): Promise<RoleRow[]> {
  const { rows } = await client.query<RoleRow>(
    `SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication, rolcanlogin
       FROM pg_roles WHERE rolname = ANY($1::text[])`,
    [ROLE_NAMES],
  );
  return rows;
}

afterAll(async () => {
  await closeAllPools();
});

describe("AC6 — migration 0010 : attributs des roles signet_*", () => {
  it("AC6 (i) : un role altere (signet_app BYPASSRLS, signet_definer LOGIN) est corrige par 0010, dans une transaction toujours annulee", async () => {
    const pool = getBypassRlsPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      try {
        await client.query("ALTER ROLE signet_app BYPASSRLS");
        await client.query("ALTER ROLE signet_definer LOGIN");

        await client.query(readMigration0010());

        const roles = await readRoles(client);
        const app = roles.find((r) => r.rolname === "signet_app");
        const definer = roles.find((r) => r.rolname === "signet_definer");
        expect(app?.rolbypassrls, "signet_app doit redevenir NOBYPASSRLS apres 0010").toBe(false);
        expect(definer?.rolcanlogin, "signet_definer doit redevenir NOLOGIN apres 0010").toBe(false);
      } finally {
        await client.query("ROLLBACK");
      }
    } finally {
      client.release();
    }
  });

  it("AC6 (ii) : un role privilegie accorde a signet_app fait lever 0010 (P0001, citant signet_app)", async () => {
    const pool = getBypassRlsPool();
    const client = await pool.connect();
    const tempRoleName = `signet_test_privileged_${Date.now()}`;
    try {
      await client.query("BEGIN");
      try {
        // Role temporaire, cree DANS la transaction : jamais visible hors
        // d'elle puisqu'elle est toujours annulee.
        await client.query(`CREATE ROLE "${tempRoleName}" NOLOGIN SUPERUSER`);
        await client.query(`GRANT "${tempRoleName}" TO signet_app`);

        let rejected: { code?: string; message?: string } | undefined;
        try {
          await client.query(readMigration0010());
        } catch (err) {
          rejected = err as { code?: string; message?: string };
        }
        expect(rejected, "0010 doit lever quand signet_app est membre d'un role").toBeDefined();
        expect(rejected?.code).toBe("P0001");
        expect(rejected?.message ?? "").toContain("signet_app");
      } finally {
        await client.query("ROLLBACK");
      }
    } finally {
      client.release();
    }
  });

  it("AC6 (iii) : hors transaction, les quatre roles ont deja les attributs cibles et aucune appartenance a un role", async () => {
    // Non-regression attendue sur un cluster neuf (les attributs sont deja
    // corrects depuis la migration 0001) : ce test peut deja etre vert avant
    // que 0010 existe. Il devient un vrai garde-fou une fois qu'un cluster a
    // accumule une derive (cas (i)/(ii) ci-dessus, dans leur transaction
    // annulee, ne modifient jamais cet etat persistant).
    const roles = await asBypassRls((client) => readRoles(client));

    for (const name of ROLE_NAMES) {
      const role = roles.find((r) => r.rolname === name);
      expect(role, `role ${name} introuvable dans pg_roles`).toBeDefined();
      expect(role?.rolsuper, `${name}.rolsuper`).toBe(false);
      expect(role?.rolbypassrls, `${name}.rolbypassrls`).toBe(false);
      expect(role?.rolcreatedb, `${name}.rolcreatedb`).toBe(false);
      expect(role?.rolcreaterole, `${name}.rolcreaterole`).toBe(false);
      expect(role?.rolreplication, `${name}.rolreplication`).toBe(false);
      expect(role?.rolcanlogin, `${name}.rolcanlogin`).toBe(name !== "signet_definer");
    }

    const memberships = await asBypassRls((client) =>
      client.query(
        `SELECT m.rolname AS member_role, r.rolname AS parent_role
           FROM pg_auth_members am
           JOIN pg_roles m ON m.oid = am.member
           JOIN pg_roles r ON r.oid = am.roleid
          WHERE m.rolname = ANY($1::text[])`,
        [ROLE_NAMES],
      ),
    );
    expect(memberships.rows, "aucun des quatre roles ne doit etre membre d'un autre role").toEqual([]);
  });
});
