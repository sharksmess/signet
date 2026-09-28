CREATE TABLE "member" (
	"id" uuid PRIMARY KEY DEFAULT signet.uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_role_chk" CHECK ("member"."role" IN ('owner', 'member'))
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT signet.uuidv7() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_name_length_chk" CHECK (char_length(btrim("organization"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "organization_slug_format_chk" CHECK ("organization"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("organization"."slug") BETWEEN 2 AND 60)
);
--> statement-breakpoint
CREATE TABLE "organization_link_usage" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"link_count" integer DEFAULT 0 NOT NULL,
	"link_quota" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_link_usage_count_chk" CHECK ("organization_link_usage"."link_count" >= 0),
	CONSTRAINT "organization_link_usage_quota_chk" CHECK ("organization_link_usage"."link_quota" IS NULL OR "organization_link_usage"."link_quota" > 0)
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"tier" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_tier_chk" CHECK ("subscription"."tier" IN ('free', 'pro')),
	CONSTRAINT "subscription_status_chk" CHECK ("subscription"."status" IN ('active', 'past_due', 'canceled', 'incomplete')),
	CONSTRAINT "subscription_stripe_customer_length_chk" CHECK ("subscription"."stripe_customer_id" IS NULL OR char_length("subscription"."stripe_customer_id") <= 255),
	CONSTRAINT "subscription_pro_is_backed_chk" CHECK ("subscription"."tier" <> 'pro' OR "subscription"."stripe_subscription_id" IS NOT NULL),
	CONSTRAINT "subscription_free_has_no_period_chk" CHECK ("subscription"."tier" <> 'free' OR "subscription"."current_period_end" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_link_usage" ADD CONSTRAINT "organization_link_usage_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_org_user_idx" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "member_user_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_single_owner_idx" ON "member" USING btree ("organization_id") WHERE role = 'owner';--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_idx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_stripe_sub_idx" ON "subscription" USING btree ("stripe_subscription_id") WHERE stripe_subscription_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_stripe_customer_idx" ON "subscription" USING btree ("stripe_customer_id") WHERE stripe_customer_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_active_organization_id_organization_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;

-- ============================================================================
-- Section ecrite a la main — ERD §3, §4, §7, §8.1 : proprietaire, RLS,
-- fonctions SECURITY DEFINER (liste fermee, ERD §1) et triggers.
-- ============================================================================

ALTER TABLE "organization" OWNER TO signet_owner;
ALTER TABLE "member" OWNER TO signet_owner;
ALTER TABLE "organization_link_usage" OWNER TO signet_owner;
ALTER TABLE "subscription" OWNER TO signet_owner;

ALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization" FORCE ROW LEVEL SECURITY;
ALTER TABLE "member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "member" FORCE ROW LEVEL SECURITY;
ALTER TABLE "organization_link_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_link_usage" FORCE ROW LEVEL SECURITY;
ALTER TABLE "subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription" FORCE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- Politiques RLS (ERD §3, §4, §7, §8.1)
-- --------------------------------------------------------------------------

-- `organization` : l'INSERT direct (hors signet.create_organization(), qui
-- pose lui-meme SET LOCAL app.organization_id sur l'id qu'il vient de
-- generer, ADR-0007 Partie 2) est refuse par le WITH CHECK, puisqu'aucun
-- contexte tenant ne peut preexister a la creation (ERD §3). Politique
-- elargie a signet_definer (ADR-0007) : signet_definer n'a pas BYPASSRLS,
-- il herite du meme contexte SET LOCAL que signet_app pour la duree de
-- l'operation qu'il effectue.
CREATE POLICY "organization_isolation" ON "organization" TO signet_app, signet_definer
  USING (id = signet.current_org())
  WITH CHECK (id = signet.current_org());

CREATE POLICY "member_isolation" ON "member" TO signet_app, signet_definer
  USING (organization_id = signet.current_org())
  WITH CHECK (organization_id = signet.current_org());

-- Lecture seule pour signet_app (ERD §7) : l'ecriture est reservee aux
-- triggers signet_definer (compteur de quota, tranche 005 ; propagation du
-- palier, ci-dessous). Aucune politique INSERT/UPDATE n'est definie pour
-- signet_app, et les privileges correspondants sont explicitement revoques
-- plus bas.
CREATE POLICY "organization_link_usage_read_only" ON "organization_link_usage"
  FOR SELECT TO signet_app
  USING (organization_id = signet.current_org());

