/**
 * Tranche 005 — AC12 : catalogue Postgres de la table `link` et du trigger de
 * quota (ADR-0001, ADR-0002, ADR-0011, ERD §6.2 et §7). Lectures du catalogue
 * sous la connexion d'administration (le catalogue n'est pas soumis a la RLS) ;
 * les refus des CHECK sont observes par des insertions sous cette meme
 * connexion, sur des organisations creees par le test.
 *
 * L'ensemble exact des fonctions SECURITY DEFINER de `signet` est fige par les
 * deux tests de catalogue de 004 et 006 (D-121) : ce fichier ne duplique pas
 * cette liste, il verifie que `link_usage_on_insert` en fait partie et
 * respecte les regles d'ADR-0011.
 *
 * Requetes de catalogue : les `name[]` sont castes en `text` (FRICTION
 * 2026-10-20, le pilote `pg` ne decode pas `name[]`).
 */
import { describe, it, expect, afterAll } from "vitest";
import { asBypassRls, closeAllPools } from "../helpers/db";
import { createOrganizationFixture } from "../helpers/fixtures";
import { closeLinkPools, createCollectionViaApi, failureOf, INSERT_LINK_SQL, uniqueUrl, urlOfLength } from "../helpers/links";

afterAll(async () => {
  await closeLinkPools();
  await closeAllPools();
});

const squash = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();
/** Forme sans parentheses ni prefixe de schema, pour comparer des expressions de politique. */
const normalized = (text: string | null | undefined): string => squash(text).replace(/[()]/g, "").replace(/signet\./g, "");

const TRIGGER_FUNCTION = "signet.link_usage_on_insert()";

describe("AC12 — RLS et politique de link", () => {
  it("AC12 : la table link existe, avec la RLS activee ET forcee, proprietaire signet_owner", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean; owner: string }>(
        `SELECT c.relrowsecurity, c.relforcerowsecurity, r.rolname::text AS owner
           FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
          WHERE c.oid = to_regclass('public.link')`,
      ),
    );

    expect(rows, "public.link n'existe pas (migration 0017 attendue)").toHaveLength(1);
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true, owner: "signet_owner" });
  });

  it("AC12 : exactement une politique link_isolation, TO signet_app seulement, USING et WITH CHECK egaux a organization_id = current_org(), aucun context_org(, aucune TO PUBLIC ni signet_definer", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ polname: string; roles: string[]; qual: string | null; withcheck: string | null }>(
        `SELECT pol.polname::text AS polname,
                ARRAY(SELECT CASE WHEN o = 0 THEN 'public' ELSE (SELECT rolname::text FROM pg_roles WHERE oid = o) END
                        FROM unnest(pol.polroles) AS o)::text[] AS roles,
                pg_get_expr(pol.polqual, pol.polrelid) AS qual,
                pg_get_expr(pol.polwithcheck, pol.polrelid) AS withcheck
           FROM pg_policy pol
          WHERE pol.polrelid = to_regclass('public.link')`,
      ),
    );

    expect(rows, "exactement une politique sur link").toHaveLength(1);
    const [policy] = rows;
    expect(policy?.polname).toBe("link_isolation");
    expect(policy?.roles, "TO signet_app seulement (ni PUBLIC, ni signet_definer)").toEqual(["signet_app"]);
    // Egalite stricte : `... OR true` ou une conjonction quelconque echoue.
    expect(normalized(policy?.qual), "USING").toBe("organization_id = current_org");
    expect(normalized(policy?.withcheck), "WITH CHECK").toBe("organization_id = current_org");
    expect(`${policy?.qual ?? ""} ${policy?.withcheck ?? ""}`, "aucun appel a context_org(").not.toContain("context_org(");
  });
});

