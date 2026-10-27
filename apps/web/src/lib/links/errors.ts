/**
 * Traduction des erreurs SQL de l'ajout de lien (tranche 005, D-123, AC10).
 *
 * Fonction pure, sans acces a la base : c'est elle que la couche d'ajout
 * (`./links.ts`) utilise, jamais une copie.
 *
 * - `SG001` : refus de quota leve par `signet.link_usage_on_insert()`
 *   (ADR-0002, ERD §7) ;
 * - `40001` : echec de serialisation, ce que recevrait la transaction en
 *   attente en isolation stricte. Inatteignable en `READ COMMITTED` (niveau de
 *   `withTenant`), traduit comme l'exige le contrat `links.ts`. Limite
 *   (D-119 lecture 4) : si la route passait un jour en isolation stricte, un
 *   `40001` sur une organisation Pro serait annonce a tort comme un
 *   depassement de quota (a reexaminer alors, ADR-0002) ;
 * - tout autre code, ou `undefined` : `null`, l'appelant rend alors le `500`
 *   generique. Comparaison exacte, sensible a la casse.
 */
import { freeTierQuotaExceeded, type ApiError } from "../errors";

const QUOTA_REFUSAL_CODES: ReadonlySet<string> = new Set(["SG001", "40001"]);

export function linkErrorFromSqlState(code: string | undefined): ApiError | null {
  if (code === undefined || !QUOTA_REFUSAL_CODES.has(code)) return null;
  return freeTierQuotaExceeded();
}
