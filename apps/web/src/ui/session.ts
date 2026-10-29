/**
 * Lecture de session des pages (tranche 012) : `auth.api.getSession` avec les
 * en-tetes de la requete, une fois par requete. Module serveur uniquement
 * (importe par les composants serveur des pages, jamais par un composant
 * client). `userId` vient toujours d'ici, jamais de l'adresse.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export interface PageSession {
  userId: string;
  email: string;
}

/** Session de la requete, ou `null` (absente, expiree ou cookie invalide). */
export async function readPageSession(): Promise<PageSession | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return { userId: session.user.id, email: session.user.email };
}

/**
 * Page privee : sans session, renvoi `307` vers `/connexion`, sans parametre de
 * retour (L-2), avant tout rendu et toute lecture de donnees.
 */
export async function requirePageSession(): Promise<PageSession> {
  const session = await readPageSession();
  if (session === null) redirect("/connexion");
  return session;
}
