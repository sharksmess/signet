import { z } from "zod";
import { ApiContract, Uuid } from "./_contract";

/**
 * US-02 — Invitation d'un membre. L'envoi de l'e-mail est decouple de la
 * creation en base (ADR-0006, Inngest) : un succes 201 signifie "invitation
 * valide et persistee", pas "e-mail deja remis".
 */
const createInvitationInput = z.object({
  organizationId: Uuid,
  email: z.string().trim().email(),
});

const createInvitationOutput = z.object({
  id: Uuid,
  organizationId: Uuid,
  email: z.string().email(),
  expiresAt: z.string().datetime(),
});

export const createInvitation: ApiContract<
  typeof createInvitationInput,
  typeof createInvitationOutput
> = {
  route: "/api/organizations/:organizationId/invitations",
  method: "POST",
  minRole: "owner",
  input: createInvitationInput,
  output: createInvitationOutput,
  errors: [
    { status: 401, code: "UNAUTHENTICATED", trigger: "aucune session valide" },
    { status: 404, code: "ORGANIZATION_NOT_FOUND", trigger: "organizationId inexistant, ou appelant non membre" },
    { status: 403, code: "INSUFFICIENT_ROLE", trigger: "appelant membre mais role = member (US-02.2)" },
    { status: 422, code: "VALIDATION_FAILED", trigger: "email absent ou malforme" },
    { status: 409, code: "INVITATION_ALREADY_PENDING", trigger: "decision du 2026-09-22 : une invitation non consommee et non expiree existe deja pour (organizationId, email) — index unique partiel invitation_pending_idx (ERD §5)." },
  ],
  idempotency:
    "non-idempotente : chaque appel reussi cree une nouvelle invitation avec un nouveau token et une nouvelle expiration a 7 jours. Un rejeu tant que la precedente est encore en attente ET valide retourne 409 INVITATION_ALREADY_PENDING. Si la precedente est expiree, `signet.create_invitation()` la purge automatiquement avant d'inserer la nouvelle (ERD §5) — l'owner n'a rien a faire de special pour reinviter apres expiration, un simple appel repete suffit.",
};

/**
 * US-03 — Acceptation d'une invitation. Route publique : l'invite n'a pas
 * necessairement de compte au moment du clic. Le secret est transmis dans le
 * CORPS de la requete, jamais dans le chemin de l'URL (ADR-0003, point de
 * vigilance) : un chemin contenant le secret finit dans les journaux d'acces
 * de tout reverse proxy ou outil d'observabilite standard. La page qui
 * affiche le formulaire d'acceptation peut recevoir le token en query string
 * (lien d'e-mail, inevitable) ; c'est l'appel API qui ne doit jamais le
 * reporter dans son propre chemin.
 */
const acceptInvitationInput = z.object({
  token: z.string().min(1),
  /** Absent si l'invite n'a pas encore de compte ; better-auth gere alors la creation de compte avant liaison. */
  password: z.string().min(8).optional(),
});

const acceptInvitationOutput = z.object({
  organizationId: Uuid,
  role: z.literal("member"),
});

export const acceptInvitation: ApiContract<
  typeof acceptInvitationInput,
  typeof acceptInvitationOutput
> = {
  route: "/api/invitations/accept",
  method: "POST",
  minRole: "public",
  input: acceptInvitationInput,
  output: acceptInvitationOutput,
  errors: [
    { status: 404, code: "INVITATION_NOT_FOUND", trigger: "token inconnu : signet.accept_invitation() ne retourne aucune ligne car aucune empreinte ne correspond (jamais emis, ou format invalide)" },
    { status: 410, code: "INVITATION_EXPIRED", trigger: "empreinte trouvee mais expires_at depasse (US-03.2) — accept_invitation() ne retourne aucune ligne, l'appelant distingue expire de inconnu par une lecture separee via signet.lookup_invitation() avant tentative d'acceptation" },
    { status: 409, code: "INVITATION_ALREADY_USED", trigger: "accepted_at deja renseigne (US-03.3) — meme non-retour de accept_invitation(), distingue par lookup_invitation()" },
  ],
  idempotency:
    "rejouable uniquement avant la premiere consommation reussie : le token est a usage unique par construction (ERD §5, UPDATE ... WHERE accepted_at IS NULL ... RETURNING, sans lecture prealable). Un deuxieme appel avec le meme token, meme identique au premier, retourne 409 plutot que de reproduire le meme resultat — ce n'est PAS une idempotence au sens strict, c'est une garantie usage-unique.",
};
