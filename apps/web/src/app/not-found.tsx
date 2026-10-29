/**
 * Page introuvable unique (tranche 012, AC6, AC7, L-7) : texte fixe, sans
 * aucune valeur libre ni identifiant. Organisation d'autrui, inexistante ou
 * identifiant malforme : meme page.
 */
import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <h1>Page introuvable</h1>
      <p>Cette page n&apos;existe pas, ou vous n&apos;y avez pas acces.</p>
      <p>
        <Link href="/organisations">Mes organisations</Link>
      </p>
    </>
  );
}
