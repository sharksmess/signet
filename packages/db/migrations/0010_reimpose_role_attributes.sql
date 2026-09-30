-- Migration 10 — Attributs des quatre roles signet_* reimposes (ADR-0011 § h,
-- audit-001 MINEUR-10, D-024 ; ERD §1 « Roles Postgres »).
--
-- Les roles sont communs au cluster : 0001 ne les cree que s'ils n'existent
-- pas, sans toucher aux attributs d'un role preexistant. Un role cree a la
-- main avec BYPASSRLS, ou une appartenance accordee apres coup, passerait donc
-- sans signal. Cette migration :
--   1. LEVE si l'un des quatre roles est membre d'un role quelconque ;
--   2. REIMPOSE leurs attributs, inconditionnellement.
--
-- Idempotente : rejouee sur un cluster conforme, elle ne change rien. Aucun
-- mot de passe (poses hors migration, par l'humain ou la CI). Pas de
-- BEGIN/COMMIT : packages/db/src/migrate.ts enveloppe le fichier, et le test
-- d'AC6 (tests/isolation-hardening/roles.test.ts) le rejoue tel quel dans sa
-- propre transaction, toujours annulee.
--
-- Doit etre jouee par un superutilisateur (seul autorise a poser
-- NOSUPERUSER/NOBYPASSRLS/NOREPLICATION), comme toutes les migrations
-- (ADR-0007). Si un jour les migrations sont jouees par un role non
-- superutilisateur, ce fichier est a revoir (ADR-0011, signal de reexamen).

-- ============================================================================
-- 1. Appartenances : lever, ne pas revoquer
-- ============================================================================
-- ADR-0007 n'accorde aucune appartenance a ces roles. Une appartenance permet
-- SET ROLE vers le role parent : membre de signet_owner, signet_app pourrait
-- desactiver la RLS d'une table ; membre d'un superutilisateur, tout. Les
-- attributs SUPERUSER/BYPASSRLS ne s'heritent pas, mais SET ROLE suffit.
-- On leve plutot que de revoquer : l'appartenance a ete accordee par un
-- administrateur sur un etat commun au cluster ; la retirer en silence
-- cacherait la mauvaise configuration et pourrait casser un autre usage.
-- Le message ne cite que des noms de roles (SQLSTATE P0001 par defaut).

DO $$
DECLARE
  v_memberships text;
BEGIN
  SELECT string_agg(format('%s membre de %s', m.rolname, r.rolname), ', '
                    ORDER BY m.rolname, r.rolname)
    INTO v_memberships
    FROM pg_catalog.pg_auth_members am
    JOIN pg_catalog.pg_roles m ON m.oid = am.member
    JOIN pg_catalog.pg_roles r ON r.oid = am.roleid
   WHERE m.rolname IN ('signet_owner', 'signet_app', 'signet_auth', 'signet_definer');

  IF v_memberships IS NOT NULL THEN
    RAISE EXCEPTION 'role signet_* membre d''un autre role (interdit, ADR-0007/ADR-0011) : %', v_memberships
      USING HINT = 'Un administrateur doit revoquer ces appartenances (REVOKE <role parent> FROM <role signet_*>) avant de rejouer la migration.';
  END IF;
END $$;

-- ============================================================================
-- 2. Attributs : reimposer, inconditionnellement
-- ============================================================================
-- L'etat cible est defini de facon exhaustive par ADR-0007 (+ NOREPLICATION,
-- ADR-0011 § h : un role REPLICATION lit toutes les donnees par le protocole
-- de replication, hors RLS). Sur un cluster neuf, aucun changement.

ALTER ROLE signet_owner   LOGIN   NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE signet_app     LOGIN   NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE signet_auth    LOGIN   NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE signet_definer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
