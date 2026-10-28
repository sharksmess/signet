/**
 * Helpers de la tranche 012 (ecrans) : lecture des pages rendues par le serveur
 * de test (build de production demarre par le globalSetup), extraction du HTML
 * et arrangements par les vraies routes.
 *
 * Une « reponse complete » (contrat de la tranche) = le HTML ET la charge RSC de
 * la meme page (meme adresse, en-tete `RSC: 1`). Les assertions d'absence
 * portent sur les deux.
 *
 * Messages d'echec : tout helper qui attend un statut affiche le VRAI statut HTTP
 * et le corps BRUT complet de la reponse (jamais un JSON avale en `undefined`).
 *
 * MARQUEURS DE PAGE (fixes par ces tests, l'implementation s'y conforme ; ce sont
 * des valeurs fixes, jamais une valeur libre) :
 *   - lignes de liste : elements `<li data-testid="...">` ;
 *       organization-row (page /organisations), collection-row, member-row
 *       (page d'organisation), link-row (page de collection) ;
 *     chaque ligne contient son `<a href>` quand elle en a un ;
 *   - blocs : `data-testid="subscription-block"` (owner seul),
 *       `invite-form` (owner seul), `create-organization-form`,
 *       `create-collection-form`, `add-link-form`, `sign-in-form`, `sign-up-form` ;
 *   - etats vides : `empty-organizations`, `empty-collections`, `empty-links` ;
 *   - dans une ligne de lien : `link-hostname` (nom d'hote), `link-author`
 *       (auteur), `link-date` (date) ;
 *   - dans une ligne de membre : le role est ecrit tel que le contrat le rend
 *       (`owner` ou `member`).
 */
import { baseUrl, type AuthenticatedSession } from "./auth";
import { expectStatus, type HttpResult } from "./billing";
import { asBypassRls } from "./db";
import { asAppCommitted, insertLink } from "./links";

// ---------------------------------------------------------------------------
// Lecture des pages
// ---------------------------------------------------------------------------

export interface PageResult {
  status: number;
  /** Valeur brute de l'en-tete `Location` (absente : null). */
  location: string | null;
  contentType: string | null;
  /** Corps brut complet. */
  text: string;
}

/** `cookie` : paire `nom=valeur` (celle de `AuthenticatedSession.cookie`), ou null (aucune session). `redirect: "manual"` : un 307 reste un 307. */
export async function getPage(path: string, cookie: string | null, options?: { rsc?: boolean }): Promise<PageResult> {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  if (options?.rsc) headers.RSC = "1";
  const response = await fetch(`${baseUrl()}${path}`, { method: "GET", headers, redirect: "manual" });
  return {
    status: response.status,
    location: response.headers.get("location"),
    contentType: response.headers.get("content-type"),
    text: await response.text(),
  };
}

export interface FullPage {
  path: string;
  html: PageResult;
  rsc: PageResult;
}

/** HTML et charge RSC de la meme page. */
export async function getFullPage(path: string, session: AuthenticatedSession | string | null): Promise<FullPage> {
  const cookie = session === null ? null : typeof session === "string" ? session : session.cookie;
  const html = await getPage(path, cookie);
  const rsc = await getPage(path, cookie, { rsc: true });
  return { path, html, rsc };
}

/** Texte des deux formes, pour les assertions d'absence. */
export function bothOf(page: FullPage): { label: string; text: string }[] {
  return [
    { label: "HTML", text: page.html.text },
    { label: "charge RSC", text: page.rsc.text },
  ];
}

/** Echoue avec le vrai statut et le corps brut complet si le statut du HTML differe. */
export function expectPageStatus(page: PageResult, expected: number, label: string): void {
  if (page.status !== expected) {
    throw new Error(`${label} : HTTP ${page.status} recu, ${expected} attendu. Location : ${page.location}. Corps brut : ${page.text}`);
  }
}

/** Statut attendu pour le HTML et, sauf `rscStatus` different, pour la charge RSC. */
export function expectFullStatus(page: FullPage, expected: number, label: string): void {
  expectPageStatus(page.html, expected, `${label} (HTML ${page.path})`);
  expectPageStatus(page.rsc, expected, `${label} (RSC ${page.path})`);
}

/** Echoue (avec le corps) si l'un des textes interdits figure dans le HTML ou la charge RSC. */
export function expectAbsent(page: FullPage, forbidden: readonly string[], label: string): void {
  for (const { label: where, text } of bothOf(page)) {
    for (const needle of forbidden) {
      if (needle.length === 0) continue;
      if (text.includes(needle)) {
        throw new Error(`${label} : ${JSON.stringify(needle)} ne doit pas figurer dans ${where} de ${page.path}. Corps brut : ${text}`);
      }
    }
  }
}

/** Remplace (sans tenir compte de la casse) chaque identifiant demande par un jeton fixe. */
export function replaceIds(text: string, replacements: readonly (readonly [string, string])[]): string {
  let result = text;
  for (const [value, token] of replacements) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "gi"), token);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Extraction du HTML
// ---------------------------------------------------------------------------

export function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, "&");
}

function withoutScripts(html: string): string {
  return html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "");
}

