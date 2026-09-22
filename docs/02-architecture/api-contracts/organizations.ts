import { z } from "zod";
import { ApiContract, Uuid } from "./_contract";

/**
 * US-01 — Creation d'organisation et compte owner.
 * Suppose une session better-auth deja etablie (inscription utilisateur geree
 * par la brique d'authentification, hors contrat applicatif). Delegue a
 * `signet.create_organization()` (ERD §1, SECURITY DEFINER : aucun contexte
 * tenant n'existe encore) qui cree l'organisation, le membership owner, le
 * compteur de quota et l'abonnement Free en une transaction.
 * `slug` (exige par le plugin organization de better-auth, ERD §3) n'est PAS
 * un champ utilisateur : derive de `name` cote serveur (slugification +
 * suffixe si collision sur l'unicite globale). Le PRD ne mentionne aucune
 * notion de slug — l'exposer a l'utilisateur serait une fonctionnalite non
 * demandee.
 */
const createOrganizationInput = z.object({
  name: z.string().trim().min(1).max(120),
});

const createOrganizationOutput = z.object({
  id: Uuid,
  name: z.string(),
  slug: z.string(),
  createdAt: z.string().datetime(),
  role: z.literal("owner"),
});

export const createOrganization: ApiContract<
  typeof createOrganizationInput,
  typeof createOrganizationOutput
> = {
  route: "/api/organizations",
  method: "POST",
  minRole: "public", // authentifie via better-auth, mais n'appartient encore a aucune organisation
  input: createOrganizationInput,
  output: createOrganizationOutput,
  errors: [
    { status: 401, code: "UNAUTHENTICATED", trigger: "aucune session better-auth valide" },
    { status: 422, code: "VALIDATION_FAILED", trigger: "name vide, ou > 120 caracteres" },
  ],
  idempotency:
    "non-idempotente : chaque appel reussi cree une nouvelle organisation. Aucune cle de deduplication n'est exigee par le PRD (US-01 ne mentionne aucune contrainte d'unicite sur le nom d'organisation entre organisations distinctes).",
};

/**
 * US-01.2 — Renommage, owner uniquement.
 */
const renameOrganizationInput = z.object({
  organizationId: Uuid,
  name: z.string().trim().min(1).max(120),
});

const renameOrganizationOutput = z.object({
  id: Uuid,
  name: z.string(),
});

export const renameOrganization: ApiContract<
  typeof renameOrganizationInput,
  typeof renameOrganizationOutput
> = {
  route: "/api/organizations/:organizationId",
  method: "PATCH",
  minRole: "owner",
  input: renameOrganizationInput,
  output: renameOrganizationOutput,
  errors: [
    { status: 401, code: "UNAUTHENTICATED", trigger: "aucune session valide" },
    { status: 404, code: "ORGANIZATION_NOT_FOUND", trigger: "organizationId inexistant, ou appelant non membre de cette organisation (US-09.2 : jamais de 403 qui reveserait l'existence)" },
    { status: 403, code: "INSUFFICIENT_ROLE", trigger: "appelant membre de l'organisation mais role = member" },
    { status: 422, code: "VALIDATION_FAILED", trigger: "name vide, ou > 120 caracteres" },
  ],
  idempotency:
    "idempotente sur (organizationId, name) : rejouer la meme requete produit le meme etat final sans effet de bord supplementaire.",
};
