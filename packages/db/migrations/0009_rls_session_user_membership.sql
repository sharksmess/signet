-- Migration 9 — La RLS de signet_app exige l'appartenance de l'utilisateur de
-- session a l'organisation du contexte (ADR-0011, D-022 option A, audit-001
-- MINEUR-1 ; ERD §1, §3, §4).
--
-- Aucune table, colonne ni index ne change (ADR-0011 § c, § j :
-- member_org_user_idx UNIQUE (organization_id, user_id) sert deja la recherche
-- de current_org()). 0001-0008 restent intactes ("ne jamais modifier une
-- migration deja appliquee") : les fonctions touchees sont remplacees par
-- CREATE OR REPLACE, les politiques modifiees par ALTER POLICY.
--
-- Pas de BEGIN/COMMIT : packages/db/src/migrate.ts execute deja ce fichier
-- entier dans une transaction.
--
-- Plan (ADR-0011 § Decision, option A3 + R1) :
--   1. signet.context_org()  : nouvelle primitive BRUTE (l'ancienne
--      current_org()), reservee a signet_definer.
--   2. Politiques : celles de signet_definer passent a context_org() ;
--      organization_isolation et member_isolation sont restreintes a
--      signet_app (texte inchange).
--   3. signet.current_org()  : devient la primitive VERIFIEE (SECURITY
--      DEFINER, proprietaire signet_definer). Les politiques signet_app,
--      dont le texte ne change pas, heritent de la verification par l'OID
--      de la fonction.
--   4. create_organization / organizations_for_user : garde d'identite de
--      session, SQLSTATE SG002 (ERD §0).
--   5. Trois fonctions de trigger : search_path complete par pg_temp.
--
-- Ordre de lecture : les politiques signet_definer reposent sur
-- context_org() AVANT que current_org() ne verifie l'appartenance. Une
-- politique signet_definer qui appellerait current_org() relirait member sous
-- signet_definer, dont les politiques rappelleraient current_org() : recursion
-- (ADR-0011 R1).

-- ============================================================================
-- 1. signet.context_org() — valeur brute de app.organization_id
-- ============================================================================
-- Reservee aux politiques de signet_definer (ERD §1). Chaque fonction
-- SECURITY DEFINER pose ce contexte elle-meme depuis une valeur de confiance
-- (id genere, NEW/OLD d'un trigger), jamais depuis l'appelant HTTP : exiger
-- l'appartenance ici casserait create_organization (le member owner n'existe
-- pas encore a l'INSERT INTO organization) et propagate_subscription_quota
-- (webhook sans utilisateur de session).
--
-- SECURITY INVOKER : elle ne lit que la configuration de session. Aucun
-- GRANT : seul son proprietaire, signet_definer, peut l'executer. Une
-- politique signet_app qui l'appellerait par erreur echoue donc bruyamment
-- (42501, permission denied for function context_org) des la premiere
-- requete, au lieu de rendre la politique tautologique en silence.

CREATE FUNCTION signet.context_org() RETURNS uuid
LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.organization_id', true), '')::uuid $$;

-- Creee par le role de migration : sa propriete est cedee explicitement.
-- La revocation globale de 0008 retire deja EXECUTE a PUBLIC a la creation ;
-- le REVOKE explicite pose la regle ici sans dependre de ce privilege par
-- defaut.
ALTER FUNCTION signet.context_org() OWNER TO signet_definer;
REVOKE ALL ON FUNCTION signet.context_org() FROM PUBLIC;

COMMENT ON FUNCTION signet.context_org() IS
  'Valeur BRUTE de app.organization_id (SET LOCAL), ou NULL. Reservee aux politiques de signet_definer, dont les fonctions posent le contexte depuis une valeur de confiance. Jamais executable par signet_app (ADR-0011, ERD §1).';

-- ============================================================================
-- 2. Politiques RLS — separation signet_app / signet_definer (ADR-0011 § d)
-- ============================================================================

-- organization / member : les politiques communes de 0003 sont restreintes a
-- signet_app. Leur texte (... = signet.current_org()) ne change pas : il
-- devient verifie par l'etape 3.
ALTER POLICY "organization_isolation" ON "organization" TO signet_app;
ALTER POLICY "member_isolation" ON "member" TO signet_app;

-- Remplacent, pour signet_definer, la part de organization_isolation /
-- member_isolation qui lui etait appliquee jusqu'ici (ADR-0007 Partie 2,
-- amende par ADR-0011) : contexte brut, pose par la fonction elle-meme.
CREATE POLICY "organization_definer_context" ON "organization" TO signet_definer
  USING (id = signet.context_org())
  WITH CHECK (id = signet.context_org());

CREATE POLICY "member_definer_context" ON "member" TO signet_definer
  USING (organization_id = signet.context_org())
  WITH CHECK (organization_id = signet.context_org());

-- Ecritures des triggers signet_definer : meme predicat qu'avant, sur la
-- primitive brute.
ALTER POLICY "organization_link_usage_definer_write" ON "organization_link_usage"
  USING (organization_id = signet.context_org())
  WITH CHECK (organization_id = signet.context_org());

ALTER POLICY "subscription_definer_insert" ON "subscription"
  WITH CHECK (organization_id = signet.context_org());

-- member_definer_self_read et organization_definer_self_read (0003) reposent
-- sur current_user_id() seul et n'appellent pas current_org() : inchangees.
-- Invariant (ADR-0011 R1, verifie par test de catalogue) : AUCUNE politique
-- applicable a signet_definer n'appelle signet.current_org().

-- ============================================================================
-- 3. signet.current_org() — valeur verifiee (ADR-0011 A3, R1)
-- ============================================================================
-- Renvoie app.organization_id seulement si l'utilisateur de session
-- (app.user_id) y est membre, sinon NULL (fermeture par defaut, ne leve pas :
-- primitive de politique, pas une operation — exception documentee par
-- ADR-0011 a drizzle-postgres.md points 3 et 6).
--
-- SECURITY DEFINER, proprietaire signet_definer : la requete interne sur
-- member s'evalue sous les politiques de signet_definer
-- (member_definer_context, member_definer_self_read), qui n'appellent pas
-- current_org() : pas de recursion. La ligne cherchee (user_id =
-- current_user_id()) est visible par member_definer_self_read.
--
-- STABLE (ADR-0011 § c) : constant au sein d'une instruction, relu a chaque
-- instruction ; un changement d'appartenance dans la transaction est vu par
-- l'instruction suivante. Jamais IMMUTABLE (pre-evaluation figee dans un plan
-- prepare reutilise par le pool).
--
-- search_path fige avec pg_temp EN DERNIER et table qualifiee : sans pg_temp
-- explicite, Postgres chercherait les relations dans le schema temporaire en
-- premier, et signet_app (droit TEMPORARY par defaut) pourrait masquer member
-- par une table temporaire.
--
-- Sans parametre : elle ne repond que pour le couple (current_user_id(),
-- context_org()) deja pose dans la session ; ce n'est pas un oracle
-- d'appartenance d'autrui.

