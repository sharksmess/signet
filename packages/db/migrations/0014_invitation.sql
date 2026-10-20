CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT signet.uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '7 days' NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	CONSTRAINT "invitation_email_lower_chk" CHECK ("invitation"."email" = lower("invitation"."email")),
	CONSTRAINT "invitation_email_length_chk" CHECK (char_length("invitation"."email") <= 254),
	CONSTRAINT "invitation_email_format_chk" CHECK ("invitation"."email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
	CONSTRAINT "invitation_role_chk" CHECK ("invitation"."role" = 'member'),
	CONSTRAINT "invitation_token_hash_length_chk" CHECK (octet_length("invitation"."token_hash") = 32),
	CONSTRAINT "invitation_expires_after_creation_chk" CHECK ("invitation"."expires_at" > "invitation"."created_at"),
	CONSTRAINT "invitation_expires_within_7_days_chk" CHECK ("invitation"."expires_at" <= "invitation"."created_at" + interval '7 days'),
	CONSTRAINT "invitation_acceptance_consistent" CHECK (("invitation"."accepted_at" IS NULL) = ("invitation"."accepted_by_user_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_user_id_app_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_accepted_by_user_id_app_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_token_hash_idx" ON "invitation" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_pending_idx" ON "invitation" USING btree ("organization_id","email") WHERE accepted_at IS NULL;--> statement-breakpoint
CREATE INDEX "invitation_org_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_expires_idx" ON "invitation" USING btree ("expires_at") WHERE accepted_at IS NULL;

-- ============================================================================
-- Section ecrite a la main — ERD §5 ; tranche 003 (D-086, D-088) :
-- proprietaire, RLS (owner seul, D-086 P-3), privileges et fonction
-- d'emission signet.create_invitation, SECURITY INVOKER. Une seule migration
-- (D-088, ERD "Ordre des migrations") : la table n'existe jamais sans sa RLS.
--
-- Hors perimetre (tranche 006) : politiques signet_definer, GRANT UPDATE,
-- lookup_invitation, accept_invitation.
-- ============================================================================

ALTER TABLE "invitation" OWNER TO signet_owner;
ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitation" FORCE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- Privileges
-- --------------------------------------------------------------------------
-- signet_app : lecture, emission, et DELETE pour la seule purge de la ligne
-- expiree du couple dans create_invitation. Ni UPDATE (006) ni TRUNCATE. Les
-- autres roles applicatifs (signet_auth, signet_billing) n'ont rien.
GRANT SELECT, INSERT, DELETE ON "invitation" TO signet_app;

-- --------------------------------------------------------------------------
-- Politiques RLS (TO signet_app seulement) — owner de l'organisation du
-- contexte, texte de subscription_owner_only (ERD §8.1) : current_org()
-- verifie deja que l'utilisateur de session est membre (ADR-0011) ; la
-- jointure sur member ajoute le role owner (D-086 P-3). Un member ne voit ni
-- n'emet aucune invitation.
-- --------------------------------------------------------------------------
CREATE POLICY "invitation_owner_read" ON "invitation"
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

CREATE POLICY "invitation_owner_insert" ON "invitation"
  FOR INSERT TO signet_app
  WITH CHECK (
    organization_id = signet.current_org()
    AND EXISTS (
      SELECT 1 FROM member m
       WHERE m.organization_id = signet.current_org()
         AND m.user_id = signet.current_user_id()
         AND m.role = 'owner'
    )
  );

CREATE POLICY "invitation_owner_delete" ON "invitation"
  FOR DELETE TO signet_app
  USING (
    organization_id = signet.current_org()
    AND EXISTS (
      SELECT 1 FROM member m
       WHERE m.organization_id = signet.current_org()
         AND m.user_id = signet.current_user_id()
         AND m.role = 'owner'
    )
  );

-- --------------------------------------------------------------------------
-- signet.create_invitation(p_organization_id, p_email, p_token_hash) — ERD §5
-- --------------------------------------------------------------------------
-- SECURITY INVOKER : l'appelant (owner, signet_app) est deja dans un contexte
-- tenant valide ; la RLS de invitation s'applique a chaque instruction. Sous
-- un contexte etranger, un member, ou sans contexte, current_org() ou la
-- jointure owner echouent : le DELETE ne touche rien et l'INSERT est refuse
-- (42501). Aucune entree dans la liste fermee des points d'entree definer.
--
-- invited_by_user_id = utilisateur de session, jamais un parametre. Aucun
-- parametre de date : created_at et expires_at prennent leur valeur par
-- defaut (7 jours, maximum impose par CHECK).
--
-- Corps : purge de la ligne en attente EXPIREE du couple (l'index partiel
-- invitation_pending_idx ne peut pas exclure les lignes expirees, now()
-- n'etant pas immutable), puis INSERT. Une ligne encore valide fait lever
-- 23505 sur invitation_pending_idx, traduit en 409 par l'application. Deux
-- emissions concurrentes se serialisent sur le verrou de la ligne purgee ou
-- sur l'entree d'index en attente : la seconde leve 23505 apres le COMMIT de
-- la premiere.
--
-- TimeZone = 'UTC' (D-091) : `now() + interval '7 days'` (DEFAULT) et le CHECK
-- `expires_at <= created_at + interval '7 days'` ajoutent 7 jours en heure
-- MURALE du fuseau de la session. Sous un fuseau a changement d'heure, la
-- duree reelle serait de 167 ou 169 heures selon la semaine et selon la
-- configuration du serveur Postgres. Fige ici, l'emission donne toujours
-- 168 heures exactement.
CREATE FUNCTION signet.create_invitation(p_organization_id uuid, p_email text, p_token_hash bytea)
RETURNS public.invitation
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, signet, public, pg_temp
SET TimeZone = 'UTC'
AS $$
DECLARE
  v_row public.invitation%ROWTYPE;
BEGIN
  DELETE FROM public.invitation i
   WHERE i.organization_id = p_organization_id
     AND i.email = p_email
     AND i.accepted_at IS NULL
     AND i.expires_at <= now();

  INSERT INTO public.invitation (organization_id, email, token_hash, invited_by_user_id)
  VALUES (p_organization_id, p_email, p_token_hash, signet.current_user_id())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION signet.create_invitation(uuid, text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION signet.create_invitation(uuid, text, bytea) TO signet_app;

COMMENT ON FUNCTION signet.create_invitation(uuid, text, bytea) IS
  'Emission d''une invitation (US-02.1, ERD §5) : SECURITY INVOKER sous la RLS owner de invitation ; purge la ligne expiree du couple puis insere ; 23505 sur invitation_pending_idx si une invitation valide existe.';
