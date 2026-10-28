/**
 * Point d'import unique du contrat `links` (meme role que
 * `lib/collections/contracts.ts`) : les routes valident leur entree avec ces
 * schemas, jamais avec une copie. `addLink` : tranche 005 ; `listLinks` :
 * tranche 009.
 */
export { addLink, listLinks } from "../../../../../docs/02-architecture/api-contracts/links";
