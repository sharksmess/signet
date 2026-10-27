CREATE TABLE "link" (
	"id" uuid PRIMARY KEY DEFAULT signet.uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"collection_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"added_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "link_url_scheme_chk" CHECK ("link"."url" ~ '^https?://[^[:space:]]+$'),
	CONSTRAINT "link_url_length_chk" CHECK (char_length("link"."url") BETWEEN 8 AND 2048),
	CONSTRAINT "link_title_length_chk" CHECK (char_length(btrim("link"."title")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "link" ADD CONSTRAINT "link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link" ADD CONSTRAINT "link_added_by_user_id_app_user_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link" ADD CONSTRAINT "link_collection_fk" FOREIGN KEY ("collection_id","organization_id") REFERENCES "public"."collection"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "link_collection_recent_idx" ON "link" USING btree ("collection_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "link_org_idx" ON "link" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "link_author_idx" ON "link" USING btree ("added_by_user_id");

-- ============================================================================
-- Section ecrite a la main — ERD §6.2 et §7 ; tranche 005 : proprietaire, RLS
-- (activee et forcee), politique unique TO signet_app, privileges, fonction et
-- trigger de compteur de quota (ADR-0002 option D, branche INSERT seulement).
-- Une seule migration (ERD "Ordre des migrations") : la table n'existe jamais
-- sans sa RLS ni sans son compteur.
--
-- Hors perimetre : branche AFTER DELETE du trigger, GRANT DELETE et
-- signet.recompute_link_usage() (tranche 007, D-122) ; aucune politique
-- signet_definer sur link (la fonction ecrit le compteur, pas link).
-- ============================================================================

ALTER TABLE "link" OWNER TO signet_owner;
ALTER TABLE "link" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "link" FORCE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- Privileges
-- --------------------------------------------------------------------------
-- signet_app : lecture (RETURNING de l'ajout, liste 009) et ajout. Ni UPDATE
-- (aucune edition de lien dans le PRD), ni DELETE (007, avec la branche DELETE
-- du trigger), ni TRUNCATE (un TRUNCATE ne declenche pas les triggers de
-- ligne et desalignerait le compteur). Les autres roles applicatifs
-- (signet_auth, signet_billing, signet_definer) n'ont rien.
GRANT SELECT, INSERT ON "link" TO signet_app;

-- --------------------------------------------------------------------------
-- Politique RLS (TO signet_app seulement) — ERD §6.2, matrice d'isolation.
-- current_org() verifie deja que l'utilisateur de session est membre de
-- l'organisation du contexte (ADR-0011). Sans app.user_id, ou sous un
-- contexte etranger, current_org() est NULL : aucune ligne visible, toute
-- insertion refusee (42501). Zero jointure.
-- --------------------------------------------------------------------------
CREATE POLICY "link_isolation" ON "link"
  FOR ALL TO signet_app
  USING (organization_id = signet.current_org())
  WITH CHECK (organization_id = signet.current_org());

-- --------------------------------------------------------------------------
-- signet.link_usage_on_insert() — trigger AFTER INSERT FOR EACH ROW sur link
-- (ADR-0002 option D, ERD §7). Liste obligatoire rules/drizzle-postgres.md :
--  1. search_path fige, pg_temp en dernier ; tables qualifiees public. ;
--  2. proprietaire signet_definer (NOLOGIN NOBYPASSRLS) ;
--  3. premiere instruction : contexte pose depuis NEW.organization_id. Valeur
--     de confiance : sous signet_app, la ligne a deja passe le WITH CHECK de
--     link_isolation, donc NEW.organization_id = current_org() (patron
--     propagate_subscription_quota, ADR-0011, D-033). La colonne est NOT NULL
--     (verifie avant tout trigger AFTER) ; un NULL ferait de toute facon
--     toucher zero ligne, donc lever ci-dessous ;
--  4. ROW_COUNT verifie : zero ligne de compteur = invariant rompu (P0001),
--     jamais absorbe ;
--  5. REVOKE ALL FROM PUBLIC, aucun GRANT EXECUTE (appelee par le seul
--     mecanisme de trigger).
--
-- Atomicite : l'UPDATE prend le verrou exclusif de LA ligne de compteur de
-- l'organisation ; un ajout concurrent de la meme organisation attend le
-- COMMIT ou le ROLLBACK, puis, en READ COMMITTED, re-evalue la derniere
-- version validee et calcule link_count + 1 sur elle. Aucune lecture
-- prealable du compte. Le refus (SG001) annule l'instruction INSERT entiere,
-- increment compris. Messages sans identifiant client.
-- --------------------------------------------------------------------------
CREATE FUNCTION signet.link_usage_on_insert() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, signet, public, pg_temp
AS $$
DECLARE
  v_count   integer;
  v_quota   integer;
  v_updated integer;
BEGIN
  PERFORM set_config('app.organization_id', NEW.organization_id::text, true);

  UPDATE public.organization_link_usage
     SET link_count = link_count + 1, updated_at = now()
   WHERE organization_id = NEW.organization_id
  RETURNING link_count, link_quota INTO v_count, v_quota;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'link_usage_on_insert: link usage counter row missing for the organization of the inserted link (expected exactly 1 row updated, got %)',
      v_updated;
  END IF;

  IF v_quota IS NOT NULL AND v_count > v_quota THEN
    RAISE EXCEPTION 'free tier link quota exceeded'
      USING ERRCODE = 'SG001';
  END IF;

  RETURN NULL;
END;
$$;

ALTER FUNCTION signet.link_usage_on_insert() OWNER TO signet_definer;
REVOKE ALL ON FUNCTION signet.link_usage_on_insert() FROM PUBLIC;

COMMENT ON FUNCTION signet.link_usage_on_insert() IS
  'Trigger AFTER INSERT sur link (ADR-0002, ERD §7) : incremente le compteur de NEW.organization_id sous verrou de ligne ; P0001 si le compteur manque ; SG001 si link_quota IS NOT NULL AND link_count > link_quota. Branche DELETE : tranche 007.';

CREATE TRIGGER "link_usage_on_insert"
  AFTER INSERT ON "link"
  FOR EACH ROW EXECUTE FUNCTION signet.link_usage_on_insert();
