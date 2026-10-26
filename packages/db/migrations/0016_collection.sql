CREATE TABLE "collection" (
	"id" uuid PRIMARY KEY DEFAULT signet.uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_id_organization_id_key" UNIQUE("id","organization_id"),
	CONSTRAINT "collection_name_length_chk" CHECK (char_length(btrim("collection"."name")) BETWEEN 1 AND 100),
	CONSTRAINT "collection_name_trimmed_chk" CHECK ("collection"."name" = btrim("collection"."name"))
);
--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collection_org_name_ci_idx" ON "collection" USING btree ("organization_id",lower(btrim("name")));

-- ============================================================================
-- Section ecrite a la main — ERD §6.1 ; tranche 004 : proprietaire, RLS
-- (activee et forcee), politique unique TO signet_app, privileges. Une seule
-- migration (ERD "Ordre des migrations") : la table n'existe jamais sans sa RLS.
--
-- Hors perimetre : table link et sa FK composite (005), DELETE (007), aucune
-- fonction SECURITY DEFINER, aucune politique signet_definer.
-- ============================================================================

ALTER TABLE "collection" OWNER TO signet_owner;
ALTER TABLE "collection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "collection" FORCE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- Privileges
-- --------------------------------------------------------------------------
-- signet_app : lecture (RETURNING de la creation, liste 009) et creation.
-- Ni UPDATE (aucun renommage dans le MVP), ni DELETE (ajoute par 007 avec sa
-- route), ni TRUNCATE. Les autres roles applicatifs (signet_auth,
-- signet_billing, signet_definer) n'ont rien.
GRANT SELECT, INSERT ON "collection" TO signet_app;

-- --------------------------------------------------------------------------
-- Politique RLS (TO signet_app seulement) — ERD §6.1, matrice d'isolation.
-- current_org() verifie deja que l'utilisateur de session est membre de
-- l'organisation du contexte (ADR-0011) : owner et member creent et lisent les
-- collections de leur organisation, aucune autre. Sans app.user_id, ou sous un
-- contexte etranger, current_org() est NULL : aucune ligne visible, toute
-- insertion refusee (42501).
-- --------------------------------------------------------------------------
CREATE POLICY "collection_isolation" ON "collection"
  FOR ALL TO signet_app
  USING (organization_id = signet.current_org())
  WITH CHECK (organization_id = signet.current_org());
