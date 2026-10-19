ALTER TABLE "subscription" ADD COLUMN "stripe_synced_at" timestamp with time zone;

-- ============================================================================
-- Section ecrite a la main — corrections des relectures de la tranche 002
-- (D-071, ADR-0016). 0012 n'est pas modifiee (regle : jamais de modification
-- d'une migration deja appliquee) : la fonction est remplacee ici.
--
-- 1. Garde monotone (review-002 BLOQUANT 1) : `stripe_read_at` (instant de la
--    relecture Stripe, transmis par la fonction Inngest) est compare a
--    `subscription.stripe_synced_at` (colonne ci-dessus) ; un etat relu plus
--    ancien que le dernier applique est ignore (resultat `stale`), sans
--    ecriture ni evenement facturable. Une marque de plus de 5 minutes dans le
--    futur leve SG008, refus rejouable (D-072, D-076). Limites de la garde :
--    voir l'etape 3 du corps.
-- 2. Comparaison de la metadonnee d'organisation en `uuid`, jamais en texte
--    (audit-002 CRITIQUE-1 : un UUID en majuscules levait SG004 a chaque
--    evenement suivant, et l'abonnement ne pouvait plus etre retrograde).
-- 3. Passage en Free decide par le statut RELU seulement (`canceled`,
--    `incomplete_expired`), plus par le type `deleted` (Q-2 ; audit-002
--    INFO-2, review-002 point 3).
-- 4. Ordre reel des operations (review-002 point 10) : l'organisation est
--    resolue (lecture sans verrou), puis sa ligne `subscription` est
--    verrouillee avant toute decision sur l'etat.
-- L'auteur d'une annulation (`canceled_by`, review-002 BLOQUANT 2) est choisi
-- par la fonction Inngest et transmis dans `metadata_requested_by` : la
-- fonction SQL n'en change pas.
-- ============================================================================

CREATE OR REPLACE FUNCTION signet.apply_stripe_subscription(p_input jsonb) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, signet, public, pg_temp
AS $$
DECLARE
  c_text_fields     constant text[] := ARRAY['stripe_event_id', 'stripe_read_at', 'occurred_at', 'event_type',
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
  v_read_at         timestamptz;
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
     OR (p_input ->> 'stripe_read_at') !~ c_iso_pattern
     OR (p_input ->> 'current_period_end') !~ c_iso_pattern THEN
    RAISE EXCEPTION 'apply_stripe_subscription: date qui n''est pas au format ISO 8601' USING ERRCODE = 'SG003';
  END IF;
  BEGIN
    v_occurred_at := (p_input ->> 'occurred_at')::timestamptz;
    v_read_at     := (p_input ->> 'stripe_read_at')::timestamptz;
    v_period_end  := (p_input ->> 'current_period_end')::timestamptz;
  EXCEPTION
    WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'apply_stripe_subscription: date hors calendrier' USING ERRCODE = 'SG003';
  END;

  -- Borne haute de la marque (D-072, D-076) : une instance dont l'horloge avance
  -- de plus de 5 minutes sur la base figerait l'organisation (tous les etats
  -- suivants seraient `stale`). Refus REJOUABLE (`SG008`, hors des refus
  -- definitifs SG003 a SG006) : Inngest rejoue le pas d'ecriture avec la marque
  -- memorisee, qui passe des que l'horloge de la base l'a rattrapee ; l'etat
  -- relu (par exemple un `deleted`) n'est jamais perdu. La limite exacte
  -- (`now()` + 5 minutes) est acceptee.
  IF v_read_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'apply_stripe_subscription: stripe_read_at dans le futur (horloge de l''instance en avance), a rejouer'
      USING ERRCODE = 'SG008';
  END IF;

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
    -- Comparaison en uuid, jamais en texte : la casse d'un UUID ne change pas
    -- l'organisation designee (audit-002 CRITIQUE-1, D-071).
    IF v_metadata_org IS NOT NULL
       AND (CASE WHEN v_metadata_org ~ c_uuid_pattern THEN v_metadata_org::uuid <> v_org ELSE true END) THEN
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

  -- 3. Garde monotone (D-071) : un etat relu avant le dernier etat applique est
  --    perime ; il n'ecrit rien, ni etat ni evenement facturable. Cas couvert :
  --    le pas d'ecriture rejoue par Inngest apres une panne, avec un etat
  --    memorise anterieur au dernier applique. Limites (ADR-0016, D-072) : la
  --    marque est l'instant ou l'instance a RECU la reponse de Stripe, pas
  --    l'instant de l'etat chez Stripe, et les horloges des instances peuvent
  --    differer ; deux executions concurrentes du meme abonnement ne sont pas
  --    ordonnees par cette garde, mais par la limite de concurrence Inngest par
  --    abonnement.
  IF v_current.stripe_synced_at IS NOT NULL AND v_read_at < v_current.stripe_synced_at THEN
    RETURN 'stale';
  END IF;

  -- 4. Coherence avec ce qui est deja rattache (Q-7) : aucune ecriture.
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

  -- 5. Correspondance des statuts (Q-8).
  -- Statut relu seulement (Q-2, D-071) : le type d'evenement n'est qu'un
  -- declencheur ; Stripe relit un abonnement supprime en `canceled`.
  IF v_stripe_status IN ('canceled', 'incomplete_expired') THEN
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

  -- 6. Ecriture de l'etat.
  BEGIN
    UPDATE public.subscription s
       SET tier = v_new_tier,
           status = v_new_status,
           stripe_customer_id = coalesce(v_current.stripe_customer_id, v_customer_id),
           stripe_subscription_id = v_new_sub_id,
           current_period_end = v_new_period_end,
           cancel_at_period_end = v_new_cancel,
           stripe_synced_at = v_read_at,
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

  -- 7. Evenement facturable sur changement de palier seulement (Q-5).
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
  'Seul chemin d''ecriture de subscription (hors create_organization) et de billing_event (ADR-0016). Entree jsonb validee champ par champ (SG003) ; organisation derivee de la ligne deja rattachee ou de la metadonnee relue chez Stripe, comparee en uuid (SG004, SG005) ; incoherences Stripe SG006 ; etat relu plus ancien que le dernier applique ignore (stale, D-071). EXECUTE : signet_billing seul.';
