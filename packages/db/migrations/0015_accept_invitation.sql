-- Migration 15 — Acceptation d'une invitation (tranche 006, US-03 ; D-102,
-- D-103 ; ERD §1, §2.1, §5 ; ADR-0003, ADR-0011, ADR-0017, ADR-0018).
--
-- Aucune table, colonne ni index ne change : fichier cree par
-- `drizzle-kit generate --custom` (P-1), renomme au numero suivant du dossier
-- (ERD "Numerotation"). 0001-0014 restent intactes.
--
-- Pas de BEGIN/COMMIT : packages/db/src/migrate.ts execute deja ce fichier
-- entier dans une transaction.
--
-- Contenu :
--   1. privileges de signet_definer : SELECT sur invitation, UPDATE des deux
--      seules colonnes d'acceptation (D-103), SELECT (id, email) sur app_user
--      (P-3) ; signet_app inchange (SELECT, INSERT, DELETE sur invitation) ;
--   2. politiques TO signet_definer : deux lectures et un UPDATE borne sur
--      invitation, lecture de sa propre ligne app_user. Aucune n'appelle
--      current_org() (ADR-0011 R1) ;
--   3. signet.lookup_invitation(bytea) et signet.accept_invitation(bytea),
--      SECURITY DEFINER, proprietaire signet_definer, EXECUTE a signet_app seul.

-- ============================================================================
-- 1. Privileges
-- ============================================================================
-- signet_definer, sur invitation : lecture (empreinte, contexte) et ecriture
-- des seules colonnes d'acceptation. Ni INSERT, ni DELETE, ni TRUNCATE, ni
-- UPDATE d'une autre colonne (AC13 a).
GRANT SELECT ON "invitation" TO signet_definer;
GRANT UPDATE ("accepted_at", "accepted_by_user_id") ON "invitation" TO signet_definer;

-- signet_definer, sur app_user : l'identifiant et l'adresse, pour le
-- rapprochement d'adresse porte par la base (P-3, ADR-0018). Aucune autre
-- colonne (nom, image, dates).
GRANT SELECT ("id", "email") ON "app_user" TO signet_definer;

-- ============================================================================
-- 2. Politiques RLS (TO signet_definer seulement)
-- ============================================================================

-- Lecture par empreinte : l'invite n'a aucun contexte tenant. La fonction pose
-- app.invitation_token_hash (hexadecimal de l'empreinte qu'elle a recue), lit
-- la ligne (au plus une : index unique invitation_token_hash_idx), puis remet
-- le reglage a vide (patron subscription_definer_stripe_lookup, 0012). Une
-- valeur vide ou absente ne designe aucune ligne.
CREATE POLICY "invitation_definer_token_lookup" ON "invitation"
  FOR SELECT TO signet_definer
  USING (token_hash = decode(nullif(current_setting('app.invitation_token_hash', true), ''), 'hex'));

-- Lecture sur le contexte pose par la fonction depuis la ligne d'invitation :
-- Postgres exige qu'un UPDATE ... WHERE ... RETURNING voie la ligne par une
-- politique SELECT (D-103).
CREATE POLICY "invitation_definer_context_read" ON "invitation"
  FOR SELECT TO signet_definer
  USING (organization_id = signet.context_org());

-- Seule ECRITURE nouvelle (D-103, AC13) : une ligne non acceptee de
-- l'organisation du contexte devient acceptee par l'utilisateur de session.
-- Une ligne deja acceptee n'est plus modifiable ; accepted_by_user_id ne peut
-- designer personne d'autre que current_user_id(). Le privilege de colonne
-- ferme toute autre colonne.
CREATE POLICY "invitation_definer_accept" ON "invitation"
  FOR UPDATE TO signet_definer
  USING (organization_id = signet.context_org() AND accepted_at IS NULL)
  WITH CHECK (
    organization_id = signet.context_org()
    AND accepted_at IS NOT NULL
    AND accepted_by_user_id = signet.current_user_id()
  );

-- app_user : sa propre ligne, et rien d'autre (ERD §2.1). Combinee au
-- privilege de colonne (id, email).
CREATE POLICY "app_user_definer_self_read" ON "app_user"
  FOR SELECT TO signet_definer
  USING (id = signet.current_user_id());

