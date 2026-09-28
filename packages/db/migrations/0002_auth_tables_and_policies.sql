CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT signet.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"password" text,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT signet.uuidv7() NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_email_length_chk" CHECK (char_length("app_user"."email") <= 254),
	CONSTRAINT "app_user_email_format_chk" CHECK ("app_user"."email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
	CONSTRAINT "app_user_name_length_chk" CHECK (char_length(btrim("app_user"."name")) BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT signet.uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"active_organization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT signet.uuidv7() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_idx" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_email_lower_idx" ON "app_user" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_idx" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_expires_at_idx" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "verification_expires_at_idx" ON "verification" USING btree ("expires_at");--> statement-breakpoint

-- ============================================================================
-- Section ecrite a la main (RLS, proprietaire, grants) — ERD §2, "Ordre des
-- migrations" etape 2 : "chaque etape comprend, dans la meme migration, la
-- table et sa politique RLS."
--
-- La politique `app_user_visible_to_co_members` (ERD §2.1, jointure sur
-- `member`) est deliberement DIFFEREE a la migration 0003 : `member` n'existe
-- pas encore ici (meme raison que le FK `session.active_organization_id` vers
-- `organization`, ajoute lui aussi en 0003). Entre 0002 et 0003, `signet_app`
-- n'a donc aucune politique sur `app_user` : fermeture par defaut (ERD §1),
-- pas une fuite — les deux migrations sont jouees dans la meme operation de
-- deploiement de cette tranche, jamais separement en production.
-- ============================================================================

ALTER TABLE "account" OWNER TO signet_owner;
ALTER TABLE "app_user" OWNER TO signet_owner;
ALTER TABLE "session" OWNER TO signet_owner;
ALTER TABLE "verification" OWNER TO signet_owner;

ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account" FORCE ROW LEVEL SECURITY;
ALTER TABLE "app_user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app_user" FORCE ROW LEVEL SECURITY;
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session" FORCE ROW LEVEL SECURITY;
ALTER TABLE "verification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification" FORCE ROW LEVEL SECURITY;

-- signet_auth : acces complet aux quatre tables d'authentification, hors de
-- tout contexte tenant (ERD §2.2 : "acces reserve a signet_auth").
CREATE POLICY "account_full_access_auth" ON "account"
  FOR ALL TO signet_auth USING (true) WITH CHECK (true);
CREATE POLICY "app_user_full_access_auth" ON "app_user"
  FOR ALL TO signet_auth USING (true) WITH CHECK (true);
CREATE POLICY "session_full_access_auth" ON "session"
  FOR ALL TO signet_auth USING (true) WITH CHECK (true);
CREATE POLICY "verification_full_access_auth" ON "verification"
  FOR ALL TO signet_auth USING (true) WITH CHECK (true);

-- signet_app n'a, a ce stade, aucune politique sur ces quatre tables : aucun
-- acces (ERD §2.2), a l'exception de la politique de lecture co-membres sur
-- `app_user` ajoutee en migration 0003.

GRANT SELECT, INSERT, UPDATE, DELETE ON "account", "app_user", "session", "verification" TO signet_auth;