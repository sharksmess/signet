/**
 * Date d'affichage (tranche 012, L-5) : UTC, format fixe `AAAA-MM-JJ HH:MM UTC`,
 * calculee cote serveur depuis l'horodatage ISO 8601 rendu par les lectures.
 * Un horodatage illisible ne peut pas arriver (les lectures rendent
 * `toISOString()`) : invariant, `throw`.
 */
export function formatUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error("horodatage illisible dans une lecture");
  const text = date.toISOString();
  return `${text.slice(0, 10)} ${text.slice(11, 16)} UTC`;
}