describe("AC12 — privileges de link", () => {
  it("AC12 : signet_app a SELECT et INSERT sur link, rien d'autre (ni UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER)", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ privilege: string; allowed: boolean }>(
        `SELECT p.privilege, has_table_privilege('signet_app', to_regclass('public.link'), p.privilege) AS allowed
           FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilege)`,
      ),
    );

    expect(rows.filter((r) => r.allowed).map((r) => r.privilege).sort()).toEqual(["INSERT", "SELECT"]);
  });

  it("AC12 : aucun privilege de colonne UPDATE pour signet_app, aucun privilege pour PUBLIC", async () => {
    const columns = await asBypassRls((client) =>
      client.query<{ attname: string; can_update: boolean }>(
        `SELECT a.attname::text AS attname, has_column_privilege('signet_app', c.oid, a.attnum, 'UPDATE') AS can_update
           FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
          WHERE a.attrelid = to_regclass('public.link') AND a.attnum > 0 AND NOT a.attisdropped`,
      ),
    );
    expect(columns.rows.length, "colonnes lues").toBeGreaterThan(0);
    expect(columns.rows.filter((c) => c.can_update).map((c) => c.attname), "aucune colonne modifiable").toEqual([]);

    const pub = await asBypassRls((client) =>
      client.query<{ privilege: string; allowed: boolean }>(
        `SELECT p.privilege, has_table_privilege('public', to_regclass('public.link'), p.privilege) AS allowed
           FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p(privilege)`,
      ),
    );
    expect(pub.rows.filter((r) => r.allowed).map((r) => r.privilege), "PUBLIC n'a aucun privilege").toEqual([]);
  });

  it("AC12 : les privileges de organization_link_usage sont inchanges (signet_app : SELECT seulement, politiques de 0003/0009 seules)", async () => {
    const privileges = await asBypassRls((client) =>
      client.query<{ privilege: string; allowed: boolean }>(
        `SELECT p.privilege, has_table_privilege('signet_app', to_regclass('public.organization_link_usage'), p.privilege) AS allowed
           FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilege)`,
      ),
    );
    expect(privileges.rows.filter((r) => r.allowed).map((r) => r.privilege)).toEqual(["SELECT"]);

    const policies = await asBypassRls((client) =>
      client.query<{ polname: string }>(
        "SELECT polname::text AS polname FROM pg_policy WHERE polrelid = to_regclass('public.organization_link_usage') ORDER BY polname",
      ),
    );
    expect(policies.rows.map((p) => p.polname)).toEqual(["organization_link_usage_definer_write", "organization_link_usage_read_only"]);
  });
});

