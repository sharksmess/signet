/**
 * Erreurs metier typees (regle absolue CLAUDE.md : "les erreurs metier
 * attendues sont des valeurs de retour typees. `throw` est reserve aux
 * invariants qui ne devraient jamais arriver."). Chaque code correspond
 * exactement a un `errors[]` de `docs/02-architecture/api-contracts/organizations.ts`
 * ou `subscriptions.ts` (tranche 002 ; `SERVICE_UNAVAILABLE` : webhook,
 * AC14, file d'attente indisponible, D-070), ou `invitations.ts` (tranche 003 :
 * `INVITATION_ALREADY_PENDING`, `ALREADY_MEMBER`, et `SERVICE_UNAVAILABLE` quand
 * la file refuse l'evenement d'invitation, D-086 Q-2, Q-3).
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
  | "ALREADY_MEMBER";

export interface ApiError {
  status: 400 | 401 | 403 | 404 | 409 | 422 | 502 | 503;
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

/** AC14 (002) et AC13 (003) : 5xx, aucun detail interne. */
export const serviceUnavailable = (): ApiError => ({
  status: 503,
  code: "SERVICE_UNAVAILABLE",
  message: "Service momentanement indisponible. Reessayer plus tard.",
});