-- Ecriture reservee a signet_definer (ADR-0007), scopee comme pour
-- signet_app par l'organisation courante de la session (posee par
-- signet.create_organization avant l'INSERT qui declenche ces triggers).
CREATE POLICY "organization_link_usage_definer_write" ON "organization_link_usage"
  FOR ALL TO signet_definer
  USING (organization_id = signet.current_org())
  WITH CHECK (organization_id = signet.current_org());

-- Owner uniquement (ERD §8.1, US-08.2) : un member ne peut ni lire ni
-- modifier l'abonnement de sa propre organisation.
CREATE POLICY "subscription_owner_only" ON "subscription" TO signet_app
  USING (
    organization_id = signet.current_org()
    AND EXISTS (
      SELECT 1 FROM member m
       WHERE m.organization_id = signet.current_org()
         AND m.user_id = signet.current_user_id()
         AND m.role = 'owner'
    )
  )
  WITH CHECK (
    organization_id = signet.current_org()
    AND EXISTS (
      SELECT 1 FROM member m
       WHERE m.organization_id = signet.current_org()
         AND m.user_id = signet.current_user_id()
         AND m.role = 'owner'
    )
  );

-- Creation initiale par signet.create_organization_counters (ADR-0007) :
-- pas de verification du role owner ici (le membership owner n'existe pas
-- encore au moment de cet INSERT), seule l'organisation courante compte.
CREATE POLICY "subscription_definer_insert" ON "subscription"
  FOR INSERT TO signet_definer
  WITH CHECK (organization_id = signet.current_org());

-- Politique differee depuis la migration 0002 (ERD §2.1) : `member` existe
-- maintenant. Permet d'afficher l'auteur d'un lien (tranches futures) sans
-- exposer l'annuaire global des comptes.
CREATE POLICY "app_user_visible_to_co_members" ON "app_user"
  FOR SELECT TO signet_app
  USING (
    EXISTS (
      SELECT 1 FROM member m
       WHERE m.user_id = app_user.id
         AND m.organization_id = signet.current_org()
    )
  );

-- --------------------------------------------------------------------------
-- Politiques additionnelles pour signet_definer, scopees par
-- current_user_id() plutot que current_org() (ADR-0007 Partie 2,
-- ADR-0002 « seule exception documentee ») : signet.organizations_for_user()
-- doit voir TOUTES les organisations de l'utilisateur appelant a la fois,
-- ce qu'une politique bornee a une seule current_org() ne peut pas exprimer.
-- La fonction verifie deja p_user_id = current_user_id() avant tout SELECT :
-- le perimetre reste strictement celui de l'utilisateur authentifie courant.
-- --------------------------------------------------------------------------

CREATE POLICY "member_definer_self_read" ON "member"
  FOR SELECT TO signet_definer
  USING (user_id = signet.current_user_id());

CREATE POLICY "organization_definer_self_read" ON "organization"
  FOR SELECT TO signet_definer
  USING (
    EXISTS (
      SELECT 1 FROM member m
       WHERE m.organization_id = organization.id
         AND m.user_id = signet.current_user_id()
    )
  );