describe("AC12 — colonnes, contraintes et index de link (ERD §6.2)", () => {
  it("AC12 : exactement les sept colonnes de l'ERD, avec types, NOT NULL et valeurs par defaut", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ attname: string; type: string; notnull: boolean; dflt: string | null }>(
        `SELECT a.attname::text AS attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS notnull,
                pg_get_expr(d.adbin, d.adrelid) AS dflt
           FROM pg_attribute a
           LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = to_regclass('public.link') AND a.attnum > 0 AND NOT a.attisdropped
          ORDER BY a.attname`,
      ),
    );

    expect(rows.map((r) => `${r.attname}:${r.type}:${r.notnull}`)).toEqual([
      "added_by_user_id:uuid:true",
      "collection_id:uuid:true",
      "created_at:timestamp with time zone:true",
      "id:uuid:true",
      "organization_id:uuid:true",
      "title:text:true",
      "url:text:true",
    ]);
    const byName = new Map(rows.map((r) => [r.attname, r.dflt]));
    expect(byName.get("id"), "id DEFAULT uuidv7()").toContain("uuidv7()");
    expect(byName.get("created_at"), "created_at DEFAULT now()").toContain("now()");
    for (const column of ["added_by_user_id", "collection_id", "organization_id", "title", "url"]) {
      expect(byName.get(column), `${column} sans valeur par defaut`).toBeNull();
    }
  });

  it("AC12 : PRIMARY KEY (id), trois cles etrangeres (composite CASCADE vers collection, CASCADE vers organization, RESTRICT vers app_user), trois CHECK", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ contype: string; name: string; def: string }>(
        `SELECT contype::text AS contype, conname::text AS name, pg_get_constraintdef(oid) AS def
           FROM pg_constraint WHERE conrelid = to_regclass('public.link') ORDER BY contype, conname`,
      ),
    );
    const defs = (type: string): string[] => rows.filter((r) => r.contype === type).map((r) => squash(r.def).replace(/public\./g, ""));

    expect(defs("p")).toEqual(["PRIMARY KEY (id)"]);
    expect(defs("u"), "aucune contrainte d'unicite : pas de deduplication d'URL").toEqual([]);

    const foreignKeys = defs("f");
    expect(foreignKeys).toHaveLength(3);
    expect(foreignKeys).toContain("FOREIGN KEY (collection_id, organization_id) REFERENCES collection(id, organization_id) ON DELETE CASCADE");
    expect(foreignKeys).toContain("FOREIGN KEY (organization_id) REFERENCES organization(id) ON DELETE CASCADE");
    expect(foreignKeys).toContain("FOREIGN KEY (added_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT");
    const composite = rows.find((r) => r.contype === "f" && r.def.includes("(collection_id, organization_id)"));
    expect(composite?.name, "nom de la cle composite").toBe("link_collection_fk");

    const checks = new Map(rows.filter((r) => r.contype === "c").map((r) => [r.name, squash(r.def)]));
    expect([...checks.keys()].sort(), "exactement trois CHECK nommes").toEqual(["link_title_length_chk", "link_url_length_chk", "link_url_scheme_chk"]);
    expect(checks.get("link_url_scheme_chk")).toContain("'^https?://[^[:space:]]+$'");
    const urlLength = checks.get("link_url_length_chk") ?? "";
    expect(urlLength).toContain("char_length(url)");
    expect(urlLength).toMatch(/>= 8\b/);
    expect(urlLength).toMatch(/<= 2048\b/);
    const titleLength = checks.get("link_title_length_chk") ?? "";
    expect(titleLength).toContain("char_length(btrim(title))");
    expect(titleLength).toMatch(/>= 1\b/);
    expect(titleLength).toMatch(/<= 200\b/);
  });

  it("AC12 : exactement trois index en plus de la cle primaire, conformes a l'ERD", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ indexname: string; indexdef: string }>(
        "SELECT indexname::text AS indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'link' ORDER BY indexname",
      ),
    );

    expect(rows.map((r) => r.indexname)).toEqual(["link_author_idx", "link_collection_recent_idx", "link_org_idx", "link_pkey"]);
    const def = (name: string): string => squash(rows.find((r) => r.indexname === name)?.indexdef);
    expect(def("link_collection_recent_idx")).toContain("(collection_id, created_at DESC, id DESC)");
    expect(def("link_org_idx")).toContain("(organization_id)");
    expect(def("link_author_idx")).toContain("(added_by_user_id)");
    for (const name of ["link_collection_recent_idx", "link_org_idx", "link_author_idx"]) {
      expect(def(name), `${name} n'est pas unique`).not.toContain("UNIQUE");
    }
  });
});

