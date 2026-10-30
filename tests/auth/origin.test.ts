/**
 * Tranche 014 — preuve du controle d'origine de better-auth 1.7.7 sur
 * `sign-up/email` et `sign-in/email`, sur le serveur de test du globalSetup
 * (sans `TEST` ni `VITEST` : le controle est actif).
 *
 * Les lectures en base sont des verifications de test sur des comptes crees
 * par le test, filtrees par adresse ou par identifiant d'utilisateur.
 */
import { request } from "node:http";
import { describe, it, expect, afterAll } from "vitest";
import { baseUrl, signUp, uniqueEmail } from "../helpers/auth";
import { asBypassRls, closeAllPools } from "../helpers/db";

const PASSWORD = "mot-de-passe-de-test";
const FOREIGN_ORIGIN = "https://piege.invalid";

afterAll(async () => {
  await closeAllPools();
});

function appOrigin(): string {
  return new URL(baseUrl()).origin;
}

interface Observed {
  status: number;
  rawBody: string;
  code: string | undefined;
  setCookies: string[];
}

function codeOf(rawBody: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed === "object" && parsed !== null && "code" in parsed) {
      const { code } = parsed;
      return typeof code === "string" ? code : undefined;
    }
  } catch {
    // corps non JSON : `code` reste indefini, le corps brut est dans le message d'echec
  }
  return undefined;
}

/** Message d'echec honnete : vrai statut et corps brut complet. */
function describeObserved(label: string, o: Observed): string {
  return `${label} : statut ${o.status}, corps brut ${o.rawBody}, set-cookie ${JSON.stringify(o.setCookies)}`;
}

function hasSessionCookie(o: Observed): boolean {
  return o.setCookies.some((c) => c.split("=")[0]?.includes("session_token") ?? false);
}

/** Requete par `fetch` ; `headers` est exactement ce qui est pose (aucun Origin par defaut). */
async function viaFetch(path: string, payload: object, headers: Record<string, string>): Promise<Observed> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
  const rawBody = await response.text();
  return {
    status: response.status,
    rawBody,
    code: codeOf(rawBody),
    setCookies: response.headers.getSetCookie(),
  };
}

const signUpPath = "/api/auth/sign-up/email";
const signInPath = "/api/auth/sign-in/email";

function signUpPayload(email: string): object {
  return { email, password: PASSWORD, name: "Test Origine" };
}

function signInPayload(email: string): object {
  return { email, password: PASSWORD };
}

async function userRows(email: string): Promise<{ id: string }[]> {
  return asBypassRls(async (client) => (await client.query<{ id: string }>("SELECT id FROM app_user WHERE email = $1", [email])).rows);
}

async function accountCount(email: string): Promise<number> {
  return asBypassRls(async (client) => {
    const result = await client.query<{ n: string }>(
      "SELECT count(*) AS n FROM account a JOIN app_user u ON u.id = a.user_id WHERE u.email = $1",
      [email],
    );
    return Number(result.rows[0]?.n ?? "0");
  });
}

async function sessionCount(userId: string): Promise<number> {
  return asBypassRls(async (client) => {
    const result = await client.query<{ n: string }>("SELECT count(*) AS n FROM session WHERE user_id = $1", [userId]);
    return Number(result.rows[0]?.n ?? "0");
  });
}

function expectRefused(o: Observed, code: string, label: string): void {
  expect(o.status, describeObserved(label, o)).toBe(403);
  expect(o.code, describeObserved(label, o)).toBe(code);
  expect(hasSessionCookie(o), describeObserved(`${label} (cookie de session pose)`, o)).toBe(false);
}

async function expectNoAccount(email: string): Promise<void> {
  expect(await userRows(email), "aucune ligne app_user").toHaveLength(0);
  expect(await accountCount(email), "aucune ligne account").toBe(0);
}

describe("AC1 : inscription depuis une origine etrangere", () => {
  it("AC1 : Origin etrangere -> 403 INVALID_ORIGIN, aucun cookie de session, aucun compte", async () => {
    const email = uniqueEmail("ac1");
    const result = await viaFetch(signUpPath, signUpPayload(email), { Origin: FOREIGN_ORIGIN });
    expectRefused(result, "INVALID_ORIGIN", "inscription, origine etrangere");
    await expectNoAccount(email);
  });
});

describe("AC2 : connexion depuis une origine etrangere", () => {
  it("AC2 : bons identifiants, Origin etrangere -> 403 INVALID_ORIGIN, aucun cookie, sessions inchangees", async () => {
    const account = await signUp({ password: PASSWORD });
    const before = await sessionCount(account.userId);

    const result = await viaFetch(signInPath, signInPayload(account.email), { Origin: FOREIGN_ORIGIN });

    expectRefused(result, "INVALID_ORIGIN", "connexion, origine etrangere");
    expect(await sessionCount(account.userId)).toBe(before);
  });
});

