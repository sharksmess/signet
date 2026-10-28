/**
 * Inscription avec organisation (tranche 012, D-144 Q-1) : publique ; avec
 * session, renvoi vers `/organisations`. Trois champs : adresse, mot de passe,
 * nom de l'organisation.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/ui/forms/sign-up-form";
import { readPageSession } from "@/ui/session";

export default async function SignUpPage() {
  const session = await readPageSession();
  if (session !== null) redirect("/organisations");
  return (
    <>
      <h1>Inscription</h1>
      <SignUpForm withOrganization />
      <p>
        Deja un compte ? <Link href="/connexion">Se connecter</Link>
      </p>
    </>
  );
}
