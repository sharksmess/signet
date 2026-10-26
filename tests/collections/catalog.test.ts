/**
 * Tranche 004 — AC8 : catalogue Postgres de la table `collection` (ADR-0001,
 * ADR-0011, ERD §6.1). Lectures du catalogue sous la connexion d'administration
 * (le catalogue n'est pas soumis a la RLS) ; les refus des CHECK et de l'index
 * unique sont observes par des insertions sous cette meme connexion, sur des
 * organisations creees par le test.
 *
 * Requetes de catalogue : les `name[]` sont castes en `text` (FRICTION
 * 2026-10-20, le pilote `pg` ne decode pas `name[]`).
 */
import { describe, it, expect, afterAll } from "vitest";
import { asBypassRls, closeAllPools } from "../helpers/db";
import { createOrganizationFixture } from "../helpers/fixtures";
import { insertCollectionDirect, nameOfLength, uniqueCollectionName } from "../helpers/collections";

afterAll(async () => {
  await closeAllPools();
});

const squash = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();
/** Forme sans parentheses ni prefixe de schema, pour comparer des expressions de politique. */
const normalized = (text: string | null | undefined): string => squash(text).replace(/[()]/g, "").replace(/signet\./g, "");

interface PgFailure {
  code?: string;
  constraint?: string;
  message?: string;
}

async function failureOf(operation: () => Promise<unknown>): Promise<PgFailure | undefined> {
  try {
    await operation();
    return undefined;
  } catch (error) {
    return error as PgFailure;
  }
}

describe("AC8 — RLS et politique", () => {
  it("AC8 : la table collection existe, avec la RLS activee ET forcee", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = to_regclass('public.collection')",
      ),
    );

    expect(rows, "public.collection n'existe pas (migration 0016 attendue)").toHaveLength(1);
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("AC8 : exactement une politique, TO signet_app seulement, USING et WITH CHECK portent organization_id = current_org(), aucun context_org(, aucune TO PUBLIC ni signet_definer", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ polname: string; roles: string[]; qual: string | null; withcheck: string | null }>(
        `SELECT pol.polname::text AS polname,
                ARRAY(SELECT CASE WHEN o = 0 THEN 'public' ELSE (SELECT rolname::text FROM pg_roles WHERE oid = o) END
                        FROM unnest(pol.polroles) AS o)::text[] AS roles,
                pg_get_expr(pol.polqual, pol.polrelid) AS qual,
                pg_get_expr(pol.polwithcheck, pol.polrelid) AS withcheck
           FROM pg_policy pol
          WHERE pol.polrelid = to_regclass('public.collection')`,
      ),
    );

    expect(rows, "exactement une politique sur collection").toHaveLength(1);
    const [policy] = rows;
    expect(policy?.roles, "TO signet_app seulement").toEqual(["signet_app"]);
    expect(normalized(policy?.qual), "USING").toContain("organization_id = current_org");
    expect(normalized(policy?.withcheck), "WITH CHECK").toContain("organization_id = current_org");
    expect(`${policy?.qual ?? ""} ${policy?.withcheck ?? ""}`, "aucun appel a context_org(").not.toContain("context_org(");
  });
});

describe("AC8 — privileges de signet_app", () => {
  it("AC8 : signet_app a SELECT et INSERT sur collection, rien d'autre (ni UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER)", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ privilege: string; allowed: boolean }>(
        `SELECT p.privilege, has_table_privilege('signet_app', to_regclass('public.collection'), p.privilege) AS allowed
           FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilege)`,
      ),
    );

    expect(rows.filter((r) => r.allowed).map((r) => r.privilege).sort()).toEqual(["INSERT", "SELECT"]);
  });

  it("AC8 : aucun privilege de colonne UPDATE pour signet_app, aucun privilege pour PUBLIC", async () => {
    const columns = await asBypassRls((client) =>
      client.query<{ attname: string; can_update: boolean }>(
        `SELECT a.attname::text AS attname, has_column_privilege('signet_app', c.oid, a.attnum, 'UPDATE') AS can_update
           FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
          WHERE a.attrelid = to_regclass('public.collection') AND a.attnum > 0 AND NOT a.attisdropped`,
      ),
    );
    expect(columns.rows.length, "colonnes lues").toBeGreaterThan(0);
    expect(columns.rows.filter((c) => c.can_update).map((c) => c.attname), "aucune colonne modifiable").toEqual([]);

    const pub = await asBypassRls((client) =>
      client.query<{ privilege: string; allowed: boolean }>(
        `SELECT p.privilege, has_table_privilege('public', to_regclass('public.collection'), p.privilege) AS allowed
           FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p(privilege)`,
      ),
    );
    expect(pub.rows.filter((r) => r.allowed).map((r) => r.privilege), "PUBLIC n'a aucun privilege").toEqual([]);
  });
});