-- ============================================================================
-- 3. signet.lookup_invitation(p_token_hash bytea) — ERD §1, §5
-- ============================================================================
-- Etat d'une invitation designee par son empreinte, pour distinguer apres un
-- echec de consommation : inconnue (aucune ligne), expired, accepted, ou
-- pending (en attente et valide : l'echec venait alors de l'adresse).
-- Ne revele que organization_name, email, state : ni identifiant, ni date,
-- ni inviteur. Aucune route ne l'expose (AC10).
--
-- Premiere instruction : garde d'identite SG002 (P-4 : utilisateur de session
-- exige, a rouvrir par la tranche 012 si l'invitation doit s'afficher avant
-- connexion). Le contexte ambiant est efface : seule la ligne d'invitation
-- fait foi. Le contexte pose depuis la ligne est efface avant le retour
-- (D-105) : rien de ce que la fonction a pose ne survit dans la transaction
-- de l'appelant.
--
-- STABLE : aucune ecriture de table ; les set_config ne portent que sur des
-- reglages transactionnels. TimeZone = 'UTC' (D-091) : `expires_at <= now()`
-- ne depend d'aucun fuseau, fige par coherence avec accept_invitation.
CREATE FUNCTION signet.lookup_invitation(p_token_hash bytea)
RETURNS TABLE (organization_name text, email text, state text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, signet, public, pg_temp
SET TimeZone = 'UTC'
AS $$
DECLARE
  v_org         uuid;
  v_email       text;
  v_accepted_at timestamptz;
  v_expires_at  timestamptz;
  v_name        text;
BEGIN
  IF signet.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'lookup_invitation: session user (app.user_id) is not set'
      USING ERRCODE = 'SG002';
  END IF;
  PERFORM set_config('app.organization_id', '', true);
  PERFORM set_config('app.invitation_token_hash', '', true);

  IF p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 THEN
    RETURN;
  END IF;

  PERFORM set_config('app.invitation_token_hash', encode(p_token_hash, 'hex'), true);
  SELECT i.organization_id, i.email, i.accepted_at, i.expires_at
    INTO v_org, v_email, v_accepted_at, v_expires_at
    FROM public.invitation i
   WHERE i.token_hash = p_token_hash;
  PERFORM set_config('app.invitation_token_hash', '', true);

  IF v_org IS NULL THEN
    RETURN;
  END IF;

  PERFORM set_config('app.organization_id', v_org::text, true);
  SELECT o.name INTO v_name
    FROM public.organization o
   WHERE o.id = signet.context_org();
  PERFORM set_config('app.organization_id', '', true);

  IF v_name IS NULL THEN
    -- invitation.organization_id est une cle etrangere ON DELETE CASCADE :
    -- une invitation sans organisation visible est un invariant rompu.
    RAISE EXCEPTION 'lookup_invitation: organization of the invitation is not visible';
  END IF;

  organization_name := v_name;
  email := v_email;
  state := CASE
             WHEN v_accepted_at IS NOT NULL THEN 'accepted'
             WHEN v_expires_at <= now() THEN 'expired'
             ELSE 'pending'
           END;
  RETURN NEXT;
END;
$$;

ALTER FUNCTION signet.lookup_invitation(bytea) OWNER TO signet_definer;
REVOKE ALL ON FUNCTION signet.lookup_invitation(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION signet.lookup_invitation(bytea) TO signet_app;

COMMENT ON FUNCTION signet.lookup_invitation(bytea) IS
  'Etat (pending, expired, accepted), nom de l''organisation et adresse de l''invitation designee par son empreinte (ERD §1, §5). Leve SG002 sans utilisateur de session ; empreinte NULL, de longueur differente de 32 ou inconnue : aucune ligne. Contexte ambiant ignore. EXECUTE : signet_app seul.';

-- ============================================================================
-- 4. signet.accept_invitation(p_token_hash bytea) — ERD §1, §5 ; P-2, P-3, P-5
-- ============================================================================
-- Consommation atomique a usage unique (US-03.3) et creation du member, au
-- nom de l'utilisateur de session (P-2 : aucun parametre d'utilisateur).
--
-- Premiere instruction : garde d'identite SG002. Le contexte ambiant est
-- efface ; app.organization_id est pose depuis la ligne d'invitation trouvee
-- par empreinte (valeur de confiance), puis efface avant le retour (D-105).
--
-- La lecture prealable ne decide rien : toute la decision est dans l'UPDATE
-- conditionnel, qui re-filtre sur l'empreinte, l'etat, l'expiration et
-- l'adresse du compte (P-3, ADR-0018 ; comparaison insensible a la casse,
-- invitation.email etant deja en minuscules). Deux acceptations concurrentes
-- se serialisent sur le verrou de ligne : la seconde re-evalue le predicat
-- apres le COMMIT de la premiere et ne modifie rien.
--
-- Aucune ligne modifiee (inconnue, expiree, deja acceptee, autre adresse,
-- compte disparu) : zero ligne retournee, rien d'ecrit ; l'appelant distingue
-- par lookup_invitation. Une ligne : INSERT du member dans la meme
-- transaction ; deja membre (23505 sur member_org_user_idx) -> SG008, qui
-- annule toute l'instruction, UPDATE compris (P-5).
--
-- VOLATILE. TimeZone = 'UTC' (D-091) : l'UPDATE reevalue le CHECK
-- `expires_at <= created_at + interval '7 days'`, en heure murale du fuseau
-- de la session ; sous un fuseau a changement d'heure, une ligne de 168 h
-- exactes leverait 23514.
CREATE FUNCTION signet.accept_invitation(p_token_hash bytea)
RETURNS TABLE (organization_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, signet, public, pg_temp
SET TimeZone = 'UTC'
AS $$
DECLARE
  v_user       uuid;
  v_org        uuid;
  v_accepted   uuid;
  v_inserted   integer;
  v_constraint text;
BEGIN
  v_user := signet.current_user_id();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'accept_invitation: session user (app.user_id) is not set'
      USING ERRCODE = 'SG002';
  END IF;
  PERFORM set_config('app.organization_id', '', true);
  PERFORM set_config('app.invitation_token_hash', '', true);

  IF p_token_hash IS NULL OR octet_length(p_token_hash) <> 32 THEN
    RETURN;
  END IF;

  -- Organisation de la ligne, pour poser le contexte : ne decide rien.
  PERFORM set_config('app.invitation_token_hash', encode(p_token_hash, 'hex'), true);
  SELECT i.organization_id INTO v_org
    FROM public.invitation i
   WHERE i.token_hash = p_token_hash;
  PERFORM set_config('app.invitation_token_hash', '', true);

  IF v_org IS NULL THEN
    RETURN;
  END IF;

  PERFORM set_config('app.organization_id', v_org::text, true);

  -- Consommation : un seul enonce conditionnel (ERD §5). 0 ou 1 ligne (index
  -- unique sur l'empreinte).
  UPDATE public.invitation i
     SET accepted_at = now(),
         accepted_by_user_id = v_user
   WHERE i.token_hash = p_token_hash
     AND i.accepted_at IS NULL
     AND i.expires_at > now()
     AND i.email = (SELECT lower(u.email) FROM public.app_user u WHERE u.id = v_user)
  RETURNING i.organization_id INTO v_accepted;

  IF v_accepted IS NULL THEN
    PERFORM set_config('app.organization_id', '', true);
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.member (organization_id, user_id, role)
    VALUES (v_accepted, v_user, 'member');
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'member_org_user_idx' THEN
        RAISE EXCEPTION 'accept_invitation: session user is already a member of the organization'
          USING ERRCODE = 'SG008';
      END IF;
      RAISE;
  END;
  IF v_inserted <> 1 THEN
    RAISE EXCEPTION 'accept_invitation: % member row(s) inserted, 1 expected', v_inserted;
  END IF;

  PERFORM set_config('app.organization_id', '', true);
  organization_id := v_accepted;
  RETURN NEXT;
END;
$$;

ALTER FUNCTION signet.accept_invitation(bytea) OWNER TO signet_definer;
REVOKE ALL ON FUNCTION signet.accept_invitation(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION signet.accept_invitation(bytea) TO signet_app;

COMMENT ON FUNCTION signet.accept_invitation(bytea) IS
  'Consommation atomique de l''invitation designee par son empreinte et creation du member (role member) pour l''utilisateur de session, si l''invitation est en attente, valide et adressee a l''adresse du compte (ERD §5, ADR-0018). Leve SG002 sans utilisateur de session, SG008 si deja membre (rien n''est consomme). Aucune ligne : rien d''ecrit. EXECUTE : signet_app seul.';