-- --------------------------------------------------------------------------
-- Grants de table (ERD §1, §7 : la RLS filtre les lignes, le GRANT autorise
-- l'operation elle-meme — les deux sont necessaires).
-- --------------------------------------------------------------------------

GRANT SELECT ON "app_user" TO signet_app;
GRANT SELECT, INSERT, UPDATE ON "organization" TO signet_app;
GRANT SELECT ON "member" TO signet_app;
GRANT SELECT ON "organization_link_usage" TO signet_app;
GRANT SELECT ON "subscription" TO signet_app;

-- Defensif et explicite (ERD §7) : signet_app ne doit jamais pouvoir ecrire
-- le compteur de quota ni l'abonnement autrement qu'au travers des fonctions
-- et triggers signet_definer ci-dessous.
REVOKE INSERT, UPDATE, DELETE ON "organization_link_usage" FROM signet_app;
REVOKE INSERT, UPDATE, DELETE ON "subscription" FROM signet_app;

GRANT SELECT, INSERT ON "organization" TO signet_definer;
GRANT SELECT, INSERT ON "member" TO signet_definer;
GRANT SELECT, INSERT, UPDATE ON "organization_link_usage" TO signet_definer;
GRANT SELECT, INSERT ON "subscription" TO signet_definer;

-- --------------------------------------------------------------------------
-- signet.quota_for_tier(text) — ERD §8.1 : "l'unique endroit ou la valeur 50
-- existe". IMMUTABLE, sans acces table : pas de SECURITY DEFINER necessaire.
-- --------------------------------------------------------------------------

CREATE FUNCTION signet.quota_for_tier(p_tier text) RETURNS integer
LANGUAGE sql IMMUTABLE AS
$$ SELECT CASE p_tier WHEN 'free' THEN 50 WHEN 'pro' THEN NULL::integer END $$;

COMMENT ON FUNCTION signet.quota_for_tier(text) IS
  'free -> 50, pro -> illimite (NULL). ERD §8.1 : seul endroit ou la valeur 50 existe.';

GRANT EXECUTE ON FUNCTION signet.quota_for_tier(text) TO signet_definer;

-- --------------------------------------------------------------------------
-- signet.create_organization(owner_user_id, org_name) — ERD §1, point
-- d'entree SECURITY DEFINER (liste fermee). Cree l'organisation (slug derive
-- server-side, collision resolue par un suffixe numerique deterministe et
-- retry sur violation d'unicite concurrente, AC3a/AC3b) puis le membership
-- owner, dans la meme transaction. Le trigger AFTER INSERT sur `organization`
-- (ci-dessous) instancie `organization_link_usage` et `subscription`.
--
-- ADR-0007 (Partie 2, signet_definer sans BYPASSRLS) : l'id de la nouvelle
-- organisation est genere explicitement AVANT le premier INSERT (au lieu de
-- laisser jouer le DEFAULT signet.uuidv7() de la colonne), pour pouvoir
-- poser SET LOCAL app.organization_id dessus des le debut de la fonction.
-- Tout le reste de la transaction (cet INSERT, celui de `member`, et les
-- triggers create_organization_counters/propagate_subscription_quota qu'il
-- declenche) s'execute donc sous le meme contexte tenant que signet_app,
-- couvert par les politiques organization_isolation/member_isolation/
-- organization_link_usage_definer_write/subscription_definer_insert
-- elargies a signet_definer.
-- --------------------------------------------------------------------------

CREATE FUNCTION signet.create_organization(p_owner_user_id uuid, p_org_name text)
RETURNS organization
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, signet, public
AS $$
DECLARE
  v_org_id    uuid := signet.uuidv7();
  v_base_slug text;
  v_slug      text;
  v_org       organization;
  v_attempt   int := 0;
BEGIN
  IF p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'create_organization: owner_user_id is required';
  END IF;
  IF btrim(coalesce(p_org_name, '')) = '' THEN
    RAISE EXCEPTION 'create_organization: org_name is required';
  END IF;

  -- Pose le contexte tenant sur l'organisation qui va etre creee, avant tout
  -- INSERT (ADR-0007) : signet_definer n'a pas BYPASSRLS, les politiques RLS
  -- de organization/member/organization_link_usage/subscription doivent
  -- pouvoir evaluer organization_id = current_org() des cette ligne.
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

    -- Le BEGIN/EXCEPTION imbrique cree une sous-transaction implicite
    -- (savepoint) : une violation d'unicite concurrente (AC3b) est
    -- absorbee ici et retentee avec le suffixe suivant, sans jamais
    -- faire echouer ni la fonction ni la requete HTTP appelante (AC3a :
    -- "jamais lever une 500"). v_org_id reste fixe d'une tentative a
    -- l'autre : seul le slug change.
    BEGIN
      INSERT INTO organization (id, name, slug)
      VALUES (v_org_id, btrim(p_org_name), v_slug)
      RETURNING * INTO v_org;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 50 THEN
        RAISE;
      END IF;
    END;
  END LOOP;

  INSERT INTO member (organization_id, user_id, role)
  VALUES (v_org.id, p_owner_user_id, 'owner');

  RETURN v_org;
END;
$$;

-- --------------------------------------------------------------------------
-- signet.organizations_for_user(user_id) — ERD §1, point d'entree SECURITY
-- DEFINER (liste fermee). Force user_id = current_user_id() (ADR-0002).
-- --------------------------------------------------------------------------

CREATE FUNCTION signet.organizations_for_user(p_user_id uuid)
RETURNS SETOF organization
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, signet, public
AS $$
BEGIN
  IF p_user_id IS NULL OR p_user_id <> signet.current_user_id() THEN
    RAISE EXCEPTION 'organizations_for_user: caller may only list their own organizations';
  END IF;

  RETURN QUERY
    SELECT o.*
      FROM organization o
      JOIN member m ON m.organization_id = o.id
     WHERE m.user_id = p_user_id;
END;
$$;

-- --------------------------------------------------------------------------
-- signet.create_organization_counters() — trigger AFTER INSERT ON
-- organization (ERD §3) : instancie organization_link_usage et subscription
-- dans la meme transaction, invariant garanti par la base.
-- --------------------------------------------------------------------------

CREATE FUNCTION signet.create_organization_counters() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, signet, public
AS $$
BEGIN
  INSERT INTO organization_link_usage (organization_id, link_count, link_quota)
  VALUES (NEW.id, 0, NULL);

  INSERT INTO subscription (organization_id, tier, status)
  VALUES (NEW.id, 'free', 'active');

  RETURN NULL;
END;
$$;

-- --------------------------------------------------------------------------
-- signet.propagate_subscription_quota() — trigger AFTER INSERT OR UPDATE OF
-- tier ON subscription (ERD §8.1). Fixe link_quota via quota_for_tier() :
-- palier et plafond ne peuvent jamais diverger. Ecriture inconditionnelle
-- (ERD §8.1 : retrogradation Pro -> Free toujours acceptee).
-- --------------------------------------------------------------------------

CREATE FUNCTION signet.propagate_subscription_quota() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, signet, public
AS $$
BEGIN
  UPDATE organization_link_usage
     SET link_quota = signet.quota_for_tier(NEW.tier), updated_at = now()
   WHERE organization_id = NEW.organization_id;

  RETURN NULL;
END;
$$;

-- --------------------------------------------------------------------------
-- signet.assert_owner_remains() — fonction du constraint trigger
-- member_keep_last_owner (ERD §4). Ne leve que si l'organisation existe
-- encore ET qu'aucun owner n'y subsiste (cascade de suppression
-- d'organisation exclue, cf. ERD).
-- --------------------------------------------------------------------------

CREATE FUNCTION signet.assert_owner_remains() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, signet, public
AS $$
DECLARE
  v_org_exists   boolean;
  v_owner_exists boolean;
BEGIN
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

-- --------------------------------------------------------------------------
-- Propriete des fonctions SECURITY DEFINER (ERD §1 : role signet_definer,
-- NOLOGIN, BYPASSRLS) et grants d'execution.
-- --------------------------------------------------------------------------

ALTER FUNCTION signet.create_organization(uuid, text) OWNER TO signet_definer;
ALTER FUNCTION signet.organizations_for_user(uuid) OWNER TO signet_definer;
ALTER FUNCTION signet.create_organization_counters() OWNER TO signet_definer;
ALTER FUNCTION signet.propagate_subscription_quota() OWNER TO signet_definer;
ALTER FUNCTION signet.assert_owner_remains() OWNER TO signet_definer;

GRANT EXECUTE ON FUNCTION signet.create_organization(uuid, text) TO signet_app;
GRANT EXECUTE ON FUNCTION signet.organizations_for_user(uuid) TO signet_app;

-- --------------------------------------------------------------------------
-- Triggers
-- --------------------------------------------------------------------------

CREATE TRIGGER organization_after_insert_create_counters
AFTER INSERT ON organization
FOR EACH ROW EXECUTE FUNCTION signet.create_organization_counters();

CREATE TRIGGER subscription_after_insert_or_tier_update_propagate_quota
AFTER INSERT OR UPDATE OF tier ON subscription
FOR EACH ROW EXECUTE FUNCTION signet.propagate_subscription_quota();

-- Constraint trigger, deferrable (ERD §4) : lors d'un DELETE d'organisation,
-- la cascade supprime tous les `member` avant que ce trigger ne s'execute ;
-- differe a la fin de la transaction pour que assert_owner_remains() puisse
-- constater que l'organisation elle-meme n'existe plus et laisser passer.
CREATE CONSTRAINT TRIGGER member_keep_last_owner
AFTER DELETE ON member
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION signet.assert_owner_remains();