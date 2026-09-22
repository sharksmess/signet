import { z } from "zod";

/**
 * Forme commune a tout contrat de route. Un contrat est importe tel quel par
 * le Route Handler (ou la Server Action) qui l'implemente ET par les tests
 * d'acceptation de la tranche correspondante — il n'existe qu'une seule
 * source de verite pour "a quoi ressemble cette route".
 *
 * `errors` liste tous les codes de sortie non-2xx avec leur declencheur
 * EXACT : contract-guardian compare cette liste a chaque tranche pour
 * detecter un code supprime, renomme, ou un declencheur qui a change de
 * sens.
 */
export interface ApiContract<Input extends z.ZodTypeAny, Output extends z.ZodTypeAny> {
  route: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Role minimal requis, verifie APRES l'appartenance a l'organisation (voir ADR-0004). "public" = aucune authentification. */
  minRole: "public" | "member" | "owner";
  input: Input;
  output: Output;
  errors: Array<{
    status: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 502;
    code: string;
    trigger: string;
  }>;
  /**
   * Rejouabilite sans effet de bord supplementaire, et cle de deduplication
   * le cas echeant. "non-idempotent" doit etre justifie : c'est l'exception,
   * pas le defaut.
   */
  idempotency: string;
}

export const OrganizationRole = z.enum(["owner", "member"]);

export const Uuid = z.string().uuid();
