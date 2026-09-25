-- Migration 4 — Corrige signet.assert_owner_remains() (ERD §4, ADR-0007
-- Partie 2). Aucune table ni colonne ne change : correction pure d'une
-- fonction SECURITY DEFINER deja livree en 0003. "Ne jamais modifier une
-- migration deja appliquee" (CLAUDE.md) : 0003 reste intacte, 0004 remplace
-- la fonction par CREATE OR REPLACE ; le trigger member_keep_last_owner
-- (0003, inchange) continue de l'appeler telle quelle.
--
-- Bug corrige : la version 0003 de cette fonction omettait l'instruction
-- PERFORM set_config('app.organization_id', ...) qu'ADR-0007 (Partie 2,
-- tableau "Solution retenue, fonction par fonction") documente pourtant
-- comme sa toute premiere instruction. Sans ce contexte, les politiques RLS
-- de organization/member (organization_isolation, member_isolation,
-- organization_definer_self_read, member_definer_self_read) exigent toutes
-- organization_id = current_org() ou user_id = current_user_id() pour
-- rendre une ligne visible a signet_definer (qui n'a pas BYPASSRLS,
-- ADR-0007) : current_org() valait NULL, donc AUCUNE ligne organization ni
-- member n'etait jamais visible a cette fonction. v_org_exists valait donc
-- systematiquement faux, la fonction prenait toujours la branche
-- « organisation deja supprimee » et laissait passer la suppression du
-- dernier owner, quelle que soit la situation reelle en base — invariant
-- "au moins un owner" (ERD §4) silencieusement non applique.

CREATE OR REPLACE FUNCTION signet.assert_owner_remains() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, signet, public
AS $$
DECLARE
  v_org_exists   boolean;
  v_owner_exists boolean;
BEGIN
  -- Pose le contexte tenant sur l'organisation concernee par CE DELETE,
  -- avant toute lecture (ADR-0007 Partie 2) : signet_definer n'a pas
  -- BYPASSRLS, les politiques RLS de organization/member exigent ce
  -- contexte pour rendre leurs lignes visibles a ce role.
  PERFORM set_config('app.organization_id', OLD.organization_id::text, true);

  SELECT EXISTS (SELECT 1 FROM organization WHERE id = OLD.organization_id) INTO v_org_exists;
  IF NOT v_org_exists THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM member WHERE organization_id = OLD.organization_id AND role = 'owner'
  ) INTO v_owner_exists;

  IF NOT v_owner_exists THEN
    RAISE EXCEPTION 'member_keep_last_owner: organization % would be left without an owner',
      OLD.organization_id;
  END IF;

  RETURN NULL;
END;
$$;

ALTER FUNCTION signet.assert_owner_remains() OWNER TO signet_definer;
