/**
 * Ligne d'un lien de la page de collection (composant serveur, tranche 012,
 * AC8 a AC10, L-4, L-5).
 *
 * Toutes les valeurs libres sont passees par `visibleText` (marqueurs L-8) et
 * rendues en texte (React echappe). Le seul attribut qui porte une valeur
 * derivee d'une donnee est `href`, forme normalisee d'une URL http(s) relue
 * (`safeLink`) ; sinon l'URL est du texte seul. Nom d'hote affiche a part.
 */
import { formatUtc } from "./format";
import { safeLink } from "./safe-link";
import { visibleText } from "./visible-text";

export interface LinkRowProps {
  url: string;
  title: string;
  /** Adresse de l'auteur s'il est membre, sinon `null` (« ancien membre »). */
  authorEmail: string | null;
  /** ISO 8601 UTC. */
  createdAt: string;
}

export function LinkRow(props: LinkRowProps) {
  const link = safeLink(props.url);
  const urlText = visibleText(props.url);
  return (
    <li data-testid="link-row">
      <p>
        <strong data-testid="link-title">{visibleText(props.title)}</strong>
        {link.kind === "link" ? (
          <>
            {" "}
            (<span data-testid="link-hostname">{link.hostname}</span>)
          </>
        ) : null}
      </p>
      <p>
        {link.kind === "link" ? (
          <a href={link.href} target="_blank" rel="noopener noreferrer">
            {urlText}
          </a>
        ) : (
          <span>{urlText}</span>
        )}
      </p>
      <p>
        Ajoute par <span data-testid="link-author">{props.authorEmail === null ? "ancien membre" : visibleText(props.authorEmail)}</span>, le{" "}
        <span data-testid="link-date">{formatUtc(props.createdAt)}</span>
      </p>
    </li>
  );
}
