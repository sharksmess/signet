/**
 * Point d'import unique du contrat `organizations` (lecture seule, cf.
 * docs/03-slices/001-creation-organisation.md "Perimetre de fichiers").
 * Toute route qui implemente ce contrat importe ses schemas Zod d'ici,
 * jamais en redefinissant une validation parallele : une seule source de
 * verite pour "a quoi ressemble cette route" (docs/02-architecture/api-contracts/_contract.ts).
 */
export { createOrganization, renameOrganization } from "../../../../docs/02-architecture/api-contracts/organizations";
