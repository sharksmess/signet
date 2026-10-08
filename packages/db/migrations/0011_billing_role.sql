-- Migration 11 — Role signet_billing (tranche 002, Q-1, D-057) et extension
-- de l'assertion de roles de 0010 (audit-010 INFO-1, D-064).
-- ADR-0007 (amende par la tranche 002), ADR-0011 § h ; ERD §1 « Roles
-- Postgres » et §8.1.
--
-- Migration de roles SEPAREE de celle de billing_event (D-064, precedent
-- ADR-0011 § h) : les roles sont communs au cluster, la RLS est propre a la
-- base. Ce fichier ne touche aucune table, aucune fonction, aucun privilege
-- d'objet. L'EXECUTE de signet_billing sur la fonction d'application d'etat
-- Stripe est accorde par la migration qui cree cette fonction, pas ici.
--
-- Ce que fait ce fichier :
--   1. CREE signet_billing s'il n'existe pas (creation idempotente) ;
--   2. LEVE si l'un des cinq roles signet_* est membre d'un role, OU si un
--      role quelconque est membre de l'un d'eux (INFO-1, sens inverse) ;
--   3. LEVE si un reglage par role (ALTER ROLE ... SET, pg_db_role_setting)
--      existe pour l'un des cinq roles, dans n'importe quelle base (INFO-1) ;
--   4. REIMPOSE les attributs des cinq roles, inconditionnellement.
--
-- SECURITE — AUCUN MOT DE PASSE N'EST FIXE ICI. signet_billing est LOGIN sans
-- mot de passe : l'humain le fixe hors migration (runbook
-- docs/04-runbooks/stripe-facturation-locale.md), la CI par
-- TEST_ROLE_PASSWORDS.
--
-- Idempotente : rejouee sur un cluster conforme, elle ne change rien. Pas de
-- BEGIN/COMMIT : packages/db/src/migrate.ts enveloppe le fichier.
--
-- Doit etre jouee par un superutilisateur (seul autorise a poser
-- NOSUPERUSER/NOBYPASSRLS/NOREPLICATION), comme toutes les migrations
-- (ADR-0007).

-- ============================================================================
-- 1. Creation idempotente de signet_billing
-- ============================================================================
-- Role de connexion de la seule fonction Inngest de traitement des evenements
-- Stripe (AC16). Aucun droit de table : il n'agit que par la fonction
-- SECURITY DEFINER d'application d'etat (ADR-0016). Ni signet_app (toute
-- route pourrait changer le palier de n'importe quelle organisation, D-033)
-- ni signet_owner (proprietaire des tables, peut desactiver la RLS) : Q-1.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'signet_billing') THEN
    CREATE ROLE signet_billing LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

-- ============================================================================
-- 2. Appartenances, dans les deux sens : lever, ne pas revoquer
-- ============================================================================
-- Sens 1 (deja leve par 0010 pour quatre roles, etendu au cinquieme) : un role
-- signet_* membre d'un autre role peut SET ROLE vers lui.
-- Sens 2 (INFO-1) : un role quelconque membre d'un role signet_* herite de
-- ses droits ou peut SET ROLE vers lui ; membre de signet_owner, il peut
-- desactiver la RLS ; membre de signet_billing, il peut changer le palier de
-- toute organisation par la fonction d'application d'etat.
-- On leve plutot que de revoquer (meme raison que 0010) : l'appartenance a
-- ete accordee par un administrateur sur un etat commun au cluster. Le
-- message ne cite que des noms de roles (SQLSTATE P0001 par defaut).

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
   WHERE m.rolname IN ('signet_owner', 'signet_app', 'signet_auth', 'signet_definer', 'signet_billing')
      OR r.rolname IN ('signet_owner', 'signet_app', 'signet_auth', 'signet_definer', 'signet_billing');

  IF v_memberships IS NOT NULL THEN
    RAISE EXCEPTION 'appartenance impliquant un role signet_* (interdit, ADR-0007/ADR-0011) : %', v_memberships
      USING HINT = 'Un administrateur doit revoquer ces appartenances (REVOKE <role parent> FROM <role membre>) avant de rejouer la migration.';
  END IF;
END $$;

-- ============================================================================
-- 3. Reglages par role (pg_db_role_setting) : lever, ne pas effacer
-- ============================================================================
-- INFO-1 : ALTER ROLE ... [IN DATABASE ...] SET pose un parametre a chaque
-- connexion du role (search_path, role, session_authorization...), hors de
-- toute migration versionnee. Un search_path detourne change la resolution
-- des noms non qualifies ; aucun de ces roles n'en a besoin. On leve pour la
-- meme raison qu'au point 2. Le message cite les roles et les bases, jamais
-- les valeurs (setconfig).

DO $$
DECLARE
  v_settings text;
BEGIN
  SELECT string_agg(format('%s (base %s)', r.rolname,
                           COALESCE(d.datname, 'toutes')), ', '
                    ORDER BY r.rolname, d.datname)
    INTO v_settings
    FROM pg_catalog.pg_db_role_setting s
    JOIN pg_catalog.pg_roles r ON r.oid = s.setrole
    LEFT JOIN pg_catalog.pg_database d ON d.oid = s.setdatabase
   WHERE r.rolname IN ('signet_owner', 'signet_app', 'signet_auth', 'signet_definer', 'signet_billing');

  IF v_settings IS NOT NULL THEN
    RAISE EXCEPTION 'reglage par role sur un role signet_* (interdit, ADR-0007) : %', v_settings
      USING HINT = 'Un administrateur doit retirer ces reglages (ALTER ROLE <role> [IN DATABASE <base>] RESET ALL) avant de rejouer la migration.';
  END IF;
END $$;

-- ============================================================================
-- 4. Attributs : reimposer, inconditionnellement (cinq roles)
-- ============================================================================
-- Etat cible exhaustif : ADR-0007 amende (tableau des roles) et ERD §1.

ALTER ROLE signet_owner   LOGIN   NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE signet_app     LOGIN   NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE signet_auth    LOGIN   NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE signet_definer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE signet_billing LOGIN   NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
