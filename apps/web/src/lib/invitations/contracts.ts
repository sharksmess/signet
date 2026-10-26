/**
 * Point d'import unique du contrat `invitations` (meme role que
 * `lib/contracts.ts` et `lib/billing/contracts.ts`) : la route de la tranche
 * 003 valide son entree avec ce schema, jamais avec une copie.
 *
 * `normalizedEmail` complete le contrat sans le contredire (AC7) : le contrat
 * retire les espaces et verifie la forme ; la forme enregistree, comparee et
 * renvoyee est en minuscules, et ne depasse pas 254 caracteres (RFC 5321,
 * memes regles que `app_user.email` et `invitation.email`, ERD §2.1, §5).
 */
import { z } from "zod";

export { acceptInvitation, createInvitation } from "../../../../../docs/02-architecture/api-contracts/invitations";

export const normalizedEmail = z
  .string()
  .transform((value) => value.toLowerCase())
  .pipe(z.string().max(254).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/));
