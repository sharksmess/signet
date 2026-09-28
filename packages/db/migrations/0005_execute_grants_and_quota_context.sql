-- Migration 5 — Deux correctifs issus de l'audit de securite de la tranche
-- 001 (docs/04-runbooks/audits/audit-001.md, constats MAJEUR-1 et MAJEUR-2).
-- Aucune table ni colonne ne change. 0001-0004 restent intactes ("ne jamais
-- modifier une migration deja appliquee") : les fonctions touchees sont
-- remplacees par CREATE OR REPLACE, les grants sont additifs/soustractifs.

-- ============================================================================
-- MAJEUR-2 — signet.propagate_subscription_quota() ne posait aucun contexte
-- tenant et ne verifiait pas le nombre de lignes affectees. Meme famille de
-- defaut que celui corrige en 0004 pour assert_owner_remains() : sans
-- SET LOCAL app.organization_id, la politique RLS
-- organization_link_usage_definer_write (USING organization_id =
-- signet.current_org()) ne rend visible aucune ligne a signet_definer, l'
-- UPDATE affecte zero ligne, et la fonction retournait en succes malgre tout
-- (aucune verification de ROW_COUNT). Scenario concret : un changement de
-- palier hors de la transaction de signet.create_organization() — correction
-- manuelle d'un operateur aujourd'hui, webhook Stripe des la tranche 002 (qui
-- par nature n'a aucun contexte tenant, ERD §8.1) — laissait organization_
-- link_usage.link_quota fige, silencieusement.
-- ============================================================================

CREATE OR REPLACE FUNCTION signet.propagate_subscription_quota() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, signet, public
AS $$
DECLARE
  v_updated integer;
BEGIN
  -- Pose le contexte tenant sur l'organisation concernee par CETTE ligne de
  -- subscription, avant toute ecriture (patron ADR-0007 Partie 2, deja
  -- applique a assert_owner_remains en 0004) : signet_definer n'a pas
  -- BYPASSRLS, organization_link_usage_definer_write exige ce contexte.
  PERFORM set_config('app.organization_id', NEW.organization_id::text, true);

  UPDATE organization_link_usage
     SET link_quota = signet.quota_for_tier(NEW.tier), updated_at = now()
   WHERE organization_id = NEW.organization_id;

  -- ERD §7 impose ce meme garde-fou pour le trigger frere sur `link` :
  -- « une organisation sans compteur est un bug, pas un cas a absorber
  -- silencieusement ». L'UPDATE ci-dessus DOIT toucher exactement une ligne ;
  -- zero ligne (contexte manquant, ou compteur absent) doit lever, pas
  -- passer inapercu.
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'propagate_subscription_quota: organization % has no link usage counter row (expected exactly 1 row updated, got %)',
      NEW.organization_id, v_updated;
  END IF;

  RETURN NULL;
END;
$$;

ALTER FUNCTION signet.propagate_subscription_quota() OWNER TO signet_definer;

-- Aggravant releve par l'audit : signet.create_organization_counters()
-- inserait link_quota = NULL (illimite) a la creation, en misant sur le
-- trigger ci-dessus (declenche par l'INSERT INTO subscription qui suit,
-- dans la meme transaction) pour le corriger a 50 immediatement apres. Un
-- defaut NULL est un defaut OUVERT, a l'inverse du principe de fermeture par
-- defaut d'ERD §1 : si ce deuxieme trigger echouait ou etait contourne, le
-- compteur resterait illimite plutot que bloque. Le defaut est desormais la
-- limite du palier Free elle-meme, pas une valeur qu'un trigger suivant doit
-- imperativement corriger pour qu'elle soit sure.
CREATE OR REPLACE FUNCTION signet.create_organization_counters() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, signet, public
AS $$
BEGIN
  INSERT INTO organization_link_usage (organization_id, link_count, link_quota)
  VALUES (NEW.id, 0, signet.quota_for_tier('free'));

  INSERT INTO subscription (organization_id, tier, status)
  VALUES (NEW.id, 'free', 'active');

  RETURN NULL;
END;
$$;

ALTER FUNCTION signet.create_organization_counters() OWNER TO signet_definer;

-- ============================================================================
-- MAJEUR-1 — Postgres accorde EXECUTE a PUBLIC par defaut sur toute fonction
-- creee. 0001 revoque ALL ON SCHEMA signet FROM PUBLIC (schema) mais ne
-- touchait jamais l'EXECUTE implicite au niveau des fonctions elles-memes :
-- les GRANT EXECUTE ... TO signet_app deja presents en 0003 etaient donc
-- redondants, pas restrictifs. Un role compromis quelconque disposant de
-- USAGE sur le schema (signet_auth, signet_owner — ADR-0007 : aucun des deux
-- ne devrait jamais toucher les tables tenant) pouvait appeler directement
-- signet.create_organization()/organizations_for_user() et agir avec les
-- privileges de signet_definer.
-- ============================================================================

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA signet FROM PUBLIC;

-- Regrants explicites, un par role reellement appelant (inchange par
-- rapport a 0001/0003 : ce bloc documente la politique complete au meme
-- endroit que la revocation, il ne retire aucun acces existant).
GRANT EXECUTE ON FUNCTION signet.uuidv7() TO signet_owner, signet_app, signet_auth, signet_definer;
GRANT EXECUTE ON FUNCTION signet.current_org() TO signet_app, signet_definer;
GRANT EXECUTE ON FUNCTION signet.current_user_id() TO signet_app, signet_definer;
GRANT EXECUTE ON FUNCTION signet.quota_for_tier(text) TO signet_definer;
GRANT EXECUTE ON FUNCTION signet.create_organization(uuid, text) TO signet_app;
GRANT EXECUTE ON FUNCTION signet.organizations_for_user(uuid) TO signet_app;
-- create_organization_counters(), propagate_subscription_quota() et
-- assert_owner_remains() ne sont jamais appelees directement : uniquement
-- par le mecanisme de trigger Postgres, qui n'exige aucun GRANT EXECUTE sur
-- le role a l'origine du DML declencheur. Aucun regrant necessaire pour ces
-- trois fonctions au-dela de la revocation ci-dessus.
