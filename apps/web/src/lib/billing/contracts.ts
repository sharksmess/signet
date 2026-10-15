/**
 * Point d'import unique du contrat `subscriptions` (meme role que
 * `lib/contracts.ts` pour `organizations`) : les routes de la tranche 002
 * valident leurs entrees avec ces schemas, jamais avec une copie.
 */
export { changeTier, getSubscription } from "../../../../../docs/02-architecture/api-contracts/subscriptions";
