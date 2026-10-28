/** Connexion (tranche 012) : publique ; avec session, renvoi vers `/organisations`. */
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "@/ui/forms/sign-in-form";
import { readPageSession } from "@/ui/session";

export default async function SignInPage() {
  const session = await readPageSession();
  if (session !== null) redirect("/organisations");
  return (
    <>
      <h1>Connexion</h1>
      <SignInForm after="organisations" />
      <p>
        Pas encore de compte ? <Link href="/inscription">Creer un compte</Link>
      </p>
    </>
  );
}
