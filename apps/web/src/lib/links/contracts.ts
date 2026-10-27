/**
 * Point d'import unique du contrat `links` (meme role que
 * `lib/collections/contracts.ts`) : la route de la tranche 005 valide son
 * entree avec ce schema, jamais avec une copie. Seul `addLink` est implemente
 * ici (`listLinks` : tranche 009).
 */
export { addLink } from "../../../../../docs/02-architecture/api-contracts/links";
