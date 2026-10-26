/**
 * Erreurs metier typees (regle absolue CLAUDE.md : "les erreurs metier
 * attendues sont des valeurs de retour typees. `throw` est reserve aux
 * invariants qui ne devraient jamais arriver."). Chaque code correspond
 * exactement a un `errors[]` de `docs/02-architecture/api-contracts/organizations.ts`
 * ou `subscriptions.ts` (tranche 002 ; `SERVICE_UNAVAILABLE` : webhook,
 * AC14, file d'attente indisponible, D-070), ou `invitations.ts` (tranche 003 :
 * `INVITATION_ALREADY_PENDING`, `ALREADY_MEMBER`, et `SERVICE_UNAVAILABLE` quand
 * la file refuse l'evenement d'invitation, D-086 Q-2, Q-3), ou `collections.ts`
 * (tranche 004 : `COLLECTION_NAME_TAKEN`).
 */

export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "VALIDATION_FAILED"
  | "ORGANIZATION_NOT_FOUND"
  | "INSUFFICIENT_ROLE"
  | "ALREADY_ON_TIER"
  | "STRIPE_UNAVAILABLE"
  | "INVALID_SIGNATURE"
  | "SERVICE_UNAVAILABLE"
  | "INVITATION_ALREADY_PENDING"
  | "ALREADY_MEMBER"
  | "INVITATION_NOT_FOUND"
  | "INVITATION_EXPIRED"
  | "INVITATION_ALREADY_USED"
  | "INVITATION_EMAIL_MISMATCH"
  | "COLLECTION_NAME_TAKEN";

export interface ApiError {
  status: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 502 | 503;
  code: ApiErrorCode;
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(error: ApiError): Result<T> {
  return { ok: false, error };
}

export const unauthenticated = (): ApiError => ({
  status: 401,
  code: "UNAUTHENTICATED",
  message: "Aucune session valide.",
});

export const validationFailed = (message: string): ApiError => ({
  status: 422,
  code: "VALIDATION_FAILED",
  message,
});

export const organizationNotFound = (): ApiError => ({
  status: 404,
  code: "ORGANIZATION_NOT_FOUND",
  message: "Organisation introuvable.",
});

export const insufficientRole = (): ApiError => ({
  status: 403,
  code: "INSUFFICIENT_ROLE",
  message: "Role insuffisant pour cette action.",
});

/** Q-3, A5, D-071 : palier deja actif, annulation deja programmee, ou abonnement `incomplete` rattache a un Free (AC17). */
export const alreadyOnTier = (): ApiError => ({
  status: 409,
  code: "ALREADY_ON_TIER",
  message:
    "L'organisation est deja sur ce palier, son annulation est deja programmee, ou un abonnement est deja en cours de paiement.",
});

/** AC10 : aucun detail de l'erreur Stripe n'est renvoye au client. */
export const stripeUnavailable = (): ApiError => ({
  status: 502,
  code: "STRIPE_UNAVAILABLE",
  message: "Le service de paiement est indisponible. Reessayer plus tard.",
});

/** AC7 : ni le secret, ni la signature attendue, ni le corps. */
export const invalidSignature = (): ApiError => ({
  status: 400,
  code: "INVALID_SIGNATURE",
  message: "Signature invalide.",
});

/** Tranche 003, AC8 : une invitation en attente et non expiree existe pour (organisation, e-mail). */
export const invitationAlreadyPending = (): ApiError => ({
  status: 409,
  code: "INVITATION_ALREADY_PENDING",
  message: "Une invitation est deja en attente pour cette adresse.",
});

/** Tranche 003, AC12 (D-086 Q-2) : l'adresse est deja celle d'un membre, owner compris. */
export const alreadyMember = (): ApiError => ({
  status: 409,
  code: "ALREADY_MEMBER",
  message: "Cette adresse est deja celle d'un membre de l'organisation.",
});

/*
 * Tranche 006 (acceptation, `acceptInvitation`) : messages fixes, identiques
 * d'une invitation a l'autre, sans adresse, nom d'organisation, identifiant
 * ni code SQL (AC10, D-107). Inconnu et malforme partagent le meme corps
 * (AC3).
 */

export const invitationNotFound = (): ApiError => ({
  status: 404,
  code: "INVITATION_NOT_FOUND",
  message: "Invitation introuvable.",
});

export const invitationExpired = (): ApiError => ({
  status: 410,
  code: "INVITATION_EXPIRED",
  message: "Cette invitation a expire. Demander une nouvelle invitation a l'organisation.",
});

export const invitationAlreadyUsed = (): ApiError => ({
  status: 409,
  code: "INVITATION_ALREADY_USED",
  message: "Cette invitation a deja ete utilisee.",
});

/** D-102 Q-2 : message fixe, ni l'adresse invitee ni celle du compte. */
export const invitationEmailMismatch = (): ApiError => ({
  status: 403,
  code: "INVITATION_EMAIL_MISMATCH",
  message: "Cette invitation est adressee a une autre adresse e-mail que celle du compte connecte.",
});

/** P-5 : meme code que l'emission (003), message adresse a l'invite ; l'invitation n'est pas consommee. */
export const alreadyMemberOnAcceptance = (): ApiError => ({
  status: 409,
  code: "ALREADY_MEMBER",
  message: "Le compte connecte est deja membre de cette organisation.",
});

/**
 * Tranche 004, AC3 (US-05.3) : une collection de l'organisation porte deja ce
 * nom, casse et espaces de bord ignores. Message fixe : ni le nom soumis, ni la
 * contrainte, ni le code SQL (D-114 point 4).
 */
export const collectionNameTaken = (): ApiError => ({
  status: 409,
  code: "COLLECTION_NAME_TAKEN",
  message: "Une collection de cette organisation porte deja ce nom.",
});

/** AC14 (002) et AC13 (003) : 5xx, aucun detail interne. */
export const serviceUnavailable = (): ApiError => ({
  status: 503,
  code: "SERVICE_UNAVAILABLE",
  message: "Service momentanement indisponible. Reessayer plus tard.",
});
