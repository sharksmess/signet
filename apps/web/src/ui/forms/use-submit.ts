/**
 * Etat commun des formulaires clients (tranche 012) : un seul envoi a la fois
 * (bouton desactive pendant l'envoi, garde synchrone contre le double clic),
 * message affiche choisi dans la liste fermee de `messages.ts`.
 *
 * Importe uniquement par des composants clients.
 */
import { useCallback, useRef, useState } from "react";
import type { FetchLike } from "../requests";

/** `fetch` du navigateur, meme origine, cookie envoye par defaut ; lie a `window` (sinon « Illegal invocation »). */
export const browserFetch: FetchLike = (input, init) => window.fetch(input, init);

export interface Submission {
  pending: boolean;
  /** Texte de la liste fermee, ou `null`. */
  message: string | null;
  /** Statut du dernier refus (suites apres erreur), ou `null`. */
  failedStatus: number | null;
  /** Code du dernier refus (suites apres erreur), ou `null`. */
  failedCode: string | null;
  setMessage: (message: string | null) => void;
  /** Execute `task` si aucun envoi n'est en cours ; sinon ne fait rien. */
  run: (task: () => Promise<void>) => Promise<void>;
  fail: (message: string, status: number, body: unknown) => void;
}

function codeOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("code" in body)) return null;
  return typeof body.code === "string" ? body.code : null;
}

export function useSubmit(): Submission {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failedStatus, setFailedStatus] = useState<number | null>(null);
  const [failedCode, setFailedCode] = useState<string | null>(null);

  const run = useCallback(async (task: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setMessage(null);
    setFailedStatus(null);
    setFailedCode(null);
    try {
      await task();
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, []);

  const fail = useCallback((text: string, status: number, body: unknown) => {
    setMessage(text);
    setFailedStatus(status);
    setFailedCode(codeOf(body));
  }, []);

  return { pending, message, failedStatus, failedCode, setMessage, run, fail };
}

/** Valeur textuelle d'un champ de formulaire ; absente ou fichier : chaine vide. */
export function fieldOf(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name);
  return typeof value === "string" ? value : "";
}