describe("AC3 : controle positif (bonne origine)", () => {
  it("AC3 : inscription avec l'origine de l'application -> 200, cookie de session, app_user cree", async () => {
    const email = uniqueEmail("ac3-up");
    const result = await viaFetch(signUpPath, signUpPayload(email), { Origin: appOrigin() });
    expect(result.status, describeObserved("inscription, bonne origine", result)).toBe(200);
    expect(hasSessionCookie(result), describeObserved("inscription, bonne origine", result)).toBe(true);
    expect(await userRows(email)).toHaveLength(1);
  });

  it("AC3 : connexion avec l'origine de l'application -> 200, cookie de session, une session de plus", async () => {
    const account = await signUp({ password: PASSWORD });
    const before = await sessionCount(account.userId);

    const result = await viaFetch(signInPath, signInPayload(account.email), { Origin: appOrigin() });

    expect(result.status, describeObserved("connexion, bonne origine", result)).toBe(200);
    expect(hasSessionCookie(result), describeObserved("connexion, bonne origine", result)).toBe(true);
    expect(await sessionCount(account.userId)).toBe(before + 1);
  });
});

describe("AC4 : Origin null", () => {
  it("AC4 : inscription avec Origin: null -> 403 MISSING_OR_NULL_ORIGIN, aucun compte", async () => {
    const email = uniqueEmail("ac4-up");
    const result = await viaFetch(signUpPath, signUpPayload(email), { Origin: "null" });
    expectRefused(result, "MISSING_OR_NULL_ORIGIN", "inscription, Origin null");
    await expectNoAccount(email);
  });

  it("AC4 : connexion avec Origin: null -> 403 MISSING_OR_NULL_ORIGIN, sessions inchangees", async () => {
    const account = await signUp({ password: PASSWORD });
    const before = await sessionCount(account.userId);
    const result = await viaFetch(signInPath, signInPayload(account.email), { Origin: "null" });
    expectRefused(result, "MISSING_OR_NULL_ORIGIN", "connexion, Origin null");
    expect(await sessionCount(account.userId)).toBe(before);
  });
});

describe("AC5 : fetch sans Origin (Node ajoute sec-fetch-mode: cors)", () => {
  it("AC5 : inscription sans Origin -> 403 MISSING_OR_NULL_ORIGIN, aucun compte", async () => {
    const email = uniqueEmail("ac5-up");
    const result = await viaFetch(signUpPath, signUpPayload(email), {});
    expectRefused(result, "MISSING_OR_NULL_ORIGIN", "inscription fetch sans Origin");
    await expectNoAccount(email);
  });

  it("AC5 : connexion sans Origin -> 403 MISSING_OR_NULL_ORIGIN, sessions inchangees", async () => {
    const account = await signUp({ password: PASSWORD });
    const before = await sessionCount(account.userId);
    const result = await viaFetch(signInPath, signInPayload(account.email), {});
    expectRefused(result, "MISSING_OR_NULL_ORIGIN", "connexion fetch sans Origin");
    expect(await sessionCount(account.userId)).toBe(before);
  });
});

/** Requete `node:http` construite a la main ; renvoie aussi les en-tetes effectivement poses. */
function viaHttp(path: string, payload: object): Promise<Observed & { sentHeaders: string[] }> {
  const body = JSON.stringify(payload);
  const target = new URL(baseUrl());
  return new Promise((resolve, reject) => {
    const req = request(
      {
        method: "POST",
        hostname: target.hostname,
        port: target.port,
        path,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf8");
          const setCookie = res.headers["set-cookie"] ?? [];
          resolve({
            status: res.statusCode ?? 0,
            rawBody,
            code: codeOf(rawBody),
            setCookies: setCookie,
            sentHeaders: sent,
          });
        });
        res.on("error", reject);
      },
    );
    const sent = Object.keys(req.getHeaders()).map((name) => name.toLowerCase());
    req.on("error", reject);
    req.end(body);
  });
}

function expectNoBrowserHints(sentHeaders: string[]): void {
  const forbidden = sentHeaders.filter((n) => n === "origin" || n === "referer" || n === "cookie" || n.startsWith("sec-fetch-"));
  expect(forbidden, `en-tetes de navigateur envoyes : ${JSON.stringify(sentHeaders)}`).toEqual([]);
}

describe("AC6 : client sans aucun en-tete de navigateur (constat)", () => {
  it("AC6 : inscription node:http sans Origin, Referer, Cookie ni sec-fetch-* -> acceptee, compte cree", async () => {
    const email = uniqueEmail("ac6-up");
    const result = await viaHttp(signUpPath, signUpPayload(email));
    expectNoBrowserHints(result.sentHeaders);
    expect(result.status, describeObserved("inscription node:http", result)).toBe(200);
    expect(hasSessionCookie(result), describeObserved("inscription node:http", result)).toBe(true);
    expect(await userRows(email)).toHaveLength(1);
  });

  it("AC6 : connexion node:http sans Origin, Referer, Cookie ni sec-fetch-* -> acceptee, une session de plus", async () => {
    const account = await signUp({ password: PASSWORD });
    const before = await sessionCount(account.userId);
    const result = await viaHttp(signInPath, signInPayload(account.email));
    expectNoBrowserHints(result.sentHeaders);
    expect(result.status, describeObserved("connexion node:http", result)).toBe(200);
    expect(hasSessionCookie(result), describeObserved("connexion node:http", result)).toBe(true);
    expect(await sessionCount(account.userId)).toBe(before + 1);
  });
});