describe("AC8 — colonnes, contraintes et index (ERD §6.1)", () => {
  it("AC8 : exactement les cinq colonnes de l'ERD, avec types, NOT NULL et valeurs par defaut", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ attname: string; type: string; notnull: boolean; dflt: string | null }>(
        `SELECT a.attname::text AS attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS notnull,
                pg_get_expr(d.adbin, d.adrelid) AS dflt
           FROM pg_attribute a
           LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = to_regclass('public.collection') AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY a.attname`,
      ),
    );

    expect(rows.map((r) => `${r.attname}:${r.type}:${r.notnull}`)).toEqual([
      "created_at:timestamp with time zone:true",
      "created_by_user_id:uuid:true",
      "id:uuid:true",
      "name:text:true",
      "organization_id:uuid:true",
    ]);
    const byName = new Map(rows.map((r) => [r.attname, r.dflt]));
    expect(byName.get("id"), "id DEFAULT uuidv7()").toContain("uuidv7()");
    expect(byName.get("created_at"), "created_at DEFAULT now()").toContain("now()");
    expect(byName.get("name")).toBeNull();
    expect(byName.get("organization_id")).toBeNull();
    expect(byName.get("created_by_user_id")).toBeNull();
  });

  it("AC8 : PRIMARY KEY (id), UNIQUE (id, organization_id), deux FK (CASCADE vers organization, RESTRICT vers app_user), deux CHECK sur name", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ contype: string; def: string }>(
        `SELECT contype::text AS contype, pg_get_constraintdef(oid) AS def
           FROM pg_constraint WHERE conrelid = to_regclass('public.collection') ORDER BY contype, def`,
      ),
    );
    const defs = (type: string): string[] => rows.filter((r) => r.contype === type).map((r) => squash(r.def).replace(/public\./g, ""));

    expect(defs("p")).toEqual(["PRIMARY KEY (id)"]);
    expect(defs("u")).toEqual(["UNIQUE (id, organization_id)"]);
    const foreignKeys = defs("f");
    expect(foreignKeys).toHaveLength(2);
    expect(foreignKeys).toContain("FOREIGN KEY (organization_id) REFERENCES organization(id) ON DELETE CASCADE");
    expect(foreignKeys).toContain("FOREIGN KEY (created_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT");

    const checks = defs("c");
    expect(checks, "exactement deux CHECK").toHaveLength(2);
    const lengthCheck = checks.find((c) => c.includes("char_length"));
    expect(lengthCheck, "CHECK sur la longueur").toBeDefined();
    expect(lengthCheck).toContain("char_length(btrim(name))");
    expect(lengthCheck).toMatch(/>= 1\b/);
    expect(lengthCheck).toMatch(/<= 100\b/);
    const trimCheck = checks.find((c) => !c.includes("char_length"));
    expect(normalized(trimCheck)).toContain("name = btrim name");
  });

  it("AC8 : l'index collection_org_name_ci_idx est unique, sur (organization_id, lower(btrim(name))) ; aucun autre index que la cle primaire et UNIQUE (id, organization_id)", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ indexname: string; indexdef: string }>(
        "SELECT indexname::text AS indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'collection' ORDER BY indexname",
      ),
    );

    const ci = rows.find((r) => r.indexname === "collection_org_name_ci_idx");
    expect(ci, "index collection_org_name_ci_idx").toBeDefined();
    expect(squash(ci?.indexdef)).toContain("CREATE UNIQUE INDEX collection_org_name_ci_idx");
    expect(squash(ci?.indexdef)).toContain("(organization_id, lower(btrim(name)))");
    expect(rows.map((r) => r.indexname), "cle primaire, UNIQUE (id, organization_id) et l'index d'unicite du nom, rien de plus").toHaveLength(3);
  });
});

