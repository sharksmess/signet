/**
 * Erreurs metier typees (regle absolue CLAUDE.md : "les erreurs metier
 * attendues sont des valeurs de retour typees. `throw` est reserve aux
 * invariants qui ne devraient jamais arriver."). Chaque code correspond
 * exactement a un `errors[]` de `docs/02-architecture/api-contracts/organizations.ts`.
 */

export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "VALIDATION_FAILED"
  | "ORGANIZATION_NOT_FOUND"
  | "INSUFFICIENT_ROLE";

export interface ApiError {
  status: 401 | 403 | 404 | 422;
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
