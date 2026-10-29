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
  minRole: "authenticated", // toute session valide, sans appartenance prealable a une organisation (D-143)
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
 * Liste des organisations de l'utilisateur de session (parcours d'ecran de la
 * tranche 012 ; tranche 013, decision D-138). S'appuie sur
 * `signet.organizations_for_user()` (ERD §1, ADR-0011 § e) : l'utilisateur lu
 * est toujours celui de la session, jamais un parametre de la requete.
 * Ordre : `created_at DESC, id DESC` de l'organisation. Pas de role dans la
 * sortie (la fonction ne le rend pas ; la page d'organisation le lit par
 * `listMembers`).
 */
const listMyOrganizationsInput = z.object({});

const listMyOrganizationsOutput = z.array(
  z.object({
    id: Uuid,
    name: z.string(),
    createdAt: z.string().datetime(),
  }),
);

export const listMyOrganizations: ApiContract<
  typeof listMyOrganizationsInput,
  typeof listMyOrganizationsOutput
> = {
  route: "/api/organizations",
  method: "GET",
  minRole: "authenticated", // toute session valide, comme createOrganization (D-143)
  input: listMyOrganizationsInput,
  output: listMyOrganizationsOutput,
  errors: [
    { status: 401, code: "UNAUTHENTICATED", trigger: "aucune session better-auth valide" },
  ],
  idempotency: "idempotente par nature : lecture seule, aucun effet de bord.",
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