/** Texte visible du HTML : scripts et balises retires, entites decodees, espaces reduits. */
export function textOf(html: string): string {
  return decodeEntities(withoutScripts(html).replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

export type Attributes = Record<string, string>;

export interface Tag {
  name: string;
  attributes: Attributes;
}

/** Toutes les balises ouvrantes du HTML (hors scripts), avec leurs attributs decodes. */
export function allTags(html: string): Tag[] {
  const tags: Tag[] = [];
  for (const match of withoutScripts(html).matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=`]+))?)*)\s*\/?>/g)) {
    const attributes: Attributes = {};
    for (const attribute of (match[2] ?? "").matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>=`]+)))?/g)) {
      attributes[(attribute[1] ?? "").toLowerCase()] = decodeEntities(attribute[2] ?? attribute[3] ?? attribute[4] ?? "");
    }
    tags.push({ name: (match[1] ?? "").toLowerCase(), attributes });
  }
  return tags;
}

export function tagsNamed(html: string, name: string): Tag[] {
  return allTags(html).filter((tag) => tag.name === name);
}

export function hasTestId(html: string, testId: string): boolean {
  return allTags(html).some((tag) => tag.attributes["data-testid"] === testId);
}

/** Contenu interne (HTML) des elements `<li data-testid="testId">`, dans l'ordre du document. */
export function rowsOf(html: string, testId: string): string[] {
  const rows: string[] = [];
  const source = withoutScripts(html);
  for (const match of source.matchAll(/<li\b[^>]*>/g)) {
    const opening = match[0];
    if (!new RegExp(`\\bdata-testid\\s*=\\s*["']${testId}["']`).test(opening)) continue;
    const start = (match.index ?? 0) + opening.length;
    const end = source.indexOf("</li>", start);
    rows.push(end < 0 ? source.slice(start) : source.slice(start, end));
  }
  return rows;
}

/** Texte de l'element portant `data-testid="testId"` a l'interieur d'un fragment de ligne (span, p, a, div, time, code). */
export function testIdText(fragment: string, testId: string): string | undefined {
  const match = new RegExp(`<([a-zA-Z0-9]+)\\b[^>]*\\bdata-testid\\s*=\\s*["']${testId}["'][^>]*>([\\s\\S]*?)</\\1>`).exec(fragment);
  return match?.[2] === undefined ? undefined : textOf(match[2]);
}

/** Valeurs des attributs `href` des liens d'un fragment, dans l'ordre. */
export function hrefsOf(fragment: string): string[] {
  return tagsNamed(fragment, "a").flatMap((tag) => (tag.attributes.href === undefined ? [] : [tag.attributes.href]));
}

/** Identifiants des organisations de la page `/organisations`, dans l'ordre : `href="/organisations/<uuid>"` des lignes `organization-row`. */
export function organizationIdsOf(html: string): string[] {
  return rowsOf(html, "organization-row").flatMap((row) =>
    hrefsOf(row).flatMap((href) => {
      const id = /^\/organisations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(href)?.[1];
      return id === undefined ? [] : [id];
    }),
  );
}

/** Identifiants des collections de la page d'organisation, dans l'ordre. */
export function collectionIdsOf(html: string, organizationId: string): string[] {
  const prefix = `/organisations/${organizationId}/collections/`;
  return rowsOf(html, "collection-row").flatMap((row) =>
    hrefsOf(row).flatMap((href) => (href.startsWith(prefix) ? [href.slice(prefix.length)] : [])),
  );
}

/** Date au format fixe `AAAA-MM-JJ HH:MM UTC` (L-5). */
export function formatUtc(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

// ---------------------------------------------------------------------------
// Arrangements (vraies routes ; insertion directe sous le role applicatif pour les liens)
// ---------------------------------------------------------------------------

/**
 * Lien insere sous `signet_app` avec le contexte de l'organisation (donc par le
 * declencheur de compteur), sans passer par la route : permet des titres et des
 * URL que la route refuserait ou normaliserait. Rend l'identifiant du lien.
 */
export async function addLinkDirect(input: {
  organizationId: string;
  collectionId: string;
  userId: string;
  url: string;
  title: string;
}): Promise<string> {
  return asAppCommitted({ organizationId: input.organizationId, userId: input.userId }, (client) => insertLink(client, input));
}

/** Retire un membre sous administration (arrangement : auteur qui n'est plus membre, L-4). */
export async function removeMemberDirect(organizationId: string, userId: string): Promise<void> {
  await asBypassRls(async (client) => {
    await client.query("DELETE FROM member WHERE organization_id = $1 AND user_id = $2 AND role = 'member'", [organizationId, userId]);
  });
}

/** Attend un statut HTTP precis d'un resultat d'API ; reexporte pour les fichiers de test. */
export function expectApiStatus(result: HttpResult, expected: number, label: string): void {
  expectStatus(result, expected, label);
}

// ---------------------------------------------------------------------------
// Valeurs de test (visiblement fausses)
// ---------------------------------------------------------------------------

export const SCRIPT_TRAP = "<script>alert(1)</script>";
export const IMG_TRAP = '"><img src=x onerror=alert(1)>';
export const JS_TRAP = "javascript:alert(1)";
export const RLO = "‮";
export const ZWSP = "​";

/** Liste fermee de L-8 / D-144 : U+202A..U+202E, U+2066..U+2069, U+200E, U+200F, U+061C, U+200B, U+2060, U+FEFF. */
export const MARKED_CODE_POINTS: readonly number[] = [
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200e, 0x200f, 0x061c, 0x200b, 0x2060, 0xfeff,
];

export function markerOf(codePoint: number): string {
  return `[U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}]`;
}

let counter = 0;
/** Nom d'organisation unique, visiblement faux. */
export function uniqueOrgName(label = "ecran"): string {
  counter += 1;
  return `Org-Test-${label}-${Date.now()}-${counter}`;
}
