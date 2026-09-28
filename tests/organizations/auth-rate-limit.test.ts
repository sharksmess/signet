/**
 * Configuration du limiteur de debit better-auth (ADR-0010), testee sans HTTP.
 *
 * Range ici plutot que sous tests/auth/ : le perimetre de la tranche 001 ne
 * couvre que tests/organizations/**, et l'inscription est la porte d'entree
 * du parcours de creation d'organisation.
 *
 * Le limiteur ne se desactive que si AUTH_RATE_LIMIT=off ET APP_ENV=test.
 * Toute autre combinaison avec off doit empecher le demarrage : une erreur de
 * configuration ferme, elle n'ouvre jamais le limiteur.
 */
import { describe, it, expect } from "vitest";
import { buildRateLimitOptions } from "../../apps/web/src/lib/auth-rate-limit";

describe("buildRateLimitOptions", () => {
  it("par defaut (aucune variable) : limiteur actif, sign-up limite a 3 par 10 s", () => {
    const options = buildRateLimitOptions({});

    expect(options.enabled).toBe(true);
    expect(options.customRules["/sign-up/*"]).toEqual({ window: 10, max: 3 });
  });

  it("AUTH_RATE_LIMIT=on explicite en production : limiteur actif", () => {
    const options = buildRateLimitOptions({ AUTH_RATE_LIMIT: "on", APP_ENV: "production" });

    expect(options.enabled).toBe(true);
    expect(options.customRules["/sign-up/*"]).toEqual({ window: 10, max: 3 });
  });

  it("off + production : leve au demarrage", () => {
    expect(() => buildRateLimitOptions({ AUTH_RATE_LIMIT: "off", APP_ENV: "production" })).toThrow(
      /AUTH_RATE_LIMIT=off/,
    );
  });

  it("off + development : leve au demarrage", () => {
    expect(() => buildRateLimitOptions({ AUTH_RATE_LIMIT: "off", APP_ENV: "development" })).toThrow(
      /AUTH_RATE_LIMIT=off/,
    );
  });

  it("off sans APP_ENV (production par defaut) : leve au demarrage", () => {
    expect(() => buildRateLimitOptions({ AUTH_RATE_LIMIT: "off" })).toThrow(/AUTH_RATE_LIMIT=off/);
  });

  it("off + test : limiteur desactive", () => {
    const options = buildRateLimitOptions({ AUTH_RATE_LIMIT: "off", APP_ENV: "test" });

    expect(options.enabled).toBe(false);
  });

  it.each([
    ["AUTH_RATE_LIMIT inconnue", { AUTH_RATE_LIMIT: "false", APP_ENV: "test" }],
    ["AUTH_RATE_LIMIT vide", { AUTH_RATE_LIMIT: "", APP_ENV: "test" }],
    ["APP_ENV inconnu", { AUTH_RATE_LIMIT: "off", APP_ENV: "staging" }],
  ])("valeur invalide (%s) : leve au demarrage, jamais d'ouverture", (_label, env) => {
    expect(() => buildRateLimitOptions(env)).toThrow();
  });
});