CREATE OR REPLACE FUNCTION signet.current_org() RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, signet, public, pg_temp
AS $$
  SELECT m.organization_id
    FROM public.member m
   WHERE m.organization_id = signet.context_org()
     AND m.user_id         = signet.current_user_id()
$$;

-- CREATE OR REPLACE conserve le proprietaire : current_org() a ete creee en
-- 0001 par le role de migration (superutilisateur). Une fonction SECURITY
-- DEFINER possedee par un superutilisateur s'executerait hors RLS ; la
-- propriete est donc cedee explicitement (ERD §1, point 4). EXECUTE :
-- signet_app seul, en plus du proprietaire (aucune politique ni fonction de
-- signet_definer ne l'appelle).
ALTER FUNCTION signet.current_org() OWNER TO signet_definer;
REVOKE ALL ON FUNCTION signet.current_org() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION signet.current_org() TO signet_app;

COMMENT ON FUNCTION signet.current_org() IS
  'Organisation du contexte (app.organization_id) SI l''utilisateur de session (app.user_id) en est membre, sinon NULL. Primitive des politiques signet_app uniquement ; ne leve pas sur contexte absent. Jamais appelee par une politique signet_definer (recursion). ADR-0011, ERD §1.';

-- ============================================================================
-- 4. Fonctions dependant de l'utilisateur de session (ADR-0011 § e, AC4)
-- ============================================================================
-- Premiere instruction : garde d'identite. current_user_id() absent, ou
-- different du parametre (IS DISTINCT FROM, qui ferme aussi le cas NULL) :
-- SQLSTATE SG002 (ERD §0), avant tout set_config et toute lecture. SG002 et
-- non 42501, pour que le refus d'EXECUTE (42501) reste distinguable d'un
-- appel autorise mais sans identite (ADR-0011 § e, audit-001 MINEUR-9).
-- Les messages ne contiennent aucun identifiant.

CREATE OR REPLACE FUNCTION signet.create_organization(p_owner_user_id uuid, p_org_name text)
RETURNS public.organization
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, signet, public, pg_temp
AS $$
DECLARE
  v_session_user uuid;
  v_org_id       uuid;
  v_base_slug    text;
  v_slug         text;
  v_org          public.organization;
  v_attempt      int := 0;
BEGIN
  -- Garde d'identite (ADR-0011 § e) : jamais d'organisation creee au nom
  -- d'un utilisateur que la session n'a pas authentifie.
  v_session_user := signet.current_user_id();
  IF v_session_user IS NULL THEN
    RAISE EXCEPTION 'create_organization: session user (app.user_id) is not set'
      USING ERRCODE = 'SG002';
  END IF;
  IF p_owner_user_id IS DISTINCT FROM v_session_user THEN
    RAISE EXCEPTION 'create_organization: owner_user_id differs from the session user'
      USING ERRCODE = 'SG002';
  END IF;

  IF btrim(coalesce(p_org_name, '')) = '' THEN
    RAISE EXCEPTION 'create_organization: org_name is required';
  END IF;

  -- Identifiant genere avant le premier INSERT pour poser le contexte
  -- tenant dessus (ADR-0007 Partie 2) : les politiques signet_definer
  -- (organization_definer_context, member_definer_context,
  -- organization_link_usage_definer_write, subscription_definer_insert)
  -- comparent a context_org(), valeur de confiance generee ici.
  v_org_id := signet.uuidv7();
  PERFORM set_config('app.organization_id', v_org_id::text, true);

  v_base_slug := lower(regexp_replace(btrim(p_org_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := regexp_replace(v_base_slug, '(^-+)|(-+$)', '', 'g');
  IF v_base_slug = '' THEN
    v_base_slug := 'org';
  END IF;
  IF char_length(v_base_slug) > 55 THEN
    v_base_slug := regexp_replace(left(v_base_slug, 55), '-+$', '', 'g');
  END IF;
  IF char_length(v_base_slug) < 2 THEN
    v_base_slug := v_base_slug || '-org';
  END IF;

  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt = 1 THEN
      v_slug := v_base_slug;
    ELSE
      v_slug := v_base_slug || '-' || v_attempt::text;
    END IF;
    IF char_length(v_slug) > 60 THEN
      v_slug := left(v_slug, 60);
    END IF;

    -- Sous-transaction implicite : une violation d'unicite concurrente du
    -- slug est absorbee et retentee avec le suffixe suivant (tranche 001,
    -- AC3a/AC3b). v_org_id reste fixe, seul le slug change.
    BEGIN
      INSERT INTO public.organization (id, name, slug)
      VALUES (v_org_id, btrim(p_org_name), v_slug)
      RETURNING * INTO v_org;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 50 THEN
        RAISE;
      END IF;
    END;
  END LOOP;

  INSERT INTO public.member (organization_id, user_id, role)
  VALUES (v_org.id, v_session_user, 'owner');

  RETURN v_org;
END;
$$;

ALTER FUNCTION signet.create_organization(uuid, text) OWNER TO signet_definer;
REVOKE ALL ON FUNCTION signet.create_organization(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION signet.create_organization(uuid, text) TO signet_app;

COMMENT ON FUNCTION signet.create_organization(uuid, text) IS
  'Seul chemin de creation d''organisation (ERD §1, §3) : organization + member owner (+ compteur et abonnement par trigger). Leve SG002 si app.user_id est absent ou differe de p_owner_user_id (ADR-0011).';

CREATE OR REPLACE FUNCTION signet.organizations_for_user(p_user_id uuid)
RETURNS SETOF public.organization
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, signet, public, pg_temp
AS $$
DECLARE
  v_session_user uuid;
BEGIN
  -- Garde d'identite (ADR-0011 § e). La garde de 0003 (p_user_id <>
  -- current_user_id()) valait NULL, donc ne levait pas, quand app.user_id
  -- etait absent.
  v_session_user := signet.current_user_id();
  IF v_session_user IS NULL THEN
    RAISE EXCEPTION 'organizations_for_user: session user (app.user_id) is not set'
      USING ERRCODE = 'SG002';
  END IF;
  IF p_user_id IS DISTINCT FROM v_session_user THEN
    RAISE EXCEPTION 'organizations_for_user: caller may only list their own organizations'
      USING ERRCODE = 'SG002';
  END IF;

  -- Axe utilisateur (ADR-0002, seule lecture inter-tenant legitime) :
  -- organization_definer_self_read et member_definer_self_read, bornees a
  -- current_user_id().
  RETURN QUERY
    SELECT o.*
      FROM public.organization o
      JOIN public.member m ON m.organization_id = o.id
     WHERE m.user_id = v_session_user;
END;
$$;

ALTER FUNCTION signet.organizations_for_user(uuid) OWNER TO signet_definer;
REVOKE ALL ON FUNCTION signet.organizations_for_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION signet.organizations_for_user(uuid) TO signet_app;

COMMENT ON FUNCTION signet.organizations_for_user(uuid) IS
  'Organisations de l''utilisateur de session (ERD §1, ADR-0002). Leve SG002 si app.user_id est absent ou differe de p_user_id (ADR-0011).';

-- ============================================================================
-- 5. Fonctions de trigger : pg_temp en fin de search_path (ADR-0011 §
--    Decision, D-027). Corps inchanges ; correction preventive, aucune n'est
--    aujourd'hui atteignable par signet_app. ALTER FUNCTION ... SET ne change
--    ni le proprietaire ni les privileges.
-- ============================================================================

ALTER FUNCTION signet.create_organization_counters()
  SET search_path = pg_catalog, signet, public, pg_temp;
ALTER FUNCTION signet.propagate_subscription_quota()
  SET search_path = pg_catalog, signet, public, pg_temp;
ALTER FUNCTION signet.assert_owner_remains()
  SET search_path = pg_catalog, signet, public, pg_temp;
