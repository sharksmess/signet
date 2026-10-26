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
    { status: 409, code: "ALREADY_MEMBER", trigger: "D-086 Q-2 (tranche 003) : l'adresse normalisee (minuscules) est deja celle d'un membre de l'organisation, owner compris (l'owner qui s'invite lui-meme) ; aucune invitation creee, aucun e-mail." },
    { status: 503, code: "SERVICE_UNAVAILABLE", trigger: "D-086 Q-3 (tranche 003) : la file d'attente (Inngest) refuse l'evenement d'envoi ou ne repond pas dans le delai ; la mise en file precede le COMMIT, la transaction est annulee : aucune invitation creee, un nouvel appel est possible aussitot (pas de 409)." },
  ],
  idempotency:
    "non-idempotente : chaque appel reussi cree une nouvelle invitation avec un nouveau token et une nouvelle expiration a 7 jours. Un rejeu tant que la precedente est encore en attente ET valide retourne 409 INVITATION_ALREADY_PENDING. Si la precedente est expiree, `signet.create_invitation()` la purge automatiquement avant d'inserer la nouvelle (ERD §5) — l'owner n'a rien a faire de special pour reinviter apres expiration, un simple appel repete suffit.",
};

/**
 * US-03 — Acceptation d'une invitation. Amende par la tranche 006 (D-102 Q-1,
 * Q-2 ; ADR-0018) : session better-auth OBLIGATOIRE ; l'invite sans compte
 * s'inscrit d'abord par `POST /api/auth/sign-up/email` (tranche 001), puis
 * accepte. L'adresse du compte connecte doit etre l'adresse invitee
 * (insensible a la casse), verifiee par la base dans
 * `signet.accept_invitation()`. Le champ `password` est retire : la route ne
 * cree aucun compte et n'ouvre aucune session (un `password` fourni est
 * ignore).
 *
 * Le secret est transmis dans le CORPS de la requete, jamais dans le chemin
 * ni la query string de l'URL (ADR-0003, point de vigilance) : un chemin
 * contenant le secret finit dans les journaux d'acces de tout reverse proxy
 * ou outil d'observabilite standard. Le lien d'e-mail le porte dans le
 * fragment `#token=` (tranche 003, P-1), que le navigateur n'envoie pas au
 * serveur ; un `?token=` sur la route d'API est ignore (422 sans corps).
 *
 * Ordre d'evaluation : session -> validation -> decodage strict du jeton
 * (base64url sans remplissage, 43 caracteres, 32 octets) -> empreinte
 * `sha256(octets)` (D-090) -> `accept_invitation()` ; si aucune ligne,
 * `lookup_invitation()` dans la meme transaction pour distinguer
 * 404 / 410 / 409 / 403. La lecture de distinction a lieu APRES l'echec de
 * la consommation, jamais avant.
 */
const acceptInvitationInput = z.object({
  /**
   * Texte du jeton. Aucune longueur minimale : une chaine vide ou faite
   * d'espaces est un jeton malforme (404 INVITATION_NOT_FOUND, comme tout
   * jeton inconnu), pas une erreur de validation (lecture validee par
   * l'humain, tranche 006). Au-dela de 256 caracteres : 422.
   */
  token: z.string().max(256),
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
    { status: 401, code: "UNAUTHENTICATED", trigger: "D-102 Q-1 (tranche 006) : aucune session valide, ou compte disparu entre la session et l'acceptation (SG002 / 23503 de accept_invitation(), ou invitation en attente adressee a l'adresse de la session mais non consommee) ; l'invitation reste en attente." },
    { status: 422, code: "VALIDATION_FAILED", trigger: "corps non JSON, token absent ou non textuel, ou token de plus de 256 caracteres ; un token en query string est ignore." },
    { status: 404, code: "INVITATION_NOT_FOUND", trigger: "token inconnu OU malforme (pas du base64url sans remplissage de 43 caracteres, ou decode en autre chose que 32 octets, chaine vide comprise) : corps identique dans les deux cas ; aucune requete en base pour un token malforme ; pour un token bien forme, accept_invitation() puis lookup_invitation() ne retournent aucune ligne." },
    { status: 410, code: "INVITATION_EXPIRED", trigger: "empreinte trouvee, non acceptee, expires_at <= now() (US-03.2, D-091 : calcul en UTC) — accept_invitation() ne retourne aucune ligne, lookup_invitation(), appelee APRES, rend l'etat expired." },
    { status: 409, code: "INVITATION_ALREADY_USED", trigger: "empreinte trouvee, accepted_at deja renseigne (US-03.3), y compris pour le perdant d'une acceptation concurrente et pour un autre compte qui presente le jeton deja consomme — lookup_invitation() rend l'etat accepted." },
    { status: 403, code: "INVITATION_EMAIL_MISMATCH", trigger: "D-102 Q-2 (tranche 006) : invitation en attente et valide, adressee a une autre adresse que celle du compte connecte (comparaison insensible a la casse, portee par la base) ; message fixe qui ne contient ni l'adresse invitee ni celle du compte ; rien n'est consomme, le bon compte peut accepter ensuite." },
    { status: 409, code: "ALREADY_MEMBER", trigger: "P-5 (tranche 006) : le compte connecte est deja membre de l'organisation de l'invitation, owner compris (SG008 de accept_invitation()) ; l'invitation n'est pas consommee, aucune ligne member ajoutee." },
  ],
  idempotency:
    "rejouable uniquement avant la premiere consommation reussie : le token est a usage unique par construction (ERD §5, un seul UPDATE ... WHERE accepted_at IS NULL AND expires_at > now() AND email = adresse du compte ... RETURNING ; la lecture prealable de la ligne par empreinte ne sert qu'a poser le contexte et ne decide rien). Un deuxieme appel avec le meme token, meme identique au premier, retourne 409 INVITATION_ALREADY_USED plutot que de reproduire le meme resultat — ce n'est PAS une idempotence au sens strict, c'est une garantie usage-unique. Un refus (401, 403, 404, 409 ALREADY_MEMBER, 410) ne consomme rien.",
};
