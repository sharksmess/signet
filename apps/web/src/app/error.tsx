"use client";
/**
 * Page d'erreur generique (tranche 012) : erreur inattendue d'une lecture
 * (`throw` des fonctions de `lib/`). Texte fixe, aucun detail de l'erreur.
 */
import { MESSAGES } from "@/ui/messages";

export default function ErrorPage() {
  return (
    <>
      <h1>Erreur</h1>
      <p role="alert">{MESSAGES.generic}</p>
    </>
  );
}
