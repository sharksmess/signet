/**
 * Acceptation d'une invitation (tranche 012, AC11 ; chemin impose par l'e-mail
 * de 003). Publique : coquille sans donnee d'invitation (P-4 ferme). Le jeton
 * est dans le fragment, que le serveur ne recoit jamais ; la chaine de requete
 * n'est pas lue. Avec session : adresse du compte connecte (la donnee de
 * l'appelant lui-meme, marquee L-8), rendue ici, cote serveur.
 */
import { AcceptInvitation } from "@/ui/forms/accept-invitation";
import { readPageSession } from "@/ui/session";
import { visibleText } from "@/ui/visible-text";

export default async function AcceptInvitationPage() {
  const session = await readPageSession();
  return (
    <>
      <h1>Invitation</h1>
      {session !== null ? (
        <p>
          Compte connecte : <strong>{visibleText(session.email)}</strong>
        </p>
      ) : (
        <p>Connectez-vous ou creez un compte pour accepter l&apos;invitation.</p>
      )}
      <AcceptInvitation signedIn={session !== null} />
    </>
  );
}
