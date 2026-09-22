import { z } from "zod";
import { ApiContract, Uuid } from "./_contract";

/**
 * US-06 — Ajout d'un lien. Le refus de quota (US-06.4, risque #3 du PRD) est
 * applique de facon procedurale par le trigger AFTER INSERT sur `link` (ERD
 * §7, ADR-0002, mise a jour du 2026-09-22 : le quota s'applique au flux, pas
 * comme contrainte statique sur le stock — une retrogradation Pro -> Free
 * au-dessus de 50 liens reste possible et ne bloque jamais l'existant) —
 * cette route ne fait que relayer le refus typé, jamais lire-puis-decider en
 * deux temps applicatifs. La violation remonte de la base sous le SQLSTATE
 * personnalise `SG001` (ou `40001` en isolation stricte) ; le Route Handler
 * DOIT traduire les deux en FREE_TIER_QUOTA_EXCEEDED, jamais en 500
 * (ADR-0002, consequence acceptee).
 */
const addLinkInput = z.object({
  organizationId: Uuid,
  collectionId: Uuid,
  /** Forme alignee sur la contrainte `link.url` de l'ERD : http(s) uniquement, 8-2048 caracteres. */
  url: z.string().trim().min(8).max(2048).regex(/^https?:\/\/\S+$/, "url doit commencer par http:// ou https://"),
  title: z.string().trim().min(1).max(200),
});

const addLinkOutput = z.object({
  id: Uuid,
  collectionId: Uuid,
  url: z.string().url(),
  title: z.string(),
  addedBy: Uuid,
  createdAt: z.string().datetime(),
});

export const addLink: ApiContract<typeof addLinkInput, typeof addLinkOutput> = {
  route: "/api/organizations/:organizationId/collections/:collectionId/links",
  method: "POST",
  minRole: "member",
  input: addLinkInput,
  output: addLinkOutput,
  errors: [
    { status: 401, code: "UNAUTHENTICATED", trigger: "aucune session valide" },
    { status: 404, code: "ORGANIZATION_NOT_FOUND", trigger: "organizationId inexistant, ou appelant non membre" },
    { status: 404, code: "COLLECTION_NOT_FOUND", trigger: "collectionId inexistant, ou appartenant a une autre organisation" },
    { status: 422, code: "VALIDATION_FAILED", trigger: "url malformee (US-06.2), ou title vide / > 200 caracteres" },
    { status: 409, code: "FREE_TIER_QUOTA_EXCEEDED", trigger: "organisation sur le palier Free et deja a 50 liens tous collections confondues (US-06.4) : le 51e est refuse, aucun lien cree" },
  ],
  idempotency:
    "non-idempotente : chaque appel reussi cree un nouveau lien, meme si url est identique a un lien existant (le PRD n'exige aucune deduplication d'URL au sein d'une collection ou d'une organisation).",
};

/**
 * US-07 — Consultation des liens d'une collection, tries du plus recent au
 * plus ancien par defaut (US-07.2).
 */
const listLinksInput = z.object({
  organizationId: Uuid,
  collectionId: Uuid,
});

const listLinksOutput = z.array(
  z.object({
    id: Uuid,
    url: z.string().url(),
    title: z.string(),
    addedBy: Uuid,
    createdAt: z.string().datetime(),
  }),
);

export const listLinks: ApiContract<typeof listLinksInput, typeof listLinksOutput> = {
  route: "/api/organizations/:organizationId/collections/:collectionId/links",
  method: "GET",
  minRole: "member",
  input: listLinksInput,
  output: listLinksOutput,
  errors: [
    { status: 401, code: "UNAUTHENTICATED", trigger: "aucune session valide (US-07.3 : aucun acces sans authentification)" },
    { status: 404, code: "ORGANIZATION_NOT_FOUND", trigger: "organizationId inexistant, ou appelant non membre (US-07.1 / US-09.2)" },
    { status: 404, code: "COLLECTION_NOT_FOUND", trigger: "collectionId inexistant, ou appartenant a une autre organisation" },
  ],
  idempotency: "idempotente par nature : lecture seule. Le tri (createdAt desc) est un contrat garanti, pas un detail d'implementation.",
};
