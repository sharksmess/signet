/**
 * Point d'import unique du contrat `collections` (meme role que
 * `lib/contracts.ts` et `lib/invitations/contracts.ts`) : la route de la
 * tranche 004 valide son entree avec ce schema, jamais avec une copie. Seul
 * `createCollection` est implemente ici (liste : 009 ; suppression : 007).
 */
export { createCollection } from "../../../../../docs/02-architecture/api-contracts/collections";
