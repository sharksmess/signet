/** Accueil (tranche 012) : renvoi vers `/organisations` avec session, `/connexion` sinon. */
import { redirect } from "next/navigation";
import { readPageSession } from "@/ui/session";

export default async function HomePage(): Promise<never> {
  const session = await readPageSession();
  redirect(session === null ? "/connexion" : "/organisations");
}