describe("AC12 — les CHECK refusent en base (connexion d'administration)", () => {
  const rejectedUrls: Array<[string, string]> = [
    ["schema ftp", "ftp://exemple.invalid/x"],
    ["sans schema", "exemple.invalid/x"],
    ["schema en majuscules", "HTTPS://exemple.invalid/"],
    ["espace interne", "https://exemple.invalid/a b"],
    ["tabulation", "https://exemple.invalid/a\tb"],
    ["7 caracteres", "http://"],
    ["2049 caracteres", urlOfLength(2049)],
  ];

  it.each(rejectedUrls)("AC12 : URL %s refusee par un CHECK (23514)", async (label, url) => {
    const org = await createOrganizationFixture("AC12 check url");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");

    const failure = await failureOf(() =>
      asBypassRls((client) => client.query(INSERT_LINK_SQL, [org.organizationId, collectionId, url, "Titre", org.owner.userId])),
    );

    expect(failure?.code, `${label} : ${failure?.message}`).toBe("23514");
  });

  it("AC12 : 8 caracteres (http://x) et 2048 caracteres sont acceptes", async () => {
    const org = await createOrganizationFixture("AC12 check bornes");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");

    for (const url of ["http://x", urlOfLength(2048)]) {
      const row = await asBypassRls((client) => client.query(INSERT_LINK_SQL, [org.organizationId, collectionId, url, "Titre", org.owner.userId]));
      expect(row.rowCount, url.slice(0, 40)).toBe(1);
    }
  });

  const rejectedTitles: Array<[string, string]> = [
    ["vide", ""],
    ["fait d'espaces", "   "],
    ["201 caracteres", "t".repeat(201)],
  ];

  it.each(rejectedTitles)("AC12 : titre %s refuse par un CHECK (23514)", async (label, title) => {
    const org = await createOrganizationFixture("AC12 check titre");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");

    const failure = await failureOf(() =>
      asBypassRls((client) => client.query(INSERT_LINK_SQL, [org.organizationId, collectionId, uniqueUrl(), title, org.owner.userId])),
    );

    expect(failure?.code, `${label} : ${failure?.message}`).toBe("23514");
  });

  it("AC12 : id est un UUID v7 par defaut, created_at est renseigne par la base", async () => {
    const org = await createOrganizationFixture("AC12 defauts");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");

    const { rows } = await asBypassRls((client) =>
      client.query<{ id: string; created_at: Date }>(
        `INSERT INTO link (organization_id, collection_id, url, title, added_by_user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
        [org.organizationId, collectionId, uniqueUrl(), "Defauts", org.owner.userId],
      ),
    );

    expect(rows[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(rows[0]?.created_at).toBeInstanceOf(Date);
  });

  it("AC12 : la suppression de l'organisation efface ses liens (ON DELETE CASCADE)", async () => {
    const org = await createOrganizationFixture("AC12 cascade");
    const collectionId = await createCollectionViaApi(org.owner, org.organizationId, "Veille");
    await asBypassRls((client) => client.query(INSERT_LINK_SQL, [org.organizationId, collectionId, uniqueUrl(), "A supprimer", org.owner.userId]));

    const remaining = await asBypassRls(async (client) => {
      await client.query("BEGIN");
      try {
        // Transaction toujours annulee : le garde-fou differe du dernier owner ne s'execute jamais.
        await client.query("DELETE FROM organization WHERE id = $1", [org.organizationId]);
        return (await client.query<{ id: string }>("SELECT id FROM link WHERE organization_id = $1", [org.organizationId])).rows;
      } finally {
        await client.query("ROLLBACK");
      }
    });

    expect(remaining, "la cascade referentielle supprime les liens de l'organisation").toEqual([]);
  });
});

describe("AC12 — trigger de compteur et fonction definer (ADR-0002, ADR-0011)", () => {
  it("AC12 : un seul trigger utilisateur sur link, AFTER INSERT FOR EACH ROW, aucun trigger DELETE, UPDATE ni TRUNCATE (007)", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ tgname: string; tgtype: number; fn: string; enabled: string }>(
        `SELECT t.tgname::text AS tgname, t.tgtype::int AS tgtype, t.tgfoid::regprocedure::text AS fn, t.tgenabled::text AS enabled
           FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.link') AND NOT t.tgisinternal`,
      ),
    );

    expect(rows, "exactement un trigger utilisateur").toHaveLength(1);
    const [trigger] = rows;
    // tgtype : 1 = ROW, 2 = BEFORE (absent = AFTER), 4 = INSERT, 8 = DELETE, 16 = UPDATE, 32 = TRUNCATE, 64 = INSTEAD OF.
    expect(trigger?.tgtype, "AFTER (bit 2 absent) + ROW (1) + INSERT (4) uniquement").toBe(1 + 4);
    expect(trigger?.fn).toBe(TRIGGER_FUNCTION);
    expect(trigger?.enabled, "trigger actif pour tous les roles").toBe("O");
  });

  it("AC12 : signet.link_usage_on_insert() est SECURITY DEFINER, proprietaire signet_definer, search_path fige avec pg_temp en dernier", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ prosecdef: boolean; owner: string; config: string[] | null; rettype: string }>(
        `SELECT p.prosecdef, r.rolname::text AS owner, p.proconfig AS config, p.prorettype::regtype::text AS rettype
           FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
          WHERE p.oid = to_regprocedure('${TRIGGER_FUNCTION}')`,
      ),
    );

    expect(rows, "signet.link_usage_on_insert() n'existe pas (migration 0017 attendue)").toHaveLength(1);
    const [fn] = rows;
    expect(fn?.prosecdef).toBe(true);
    expect(fn?.owner).toBe("signet_definer");
    expect(fn?.rettype).toBe("trigger");
    const entry = (fn?.config ?? []).find((c) => c.startsWith("search_path="));
    expect(entry, "search_path fige").toBeDefined();
    const parts = (entry ?? "").slice("search_path=".length).split(",").map((s) => s.trim());
    expect(parts[0], "pg_catalog en premier").toBe("pg_catalog");
    expect(parts[parts.length - 1], "pg_temp en dernier").toBe("pg_temp");
  });

  it("AC12 : EXECUTE refuse a PUBLIC et a tout role signet_*, aucun droit EXECUTE accorde explicitement", async () => {
    const exists = await asBypassRls((client) =>
      client.query<{ oid: string | null }>("SELECT to_regprocedure('" + TRIGGER_FUNCTION + "')::text AS oid"),
    );
    expect(exists.rows[0]?.oid, "precondition : " + TRIGGER_FUNCTION + " existe (migration 0017 attendue)").not.toBeNull();
    const { rows } = await asBypassRls((client) =>
      client.query<{ grantee: string; allowed: boolean }>(
        `SELECT g.grantee, has_function_privilege(g.grantee, to_regprocedure('${TRIGGER_FUNCTION}'), 'EXECUTE') AS allowed
           FROM unnest(ARRAY['public', 'signet_app', 'signet_auth', 'signet_billing', 'signet_owner']) AS g(grantee)`,
      ),
    );
    expect(rows.filter((r) => r.allowed).map((r) => r.grantee), "personne, hors proprietaire, ne peut executer la fonction").toEqual([]);

    const granted = await asBypassRls((client) =>
      client.query<{ grantee: string }>(
        `SELECT CASE WHEN a.grantee = 0 THEN 'public' ELSE (SELECT rolname::text FROM pg_roles WHERE oid = a.grantee) END AS grantee
           FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          WHERE p.oid = to_regprocedure('${TRIGGER_FUNCTION}') AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner`,
      ),
    );
    expect(granted.rows.map((r) => r.grantee)).toEqual([]);
  });

  it("AC12 : link_usage_on_insert figure parmi les fonctions SECURITY DEFINER de signet (la liste exacte est figee par les tests de 004 et 006, D-121)", async () => {
    const { rows } = await asBypassRls((client) =>
      client.query<{ proname: string }>(
        `SELECT DISTINCT p.proname::text AS proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE p.prosecdef AND n.nspname = 'signet'`,
      ),
    );

    expect(rows.map((r) => r.proname)).toContain("link_usage_on_insert");
  });

  it("AC12 : aucune politique de link n'est applicable a signet_definer (la fonction ecrit le compteur, pas link)", async () => {
    const exists = await asBypassRls((client) =>
      client.query<{ oid: string | null }>("SELECT to_regclass('public.link')::text AS oid"),
    );
    expect(exists.rows[0]?.oid, "precondition : public.link existe (migration 0017 attendue)").not.toBeNull();
    const { rows } = await asBypassRls((client) =>
      client.query<{ polname: string }>(
        `SELECT pol.polname::text AS polname FROM pg_policy pol
          WHERE pol.polrelid = to_regclass('public.link')
            AND (pol.polroles @> ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'signet_definer')]::oid[] OR 0::oid = ANY(pol.polroles))`,
      ),
    );
    expect(rows).toEqual([]);
  });
});
