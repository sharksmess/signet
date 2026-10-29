/**
 * Message d'un formulaire (texte de la liste fermee de `messages.ts`, jamais
 * une valeur soumise ni un message brut de reponse) et suite proposee apres une
 * session expiree (`401`) sur un formulaire prive : lien vers `/connexion`.
 */
import Link from "next/link";
import { MESSAGES } from "../messages";

export function FormMessage(props: { message: string | null; offerSignIn?: boolean }) {
  if (props.message === null) return null;
  return (
    <p role="alert" className="message">
      {props.message}
      {props.offerSignIn === true && props.message === MESSAGES.sessionExpired ? (
        <>
          {" "}
          <Link href="/connexion">Se connecter</Link>
        </>
      ) : null}
    </p>
  );
}
