/**
 * Texte visible (tranche 012, L-8, D-144) : les caracteres invisibles ou
 * bidirectionnels d'une liste FERMEE sont remplaces par un marqueur visible
 * `[U+` suivi de 4 chiffres hexadecimaux majuscules puis `]` (ex. `[U+202E]`).
 *
 * Liste : controles bidirectionnels U+202A a U+202E, U+2066 a U+2069, U+200E,
 * U+200F, U+061C ; largeur nulle U+200B, U+2060, U+FEFF. U+200D n'est PAS
 * marque : il compose les emojis. Les autres caracteres de controle encore
 * acceptes par les contrats sont rendus tels quels par React (L-11).
 *
 * Fonction pure, appliquee cote serveur avant de transmettre un texte libre aux
 * composants (donnees embarquees de Next comprises). La valeur enregistree
 * n'est jamais modifiee.
 */

const MARKED = /[‪-‮⁦-⁩‎‏؜​⁠﻿]/g;

function markerOf(character: string): string {
  const codePoint = character.codePointAt(0) ?? 0;
  return `[U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}]`;
}

export function visibleText(value: string): string {
  return value.replace(MARKED, markerOf);
}
