/**
 * Point d'import unique du contrat `collections` (meme role que
 * `lib/contracts.ts` et `lib/invitations/contracts.ts`) : les routes valident
 * leur entree avec ces schemas, jamais avec une copie. `createCollection` :
 * tranche 004 ; `listCollections` : tranche 009 (suppression : 007).
 */
export { createCollection, listCollections } from "../../../../../docs/02-architecture/api-contracts/collections";
