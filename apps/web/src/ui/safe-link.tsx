/**
 * Lien sur (tranche 012, AC10). Une URL enregistree n'est rendue comme lien que
 * si elle est relisible (`URL.canParse`) et que son schema RELU, apres
 * normalisation par `URL`, est `http:` ou `https:`. Le `href` est la forme
 * normalisee (`new URL(url).href`, non ASCII encode en `%XX`), le nom d'hote
 * celui de `URL` (punycode pour un hote IDN). Sinon : texte seul, sans `href`.
 *
 * Fonction pure sans JSX : le rendu de la ligne de lien est dans `link-list.tsx`.
 */

export type SafeLink = { kind: "link"; href: string; hostname: string } | { kind: "text" };

export function safeLink(url: string): SafeLink {
  if (!URL.canParse(url)) return { kind: "text" };
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { kind: "text" };
  if (parsed.hostname.length === 0) return { kind: "text" };
  return { kind: "link", href: parsed.href, hostname: parsed.hostname };
}
