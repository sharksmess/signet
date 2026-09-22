import { z } from "zod";
import { ApiContract, OrganizationRole, Uuid } from "./_contract";

/**
 * US-07.1 (partiel) — liste des membres d'une organisation, necessaire pour
 * que l'owner choisisse qui retirer. Lecture seule, meme regle d'isolation
 * que la consultation des collections/liens.
 */
const listMembersInput = z.object({
  organizationId: Uuid,
});

const listMembersOutput = z.array(
  z.object({
    userId: Uuid,
    email: z.string().email(),
    role: OrganizationRole,
  }),
);

export const listMembers: ApiContract<typeof listMembersInput, typeof listMembersOutput> = {
  route: "/api/organizations/:organizationId/members",
  method: "GET",
  minRole: "member",
  input: listMembersInput,
  output: listMembersOutput,
  errors: [
    { status: 401, code: "UNAUTHENTICATED", trigger: "aucune session valide" },
    { status: 404, code: "ORGANIZATION_NOT_FOUND", trigger: "organizationId inexistant, ou appelant non membre" },
  ],
  idempotency: "idempotente par nature : lecture seule, aucun effet de bord.",
};

/**
 * US-04 — Retrait d'un membre par l'owner. Le dernier owner ne peut ni se
 * retirer lui-meme ni etre retire (US-04.3) : verifie en base (voir
 * db-architect), remonte ici comme 409 explicite.
 */
const removeMemberInput = z.object({
  organizationId: Uuid,
  userId: Uuid,
});

const removeMemberOutput = z.object({
  removed: z.literal(true),
});

export const removeMember: ApiContract<typeof removeMemberInput, typeof removeMemberOutput> = {
  route: "/api/organizations/:organizationId/members/:userId",
  method: "DELETE",
  minRole: "owner",
  input: removeMemberInput,
  output: removeMemberOutput,
  errors: [
    { status: 401, code: "UNAUTHENTICATED", trigger: "aucune session valide" },
    { status: 404, code: "ORGANIZATION_NOT_FOUND", trigger: "organizationId inexistant, ou appelant non membre" },
    { status: 403, code: "INSUFFICIENT_ROLE", trigger: "appelant membre mais role = member (US-04.2)" },
    { status: 404, code: "MEMBER_NOT_FOUND", trigger: "userId n'appartient pas a cette organisation" },
    { status: 409, code: "LAST_OWNER_PROTECTED", trigger: "userId cible est le dernier owner de l'organisation (US-04.3), y compris quand appelant === userId" },
  ],
  idempotency:
    "non-idempotente au sens strict : le premier appel retire le membre (200), un second appel avec le meme userId retourne 404 MEMBER_NOT_FOUND (il n'appartient plus a l'organisation). Pas d'effet de bord duplique en cas de rejeu.",
};