describe("AC8 — fonctions SECURITY DEFINER inchangees", () => {
  it("AC8 : l'ensemble des fonctions SECURITY DEFINER du schema signet est la liste de la tranche 006, aucune nouvelle", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ proname: string }>(
        `SELECT DISTINCT p.proname::text AS proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.prosecdef AND n.nspname = 'signet' ORDER BY 1`,
      ),
    );

    expect(rows.map((r) => r.proname)).toEqual(
      [
        "accept_invitation",
        "apply_stripe_subscription",
        "assert_owner_remains",
        "create_organization",
        "create_organization_counters",
        "current_org",
        "lookup_invitation",
        "organizations_for_user",
        "propagate_subscription_quota",
      ].sort(),
    );
  });

  it("AC8 : aucune politique de collection n'est applicable a signet_definer", async () => {
    const exists = await asBypassRls((client) =>
      client.query<{ oid: string | null }>("SELECT to_regclass('public.collection')::text AS oid"),
    );
    expect(exists.rows[0]?.oid, "precondition : public.collection existe (migration 0016 attendue)").not.toBeNull();
    const { rows } = await asBypassRls((client) =>
      client.query<{ polname: string }>(
        `SELECT pol.polname::text AS polname FROM pg_policy pol
          WHERE pol.polrelid = to_regclass('public.collection')
            AND (pol.polroles @> ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'signet_definer')]::oid[] OR 0::oid = ANY(pol.polroles))`,
      ),
    );
    expect(rows).toEqual([]);
  });
});

describe("AC8 — les contraintes refusent en base (connexion d'administration)", () => {
  it("AC8 : un nom avec espace de bord est refuse par un CHECK (23514)", async () => {
    const org = await createOrganizationFixture("AC8 check bord");

    for (const name of [` ${uniqueCollectionName()}`, `${uniqueCollectionName()} `]) {
      const failure = await failureOf(() => insertCollectionDirect({ organizationId: org.organizationId, name, createdByUserId: org.owner.userId }));
      expect(failure?.code, `nom ${JSON.stringify(name)} : ${failure?.message}`).toBe("23514");
    }
  });

  it("AC8 : un nom vide, fait d'espaces, ou de plus de 100 caracteres est refuse par un CHECK (23514) ; 100 caracteres sont acceptes", async () => {
    const org = await createOrganizationFixture("AC8 check longueur");

    for (const name of ["", "   ", nameOfLength(101)]) {
      const failure = await failureOf(() => insertCollectionDirect({ organizationId: org.organizationId, name, createdByUserId: org.owner.userId }));
      expect(failure?.code, `nom de ${name.length} caracteres : ${failure?.message}`).toBe("23514");
    }
    const accepted = await insertCollectionDirect({ organizationId: org.organizationId, name: nameOfLength(100), createdByUserId: org.owner.userId });
    expect(accepted.name).toHaveLength(100);
  });

  it("AC8 : l'index refuse un doublon de casse dans la meme organisation (23505 sur collection_org_name_ci_idx) mais accepte le meme nom dans une autre", async () => {
    const orgA = await createOrganizationFixture("AC8 unique A");
    const orgB = await createOrganizationFixture("AC8 unique B");
    const name = uniqueCollectionName();
    await insertCollectionDirect({ organizationId: orgA.organizationId, name, createdByUserId: orgA.owner.userId });

    const duplicate = await failureOf(() =>
      insertCollectionDirect({ organizationId: orgA.organizationId, name: name.toUpperCase(), createdByUserId: orgA.owner.userId }),
    );
    expect(duplicate?.code, duplicate?.message).toBe("23505");
    expect(duplicate?.constraint).toBe("collection_org_name_ci_idx");

    const other = await insertCollectionDirect({ organizationId: orgB.organizationId, name, createdByUserId: orgB.owner.userId });
    expect(other.organization_id).toBe(orgB.organizationId);
  });

  it("AC8 : id est un UUID v7 par defaut, created_at est renseigne par la base", async () => {
    const org = await createOrganizationFixture("AC8 defauts");

    const row = await insertCollectionDirect({ organizationId: org.organizationId, name: uniqueCollectionName(), createdByUserId: org.owner.userId });

    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(row.created_at).toBeInstanceOf(Date);
  });

  it("AC8 : la suppression de l'organisation efface ses collections (ON DELETE CASCADE)", async () => {
    const org = await createOrganizationFixture("AC8 cascade");
    const row = await insertCollectionDirect({ organizationId: org.organizationId, name: uniqueCollectionName(), createdByUserId: org.owner.userId });

    const remaining = await asBypassRls(async (client) => {
      await client.query("BEGIN");
      try {
        // Transaction toujours annulee : le garde-fou differe du dernier owner ne s'execute jamais.
        await client.query("DELETE FROM organization WHERE id = $1", [org.organizationId]);
        return (await client.query("SELECT id FROM collection WHERE id = $1", [row.id])).rows;
      } finally {
        await client.query("ROLLBACK");
      }
    });

    expect(remaining, "la cascade referentielle supprime la collection").toEqual([]);
  });
});
