// Invariants de securite verifies dans le catalogue Postgres, pour TOUT le
// schema et pas seulement pour ce qu'une tranche a pense a tester. Une fonction
// ou une table ajoutee demain sans ces protections fait echouer la suite.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { loadTestEnv, testDbUrl } from "./env";

loadTestEnv();
const schemas = (process.env.TEST_APP_SCHEMAS ?? "public").split(",").map((s) => s.trim()).filter(Boolean);
const rlsExempt = new Set((process.env.TEST_RLS_EXEMPT_TABLES ?? "").split(",").map((s) => s.trim()).filter(Boolean));
let db: pg.Client;

beforeAll(async () => {
  db = new pg.Client({ connectionString: testDbUrl() });
  await db.connect();
});
afterAll(async () => {
  await db?.end();
});

describe("catalogue Postgres — invariants de l'usine", () => {
  it("toute fonction SECURITY DEFINER fige son search_path", async () => {
    const { rows } = await db.query<{ sig: string; config: string[] | null }>(
      `SELECT p.oid::regprocedure::text AS sig, p.proconfig AS config
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef AND n.nspname = ANY($1)`,
      [schemas],
    );
    const bad = rows.filter((r) => !(r.config ?? []).some((c) => c.startsWith("search_path="))).map((r) => r.sig);
    expect(bad, "SECURITY DEFINER sans SET search_path : detournement de resolution de noms possible").toEqual([]);
  });

  it("aucune fonction SECURITY DEFINER n'est executable par PUBLIC", async () => {
    const { rows } = await db.query<{ sig: string }>(
      `SELECT p.oid::regprocedure::text AS sig
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef AND n.nspname = ANY($1)
          AND has_function_privilege('public', p.oid, 'EXECUTE')`,
      [schemas],
    );
    expect(rows.map((r) => r.sig), "EXECUTE accorde a PUBLIC : REVOKE ALL ON FUNCTION ... FROM PUBLIC").toEqual([]);
  });

  it("toute table applicative a RLS active ET forcee", async () => {
    const { rows } = await db.query<{ t: string; rls: boolean; force: boolean }>(
      `SELECT n.nspname || '.' || c.relname AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS force
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r','p') AND n.nspname = ANY($1)`,
      [schemas],
    );
    const bad = rows.filter((r) => !rlsExempt.has(r.t) && !(r.rls && r.force)).map((r) => r.t);
    expect(bad, "table sans RLS forcee (exemption explicite : TEST_RLS_EXEMPT_TABLES + ADR)").toEqual([]);
  });

  it("aucun role applicatif n'est superutilisateur ni BYPASSRLS, directement ou par heritage", async () => {
    // Roles applicatifs : proprietaires ou beneficiaires de droits dans les schemas
    // applicatifs, hors role de connexion des tests (l'administrateur qui migre).
    // TEST_APP_ROLES permet de les lister explicitement si la detection ne suffit pas.
    const explicit = (process.env.TEST_APP_ROLES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const { rows } = await db.query<{ role: string; bad: string[] }>(
      `WITH objs AS (
         SELECT c.relowner AS owner, c.relacl AS acl FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ANY($1)
         UNION ALL
         SELECT p.proowner, p.proacl FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = ANY($1)
       ), app_roles AS (
         SELECT owner AS oid FROM objs
         UNION SELECT (aclexplode(acl)).grantee FROM objs WHERE acl IS NOT NULL
         UNION SELECT oid FROM pg_roles WHERE rolname = ANY($2::text[])
       )
       SELECT r.rolname AS role,
              array_remove(ARRAY[
                CASE WHEN r.rolsuper THEN 'SUPERUSER' END,
                CASE WHEN r.rolbypassrls THEN 'BYPASSRLS' END,
                CASE WHEN EXISTS (SELECT 1 FROM pg_roles s
                                   WHERE s.oid <> r.oid AND (s.rolsuper OR s.rolbypassrls)
                                     AND pg_has_role(r.oid, s.oid, 'MEMBER'))
                     THEN 'membre d''un role privilegie' END
              ], NULL) AS bad
         FROM pg_roles r JOIN app_roles a ON a.oid = r.oid
        WHERE r.rolname <> current_user`,
      [schemas, explicit],
    );
    const missing = explicit.filter((e) => !rows.some((r) => r.role === e));
    expect(missing, "roles de TEST_APP_ROLES introuvables dans le cluster").toEqual([]);
    const bad = rows.filter((r) => r.bad.length > 0).map((r) => `${r.role} (${r.bad.join(", ")})`);
    expect(bad, "role applicatif privilegie : RLS contournee en silence. ALTER ROLE ... NOSUPERUSER NOBYPASSRLS").toEqual([]);
  });
});
