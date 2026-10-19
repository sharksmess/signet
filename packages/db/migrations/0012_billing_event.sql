CREATE TABLE "billing_event" (
	"id" uuid PRIMARY KEY DEFAULT signet.uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_tier" text,
	"to_tier" text,
	"actor_user_id" uuid,
	"stripe_event_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_event_type_chk" CHECK ("billing_event"."type" IN ('subscription_started', 'tier_changed', 'subscription_canceled')),
	CONSTRAINT "billing_event_from_tier_chk" CHECK ("billing_event"."from_tier" IS NULL OR "billing_event"."from_tier" IN ('free', 'pro')),
	CONSTRAINT "billing_event_to_tier_chk" CHECK ("billing_event"."to_tier" IS NULL OR "billing_event"."to_tier" IN ('free', 'pro')),
	CONSTRAINT "billing_event_stripe_event_length_chk" CHECK ("billing_event"."stripe_event_id" IS NULL OR char_length("billing_event"."stripe_event_id") <= 255),
	CONSTRAINT "billing_event_shape" CHECK (("billing_event"."type" = 'subscription_started' AND "billing_event"."from_tier" IS NULL AND "billing_event"."to_tier" IS NOT NULL)
       OR ("billing_event"."type" = 'tier_changed' AND "billing_event"."from_tier" IS NOT NULL AND "billing_event"."to_tier" IS NOT NULL
           AND "billing_event"."from_tier" <> "billing_event"."to_tier")
       OR ("billing_event"."type" = 'subscription_canceled' AND "billing_event"."from_tier" IS NOT NULL AND "billing_event"."to_tier" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "billing_event" ADD CONSTRAINT "billing_event_actor_user_id_app_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_event_org_time_idx" ON "billing_event" USING btree ("organization_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "billing_event_stripe_idx" ON "billing_event" USING btree ("stripe_event_id") WHERE stripe_event_id IS NOT NULL;

-- ============================================================================
-- Section ecrite a la main — ERD §8.1, §8.2 ; ADR-0016 : proprietaire, RLS,
-- immutabilite de billing_event, fonction SECURITY DEFINER d'application
-- d'etat Stripe executee par le seul role signet_billing (Q-1, D-057).
-- ============================================================================

ALTER TABLE "billing_event" OWNER TO signet_owner;
ALTER TABLE "billing_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_event" FORCE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- Privileges
-- --------------------------------------------------------------------------
-- signet_app lit seulement (owner, par la politique ci-dessous). Le REVOKE
-- explicite ferme le chemin applicatif d'ecriture (ERD §8.2) : seule la
-- fonction d'application d'etat ecrit le journal.
GRANT SELECT ON "billing_event" TO signet_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "billing_event" FROM signet_app;

-- signet_definer : INSERT dans le journal, UPDATE de subscription (jusqu'ici
-- SELECT, INSERT seulement, 0003). Rien d'autre.
GRANT INSERT ON "billing_event" TO signet_definer;
GRANT UPDATE ON "subscription" TO signet_definer;

-- signet_billing doit resoudre le nom qualifie de la fonction : USAGE sur le
-- schema signet, jamais CREATE. Aucun privilege de table (ERD §1, AC6 b).
GRANT USAGE ON SCHEMA signet TO signet_billing;

-- --------------------------------------------------------------------------
-- Politiques RLS
-- --------------------------------------------------------------------------

-- billing_event, lecture : owner uniquement, meme texte que
-- subscription_owner_only (ERD §8.2). Aucune route ne la lit en 002.
CREATE POLICY "billing_event_owner_read" ON "billing_event"
  FOR SELECT TO signet_app
  USING (
    organization_id = signet.current_org()
    AND EXISTS (
      SELECT 1 FROM member m
       WHERE m.organization_id = signet.current_org()
         AND m.user_id = signet.current_user_id()
         AND m.role = 'owner'
    )
  );

-- billing_event, ecriture : la fonction d'application d'etat, sur le contexte
-- qu'elle a pose elle-meme depuis une valeur de confiance (ADR-0011 R1 :
-- context_org(), jamais current_org(), dans une politique signet_definer).
CREATE POLICY "billing_event_definer_insert" ON "billing_event"
  FOR INSERT TO signet_definer
  WITH CHECK (organization_id = signet.context_org());

-- subscription, lecture et mise a jour par la fonction d'application d'etat,
-- sur le contexte qu'elle a pose. SELECT ... FOR UPDATE exige les deux.
CREATE POLICY "subscription_definer_read" ON "subscription"
  FOR SELECT TO signet_definer
  USING (organization_id = signet.context_org());

CREATE POLICY "subscription_definer_update" ON "subscription"
  FOR UPDATE TO signet_definer
  USING (organization_id = signet.context_org())
  WITH CHECK (organization_id = signet.context_org());

-- subscription, recherche par identifiant d'abonnement Stripe (ADR-0016) : un
-- evenement arrive avec un identifiant Stripe et aucune organisation. La
-- fonction pose app.stripe_subscription_id depuis son entree, lit la ligne (au
-- plus une : index unique partiel subscription_stripe_sub_idx), puis remet le
-- reglage a vide avant toute ecriture. Lecture seule ; une valeur vide ou
-- absente ne designe aucune ligne.
CREATE POLICY "subscription_definer_stripe_lookup" ON "subscription"
  FOR SELECT TO signet_definer
  USING (stripe_subscription_id = nullif(current_setting('app.stripe_subscription_id', true), ''));

-- --------------------------------------------------------------------------
-- Immutabilite de billing_event (ERD §8.2)
-- --------------------------------------------------------------------------
-- Le REVOKE ferme le chemin applicatif ; ces triggers ferment celui du
-- proprietaire, des migrations et du superutilisateur.
--
-- Seule exception : l'action referentielle ON DELETE SET NULL de
-- actor_user_id (ERD §8.2 : la suppression d'un compte ne doit ni effacer ni
-- bloquer une ligne d'audit). Reconnue a deux conditions cumulees : la mise a
-- jour est declenchee depuis un autre trigger (pg_trigger_depth() > 1 ; une
-- UPDATE directe s'execute a la profondeur 1, l'action referentielle est
-- elle-meme un trigger systeme), et elle ne change rien d'autre que
-- actor_user_id, passe d'une valeur a NULL.
CREATE FUNCTION signet.reject_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, signet, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND pg_trigger_depth() > 1
     AND OLD.actor_user_id IS NOT NULL
     AND NEW.actor_user_id IS NULL
     AND (to_jsonb(NEW) - 'actor_user_id') = (to_jsonb(OLD) - 'actor_user_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% refuse sur %: table append-only (ERD §8.2)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'SG007';
END;
$$;

REVOKE ALL ON FUNCTION signet.reject_mutation() FROM PUBLIC;

COMMENT ON FUNCTION signet.reject_mutation() IS
  'Trigger BEFORE UPDATE OR DELETE des tables append-only (billing_event). Leve SG007, sauf l''action referentielle ON DELETE SET NULL de actor_user_id (ERD §8.2).';

CREATE TRIGGER "billing_event_immutable"
  BEFORE UPDATE OR DELETE ON "billing_event"
  FOR EACH ROW EXECUTE FUNCTION signet.reject_mutation();

-- TRUNCATE n'est pas couvert (ERD §8.2 : UPDATE et DELETE). signet_app n'a
-- pas le privilege (REVOKE ci-dessus) ; seuls le proprietaire et le
-- superutilisateur le peuvent, et la remise a zero de la base de test en a
-- besoin (TRUNCATE app_user ... CASCADE atteint billing_event par la cle
-- etrangere actor_user_id). Limite acceptee, ADR-0016.

-- --------------------------------------------------------------------------
-- signet.apply_stripe_subscription(jsonb) — ADR-0016, ERD §1 (liste fermee)
-- --------------------------------------------------------------------------
-- Applique a subscription l'etat d'un abonnement Stripe RELU aupres de l'API
-- par la fonction Inngest (Q-2 : l'evenement n'est qu'un declencheur et une
-- cle d'idempotence), et ecrit l'evenement facturable s'il y a changement de
-- palier (Q-5). Seule a ecrire subscription et billing_event en dehors de
-- create_organization. EXECUTE accorde au seul role signet_billing.
--
-- Entree : UN objet jsonb (D-067), valide champ par champ AVANT toute lecture
-- et toute ecriture (presence, type, longueur, format) ; tout champ inconnu
-- est refuse. Une entree invalide leve SG003.
--
-- Source de l'organisation (valeur de confiance, AC6) :
--   1. la ligne subscription deja rattachee a stripe_subscription_id ;
--   2. a defaut (premier rattachement), metadata_organization_id, lue par la
--      fonction Inngest sur l'abonnement relu chez Stripe avec la cle secrete,
--      posee par notre serveur au Checkout apres controle du role owner.
-- Le contexte ambiant (app.organization_id, app.user_id poses par
-- l'appelant) est efface ou ignore : jamais lu.
--
-- Codes (D-067, ERD §0) : SG003 entree invalide ; SG004 abonnement deja
-- rattache a une autre organisation que celle de sa metadonnee ; SG005
-- organisation non resolue (metadonnee absente, mal formee, organisation
-- inexistante) ; SG006 incoherence Stripe (Q-7 : autre abonnement deja
-- rattache, client different, prix qui n'est pas le prix Pro, identifiant
-- Stripe deja rattache ailleurs). Tous annulent la transaction.
--
-- Concurrence : la ligne subscription de l'organisation est verrouillee
-- (FOR UPDATE) avant toute decision ; deux traitements de la meme organisation
-- s'executent l'un apres l'autre, le second voit l'etat ecrit par le premier
-- (AC8 c). L'index unique billing_event_stripe_idx absorbe le rejeu d'un meme
-- evenement Stripe.
CREATE FUNCTION signet.apply_stripe_subscription(p_input jsonb) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, signet, public, pg_temp
AS $$
DECLARE
  c_text_fields     constant text[] := ARRAY['stripe_event_id', 'occurred_at', 'event_type',
                                             'stripe_subscription_id', 'stripe_customer_id', 'stripe_status'];
  c_bool_fields     constant text[] := ARRAY['is_pro_price', 'cancel_at_period_end'];
  c_nullable_fields constant text[] := ARRAY['current_period_end', 'metadata_organization_id',
                                             'metadata_requested_by'];
  c_uuid_pattern    constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  c_iso_pattern     constant text := '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$';
  v_key             text;
  v_event_id        text;
  v_event_type      text;
  v_subscription_id text;
  v_customer_id     text;
  v_stripe_status   text;
  v_is_pro_price    boolean;
  v_cancel          boolean;
  v_occurred_at     timestamptz;
  v_period_end      timestamptz;
  v_metadata_org    text;
  v_metadata_by     text;
  v_actor           uuid;
  v_org             uuid;
  v_current         public.subscription%ROWTYPE;
  v_new_tier        text;
  v_new_status      text;
  v_new_sub_id      text;
  v_new_period_end  timestamptz;
  v_new_cancel      boolean;
  v_updated         integer;
  v_outcome         text;
BEGIN
  -- 0. Contexte ambiant efface : rien de ce que l'appelant a pose n'est lu.
  PERFORM set_config('app.organization_id', '', true);
  PERFORM set_config('app.stripe_subscription_id', '', true);

  -- 1. Validation de l'entree, champ par champ, avant toute lecture (D-067).
  IF p_input IS NULL OR jsonb_typeof(p_input) <> 'object' THEN
    RAISE EXCEPTION 'apply_stripe_subscription: entree absente ou qui n''est pas un objet JSON'
      USING ERRCODE = 'SG003';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_input) LOOP
    IF NOT (v_key = ANY (c_text_fields || c_bool_fields || c_nullable_fields)) THEN
      RAISE EXCEPTION 'apply_stripe_subscription: champ inconnu %', left(v_key, 64)
        USING ERRCODE = 'SG003';
    END IF;
  END LOOP;

  FOREACH v_key IN ARRAY c_text_fields LOOP
    IF jsonb_typeof(p_input -> v_key) IS DISTINCT FROM 'string'
       OR char_length(p_input ->> v_key) NOT BETWEEN 1 AND 255 THEN
      RAISE EXCEPTION 'apply_stripe_subscription: champ % absent, vide, trop long ou qui n''est pas un texte', v_key
        USING ERRCODE = 'SG003';
    END IF;
  END LOOP;

  FOREACH v_key IN ARRAY c_bool_fields LOOP
    IF jsonb_typeof(p_input -> v_key) IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'apply_stripe_subscription: champ % absent ou qui n''est pas un booleen', v_key
        USING ERRCODE = 'SG003';
    END IF;
  END LOOP;

  FOREACH v_key IN ARRAY c_nullable_fields LOOP
    IF NOT (p_input ? v_key)
       OR jsonb_typeof(p_input -> v_key) NOT IN ('string', 'null')
       OR char_length(p_input ->> v_key) > 255 THEN
      RAISE EXCEPTION 'apply_stripe_subscription: champ % absent, trop long, ou ni texte ni null', v_key
        USING ERRCODE = 'SG003';
    END IF;
  END LOOP;

  v_event_id        := p_input ->> 'stripe_event_id';
  v_event_type      := p_input ->> 'event_type';
  v_subscription_id := p_input ->> 'stripe_subscription_id';
  v_customer_id     := p_input ->> 'stripe_customer_id';
  v_stripe_status   := p_input ->> 'stripe_status';
  v_is_pro_price    := (p_input -> 'is_pro_price')::boolean;
  v_cancel          := (p_input -> 'cancel_at_period_end')::boolean;
  v_metadata_org    := p_input ->> 'metadata_organization_id';
  v_metadata_by     := p_input ->> 'metadata_requested_by';

  IF v_event_type NOT IN ('customer.subscription.created', 'customer.subscription.updated',
                          'customer.subscription.deleted') THEN
    RAISE EXCEPTION 'apply_stripe_subscription: event_type non traite' USING ERRCODE = 'SG003';
  END IF;

  IF v_stripe_status NOT IN ('active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete',
                             'incomplete_expired', 'canceled') THEN
    RAISE EXCEPTION 'apply_stripe_subscription: stripe_status inconnu' USING ERRCODE = 'SG003';
  END IF;

  -- Dates : ISO 8601 complet exige (refuse 'now', 'infinity', 'epoch', que le
  -- cast de Postgres accepterait).
  IF (p_input ->> 'occurred_at') !~ c_iso_pattern
     OR (p_input ->> 'current_period_end') !~ c_iso_pattern THEN
    RAISE EXCEPTION 'apply_stripe_subscription: date qui n''est pas au format ISO 8601' USING ERRCODE = 'SG003';
  END IF;
  BEGIN
    v_occurred_at := (p_input ->> 'occurred_at')::timestamptz;
    v_period_end  := (p_input ->> 'current_period_end')::timestamptz;
  EXCEPTION
    WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'apply_stripe_subscription: date hors calendrier' USING ERRCODE = 'SG003';
  END;

  -- requested_by : valeur d'audit, jamais d'autorisation. Non UUID -> NULL
  -- (AC3 e) ; UUID sans utilisateur -> NULL a l'insertion (cle etrangere).
  IF v_metadata_by ~ c_uuid_pattern THEN
    v_actor := v_metadata_by::uuid;
  END IF;

  -- 2. Organisation, depuis une valeur de confiance.
  PERFORM set_config('app.stripe_subscription_id', v_subscription_id, true);
  SELECT s.organization_id INTO v_org
    FROM public.subscription s
   WHERE s.stripe_subscription_id = v_subscription_id;
  PERFORM set_config('app.stripe_subscription_id', '', true);

  IF v_org IS NOT NULL THEN
    -- Abonnement deja rattache : la ligne en base fait foi. Une metadonnee qui
    -- designe une autre organisation est une contradiction, pas un ordre.
    IF v_metadata_org IS NOT NULL AND v_metadata_org IS DISTINCT FROM v_org::text THEN
      RAISE EXCEPTION 'apply_stripe_subscription: abonnement deja rattache a une autre organisation que sa metadonnee'
        USING ERRCODE = 'SG004';
    END IF;
  ELSE
    IF v_metadata_org IS NULL OR v_metadata_org !~ c_uuid_pattern THEN
      RAISE EXCEPTION 'apply_stripe_subscription: abonnement inconnu sans metadonnee d''organisation valide'
        USING ERRCODE = 'SG005';
    END IF;
    v_org := v_metadata_org::uuid;
  END IF;

  PERFORM set_config('app.organization_id', v_org::text, true);

  SELECT * INTO v_current
    FROM public.subscription s
   WHERE s.organization_id = signet.context_org()
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_stripe_subscription: organisation inexistante' USING ERRCODE = 'SG005';
  END IF;

  -- 3. Coherence avec ce qui est deja rattache (Q-7) : aucune ecriture.
  IF v_current.stripe_subscription_id IS NOT NULL AND v_current.stripe_subscription_id <> v_subscription_id THEN
    RAISE EXCEPTION 'apply_stripe_subscription: un autre abonnement Stripe est deja rattache a l''organisation'
      USING ERRCODE = 'SG006';
  END IF;
  IF v_current.stripe_customer_id IS NOT NULL AND v_current.stripe_customer_id <> v_customer_id THEN
    RAISE EXCEPTION 'apply_stripe_subscription: client Stripe different de celui enregistre'
      USING ERRCODE = 'SG006';
  END IF;
  IF NOT v_is_pro_price THEN
    RAISE EXCEPTION 'apply_stripe_subscription: le prix de l''abonnement n''est pas le prix Pro'
      USING ERRCODE = 'SG006';
  END IF;

  -- 4. Correspondance des statuts (Q-8).
  IF v_event_type = 'customer.subscription.deleted' OR v_stripe_status IN ('canceled', 'incomplete_expired') THEN
    v_new_tier := 'free';
    v_new_status := 'active';
  ELSIF v_stripe_status IN ('active', 'trialing') THEN
    v_new_tier := 'pro';
    v_new_status := 'active';
  ELSIF v_stripe_status IN ('past_due', 'unpaid', 'paused') THEN
    v_new_tier := 'pro';
    v_new_status := 'past_due';
  ELSE -- incomplete : palier inchange
    v_new_tier := v_current.tier;
    v_new_status := 'incomplete';
  END IF;

  IF v_new_tier = 'free' AND v_new_status = 'active' THEN
    -- Plus aucun abonnement en face ; le client Stripe est conserve (D-062).
    v_new_sub_id := NULL;
    v_new_period_end := NULL;
    v_new_cancel := false;
  ELSE
    v_new_sub_id := v_subscription_id;
    v_new_period_end := CASE WHEN v_new_tier = 'pro' THEN v_period_end END;
    v_new_cancel := v_cancel;
  END IF;

  -- 5. Ecriture de l'etat.
  BEGIN
    UPDATE public.subscription s
       SET tier = v_new_tier,
           status = v_new_status,
           stripe_customer_id = coalesce(v_current.stripe_customer_id, v_customer_id),
           stripe_subscription_id = v_new_sub_id,
           current_period_end = v_new_period_end,
           cancel_at_period_end = v_new_cancel,
           updated_at = now()
     WHERE s.organization_id = signet.context_org();
    GET DIAGNOSTICS v_updated = ROW_COUNT;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'apply_stripe_subscription: identifiant Stripe deja rattache a une autre organisation'
        USING ERRCODE = 'SG006';
  END;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'apply_stripe_subscription: % ligne(s) subscription mise(s) a jour, 1 attendue', v_updated;
  END IF;

  -- 6. Evenement facturable sur changement de palier seulement (Q-5).
  v_outcome := 'updated';
  IF v_current.tier = 'free' AND v_new_tier = 'pro' THEN
    v_outcome := 'subscription_started';
  ELSIF v_current.tier = 'pro' AND v_new_tier = 'free' THEN
    v_outcome := 'subscription_canceled';
  END IF;

  IF v_outcome <> 'updated' THEN
    BEGIN
      BEGIN
        INSERT INTO public.billing_event
          (organization_id, type, from_tier, to_tier, actor_user_id, stripe_event_id, occurred_at)
        VALUES
          (signet.context_org(), v_outcome,
           CASE WHEN v_outcome = 'subscription_canceled' THEN 'pro' END,
           CASE WHEN v_outcome = 'subscription_started' THEN 'pro' END,
           v_actor, v_event_id, v_occurred_at);
      EXCEPTION
        WHEN foreign_key_violation THEN
          -- Auteur disparu (A4) : l'evenement reste, son acteur devient inconnu.
          INSERT INTO public.billing_event
            (organization_id, type, from_tier, to_tier, actor_user_id, stripe_event_id, occurred_at)
          VALUES
            (signet.context_org(), v_outcome,
             CASE WHEN v_outcome = 'subscription_canceled' THEN 'pro' END,
             CASE WHEN v_outcome = 'subscription_started' THEN 'pro' END,
             NULL, v_event_id, v_occurred_at);
      END;
    EXCEPTION
      WHEN unique_violation THEN
        -- Meme evenement Stripe deja journalise (rejeu) : idempotent.
        NULL;
    END;
  END IF;

  RETURN v_outcome;
END;
$$;

ALTER FUNCTION signet.apply_stripe_subscription(jsonb) OWNER TO signet_definer;
REVOKE ALL ON FUNCTION signet.apply_stripe_subscription(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION signet.apply_stripe_subscription(jsonb) TO signet_billing;

COMMENT ON FUNCTION signet.apply_stripe_subscription(jsonb) IS
  'Seul chemin d''ecriture de subscription (hors create_organization) et de billing_event (ADR-0016). Entree jsonb validee champ par champ (SG003) ; organisation derivee de la ligne deja rattachee ou de la metadonnee relue chez Stripe (SG004, SG005) ; incoherences Stripe SG006. EXECUTE : signet_billing seul.';