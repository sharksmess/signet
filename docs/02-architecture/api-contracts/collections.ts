import { z } from "zod";
import { ApiContract, Uuid } from "./_contract";

/**
 * US-05 — Creation d'une collection, owner ou member. Unicite du nom par
 * organisation (US-05.3) : remontee comme 409, verifiee en base par l'index
 * unique fonctionnel `collection_org_name_ci_idx` sur (organization_id,
 * lower(btrim(name))) (ERD §6.1) — comparaison INSENSIBLE A LA CASSE,
 * decidee le 2026-09-22 : `Veille` et `veille` sont le meme nom.
 */
const createCollectionInput = z.object({
  organizationId: Uuid,
  name: z.string().trim().min(1).max(100),
});

const createCollectionOutput = z.object({
  id: Uuid,
  organizationId: Uuid,
  name: z.string(),
  createdAt: z.string().datetime(),
});

export const createCollection: ApiContract<
  typeof createCollectionInput,
  typeof createCollectionOutput
> = {
  route: "/api/organizations/:organizationId/collections",
  method: "POST",
  minRole: "member",
  input: createCollectionInput,
  output: createCollectionOutput,
  errors: [
    { status: 401, code: "UNAUTHENTICATED", trigger: "aucune session valide" },
    { status: 404, code: "ORGANIZATION_NOT_FOUND", trigger: "organizationId inexistant, ou appelant non membre" },
    { status: 422, code: "VALIDATION_FAILED", trigger: "name vide, ou > 100 caracteres" },
    { status: 409, code: "COLLECTION_NAME_TAKEN", trigger: "une collection du meme nom existe deja dans cette organisation (US-05.3)" },
  ],
  idempotency:
    "non-idempotente : chaque appel reussi cree une nouvelle collection. Un rejeu avec le meme name apres succes retourne 409 COLLECTION_NAME_TAKEN plutot que de dupliquer.",
};

/**
 * US-07.1 — liste des collections d'une organisation.
 */
const listCollectionsInput = z.object({
  organizationId: Uuid,
});

const listCollectionsOutput = z.array(
  z.object({
    id: Uuid,
    name: z.string(),
    createdAt: z.string().datetime(),
  }),
);

export const listCollections: ApiContract<
  typeof listCollectionsInput,
  typeof listCollectionsOutput
> = {
  route: "/api/organizations/:organizationId/collections",
  method: "GET",
  minRole: "member",
  input: listCollectionsInput,
  output: listCollectionsOutput,
  errors: [
    { status: 401, code: "UNAUTHENTICATED", trigger: "aucune session valide" },
    { status: 404, code: "ORGANIZATION_NOT_FOUND", trigger: "organizationId inexistant, ou appelant non membre" },
  ],
  idempotency: "idempotente par nature : lecture seule.",
};

/**
 * US-10 — Suppression d'une collection par l'owner, cascade reelle sur ses
 * liens dans la meme operation (US-10.1). Pas de soft delete (ADR db-architect) :
 * une fois supprimee, la collection et ses liens n'apparaissent plus dans
 * aucune consultation (US-10.3).
 */
const deleteCollectionInput = z.object({
  organizationId: Uuid,
  collectionId: Uuid,
});

const deleteCollectionOutput = z.object({
  deleted: z.literal(true),
  linksDeleted: z.number().int().nonnegative(),
});

export const deleteCollection: ApiContract<
  typeof deleteCollectionInput,
  typeof deleteCollectionOutput
> = {
  route: "/api/organizations/:organizationId/collections/:collectionId",
  method: "DELETE",
  minRole: "owner",
  input: deleteCollectionInput,
  output: deleteCollectionOutput,
  errors: [
    { status: 401, code: "UNAUTHENTICATED", trigger: "aucune session valide" },
    { status: 404, code: "ORGANIZATION_NOT_FOUND", trigger: "organizationId inexistant, ou appelant non membre" },
    { status: 403, code: "INSUFFICIENT_ROLE", trigger: "appelant membre mais role = member (US-10.2)" },
    { status: 404, code: "COLLECTION_NOT_FOUND", trigger: "collectionId inexistant, ou appartenant a une autre organisation (US-09.2)" },
  ],
  idempotency:
    "non-idempotente au sens strict : le premier appel supprime (200), un second appel avec le meme collectionId retourne 404 COLLECTION_NOT_FOUND. Pas d'effet de bord duplique en cas de rejeu.",
};
