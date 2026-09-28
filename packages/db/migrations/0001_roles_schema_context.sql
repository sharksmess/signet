-- Migration 1 — Roles, schema `signet`, fonctions de contexte (ERD §0, §1).
--
-- Doit etre jouee par un role suffisamment privilegie pour creer des roles et
-- un schema (typiquement le superuser d'une instance Postgres 16 locale ou
-- jetable de developpement/test — voir tests/helpers/db.ts en tete de
-- fichier : "conteneur ou instance dediee"). Ce role n'est PAS l'un des
-- quatre roles applicatifs crees ci-dessous.
--
-- SECURITE — AUCUN MOT DE PASSE N'EST FIXE ICI. Les roles LOGIN crees par
-- cette migration (signet_owner, signet_app, signet_auth) n'ont volontairement
-- aucun mot de passe : le fixer est une operation humaine, hors de toute
-- migration versionnee (cf. CLAUDE.md : "les secrets ne sont jamais en dur").
-- Avant de pouvoir se connecter sous l'un de ces roles, executer separement :
--   ALTER ROLE signet_owner WITH PASSWORD '...';
--   ALTER ROLE signet_app   WITH PASSWORD '...';
--   ALTER ROLE signet_auth  WITH PASSWORD '...';
-- `signet_definer` est NOLOGIN : il n'est jamais atteint par une connexion
-- directe, uniquement par l'execution des fonctions SECURITY DEFINER qu'il
-- possede (ERD §1).

-- --------------------------------------------------------------------------
-- Roles
-- --------------------------------------------------------------------------

-- Proprietaire des tables applicatives (ERD : "role proprietaire", cf.
-- TEST_DATABASE_URL_TABLE_OWNER). Ne sert JAMAIS aux requetes applicatives :
-- FORCE ROW LEVEL SECURITY s'applique a lui comme a n'importe quel role,
-- puisqu'il n'a pas BYPASSRLS (ERD §1 : "FORCE est indispensable : sans lui,
-- le role proprietaire ... contourne silencieusement toutes les politiques").
--
-- Les roles sont communs au cluster, pas a la base : une base de test neuve
-- sur un cluster ou ils existent deja ne doit pas faire echouer la migration.
-- Chaque creation est donc conditionnelle ; attributs inchanges.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'signet_owner') THEN
    CREATE ROLE signet_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

-- Role applicatif non privilegie sous lequel l'application (Route Handlers /
-- Server Actions) execute ses requetes tenant (ADR-0001). Jamais BYPASSRLS.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'signet_app') THEN
    CREATE ROLE signet_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

-- Role dedie a better-auth, limite aux quatre tables d'authentification
-- (ERD §2). Distinct de signet_app : l'authentification precede le contexte
-- tenant et ne doit jamais pouvoir lire/ecrire les tables tenant.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'signet_auth') THEN
    CREATE ROLE signet_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

-- Role proprietaire des fonctions SECURITY DEFINER et de leurs triggers
-- internes (ERD §1, liste fermee). NOLOGIN : inatteignable par connexion
-- directe. PAS de BYPASSRLS (ADR-0007, Partie 2) : `SET LOCAL
-- app.organization_id`/`app.user_id` reste un parametre de SESSION visible
-- a l'interieur d'une fonction SECURITY DEFINER (qui ne change que
-- l'identite d'execution, pas la session) ; chaque fonction pose ou lit ce
-- contexte pour l'organisation unique qu'elle traite, ou s'appuie sur une
-- politique additionnelle scopee par current_user_id() quand elle doit
-- legitimement voir plusieurs organisations (signet.organizations_for_user,
-- seule exception documentee par ADR-0002).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'signet_definer') THEN
    CREATE ROLE signet_definer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- Schema `signet` — fonctions et roles, jamais les tables (ERD §0 : les
-- tables vivent dans `public`, seules les fonctions sont qualifiees
-- `signet.xxx`).
-- --------------------------------------------------------------------------

CREATE SCHEMA signet AUTHORIZATION signet_definer;

REVOKE ALL ON SCHEMA signet FROM PUBLIC;
GRANT USAGE ON SCHEMA signet TO signet_app, signet_auth, signet_owner;

-- --------------------------------------------------------------------------
-- signet.uuidv7() — Postgres 16 n'a pas uuidv7() natif (ERD §0). Construit a
-- partir de gen_random_uuid() (core depuis PG13, aucune extension requise) :
-- les 48 premiers bits deviennent l'horodatage unix en millisecondes, le
-- nibble de version (bits 48-51) et les deux bits de variant (bits 64-65)
-- sont poses explicitement, le reste des bits aleatoires de gen_random_uuid()
-- est conserve tel quel (74 bits d'alea, conforme a la RFC brouillon UUIDv7).
-- --------------------------------------------------------------------------

CREATE FUNCTION signet.uuidv7() RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  v_time_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  v_bytes   bytea  := uuid_send(gen_random_uuid());
BEGIN
  v_bytes := set_byte(v_bytes, 0, ((v_time_ms >> 40) & 255)::int);
  v_bytes := set_byte(v_bytes, 1, ((v_time_ms >> 32) & 255)::int);
  v_bytes := set_byte(v_bytes, 2, ((v_time_ms >> 24) & 255)::int);
  v_bytes := set_byte(v_bytes, 3, ((v_time_ms >> 16) & 255)::int);
  v_bytes := set_byte(v_bytes, 4, ((v_time_ms >> 8) & 255)::int);
  v_bytes := set_byte(v_bytes, 5, (v_time_ms & 255)::int);
  -- byte 6 : nibble haut = version 0111, nibble bas conserve (alea)
  v_bytes := set_byte(v_bytes, 6, (112 | (get_byte(v_bytes, 6) & 15)));
  -- byte 8 : deux bits hauts = variant 10, six bits bas conserves (alea)
  v_bytes := set_byte(v_bytes, 8, (128 | (get_byte(v_bytes, 8) & 63)));
  RETURN encode(v_bytes, 'hex')::uuid;
END;
$$;

COMMENT ON FUNCTION signet.uuidv7() IS
  'UUIDv7 (horodatage + alea), cf. ERD §0. Utilise comme DEFAULT de chaque cle primaire.';

GRANT EXECUTE ON FUNCTION signet.uuidv7() TO signet_owner, signet_app, signet_auth, signet_definer;

-- --------------------------------------------------------------------------
-- Fonctions de contexte tenant (ERD §1). STABLE, pas SECURITY DEFINER :
-- elles ne font que lire la configuration de session courante.
-- --------------------------------------------------------------------------

CREATE FUNCTION signet.current_org() RETURNS uuid
LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.organization_id', true), '')::uuid $$;

CREATE FUNCTION signet.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

COMMENT ON FUNCTION signet.current_org() IS
  'Organisation active du contexte transactionnel courant (SET LOCAL app.organization_id), ou NULL. ERD §1 : fermeture par defaut si non pose.';
COMMENT ON FUNCTION signet.current_user_id() IS
  'Utilisateur authentifie du contexte transactionnel courant (SET LOCAL app.user_id), ou NULL.';

GRANT EXECUTE ON FUNCTION signet.current_org() TO signet_app, signet_definer;
GRANT EXECUTE ON FUNCTION signet.current_user_id() TO signet_app, signet_definer;
