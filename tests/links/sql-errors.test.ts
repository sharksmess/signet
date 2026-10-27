/**
 * Tranche 005 — AC10, traduction des erreurs SQL (D-123) : test unitaire de la
 * fonction pure `linkErrorFromSqlState`, sans base ni serveur. C'est elle que
 * la route utilise ; `SG001` (refus de quota) et `40001` (isolation stricte)
 * donnent le meme `409`, tout autre code donne `null` (l'appelant rend alors
 * le `500` generique).
 */
import { describe, it, expect } from "vitest";
import { linkErrorFromSqlState } from "../../apps/web/src/lib/links/errors";

/** D-119 lecture 2 : message du 409, sans le nombre 50. */
const QUOTA_MESSAGE = "Le quota de liens du palier Free est atteint : aucun lien n'a ete ajoute. Passer au palier Pro pour en ajouter d'autres.";

describe("AC10 — linkErrorFromSqlState", () => {
  it.each(["SG001", "40001"])("AC10 : %s -> 409 FREE_TIER_QUOTA_EXCEEDED, message de D-119 lecture 2", (code) => {
    expect(linkErrorFromSqlState(code)).toEqual({
      status: 409,
      code: "FREE_TIER_QUOTA_EXCEEDED",
      message: QUOTA_MESSAGE,
    });
  });

  it.each(["23505", "23503", "23514", "42501", "P0001", "22P02", "40P01", "SG002", "sg001", " SG001", ""])(
    "AC10 : le code %j n'est pas traduit (null, donc 500 generique chez l'appelant)",
    (code) => {
      expect(linkErrorFromSqlState(code)).toBeNull();
    },
  );

  it("AC10 : undefined -> null", () => {
    expect(linkErrorFromSqlState(undefined)).toBeNull();
  });

  it("AC10 : le message du 409 ne contient ni le nombre 50 ni code SQL", () => {
    const error = linkErrorFromSqlState("SG001");
    expect(error?.message).not.toMatch(/50|SG001|40001/);
  });
});
