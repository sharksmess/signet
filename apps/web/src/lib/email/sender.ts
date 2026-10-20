/**
 * Expediteur d'e-mails (tranche 003, D-083, D-087, ADR-0017).
 *
 * Resolution par l'environnement, au premier usage :
 * - `EMAIL_CAPTURE_URL` posee (acceptee seulement avec `APP_ENV=test`, garde de
 *   `env.ts`) : expediteur HTTP vers la fausse messagerie des tests ;
 * - sinon : expediteur « non configure ». Aucun fournisseur reel n'existe
 *   encore (backlog) : son premier envoi leve `EmailProviderNotConfiguredError`
 *   (invariant de deploiement), que la fonction d'envoi traduit en erreur non
 *   rejouable. Aucun chemin ne rend un succes sans fournisseur.
 *
 * Protocole de l'expediteur HTTP (celui de `tests/invitations/fakes/fake-mailbox.ts`) :
 * `POST <EMAIL_CAPTURE_URL>`, en-tete `Idempotency-Key`, corps JSON
 * `{ to, subject, text }` (texte brut, jamais de HTML), succes = tout 2xx. La
 * requete est bornee par `SEND_TIMEOUT_MS` : une messagerie muette produit une
 * erreur rejouable, jamais une suspension.
 *
 * Les messages d'erreur ne citent ni le destinataire, ni le contenu, ni l'URL.
 * Module sans acces a la base (AC15).
 */
import { getServerEnv } from "../env";

/** Delai d'attente d'un envoi (exigence de la tranche : au plus 10 s). */
export const SEND_TIMEOUT_MS = 8_000;

export interface EmailMessage {
  to: string;
  subject: string;
  /** Texte brut. */
  text: string;
}

export interface EmailSender {
  /**
   * Remet le message au fournisseur. `idempotencyKey` est transmise telle
   * quelle : un fournisseur qui la respecte ne remet pas deux fois le meme
   * message. Leve une `EmailSendError` (rejouable) si le fournisseur refuse,
   * ne repond pas, ou si la reponse est perdue.
   */
  send(message: EmailMessage, idempotencyKey: string): Promise<void>;
}

export const EMAIL_PROVIDER_NOT_CONFIGURED = "EMAIL_PROVIDER_NOT_CONFIGURED";

/** Aucun fournisseur configure : invariant de deploiement, jamais rejouable. */
export class EmailProviderNotConfiguredError extends Error {
  constructor() {
    super(`${EMAIL_PROVIDER_NOT_CONFIGURED} : aucun fournisseur d'e-mails n'est configure.`);
    this.name = "EmailProviderNotConfiguredError";
  }
}

/** Echec d'un envoi qui peut reussir plus tard (fournisseur en erreur, muet, reponse perdue). */
export class EmailSendError extends Error {
  constructor(reason: string) {
    super(`envoi d'e-mail en echec : ${reason}`);
    this.name = "EmailSendError";
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "inconnue";
}

function httpCaptureSender(url: string): EmailSender {
  return {
    async send(message, idempotencyKey) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({ to: message.to, subject: message.subject, text: message.text }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
      } catch (error) {
        throw new EmailSendError(`fournisseur injoignable ou muet (${errorName(error)})`);
      }
      // Corps de la reponse ignore : il n'apporte rien et ne doit pas finir dans un journal.
      await response.body?.cancel().catch(() => undefined);
      if (!response.ok) throw new EmailSendError(`statut HTTP ${response.status}`);
    },
  };
}

const notConfiguredSender: EmailSender = {
  send() {
    return Promise.reject(new EmailProviderNotConfiguredError());
  },
};

/** Expediteur resolu depuis l'environnement valide du serveur (au premier usage, D-079). */
export function getEmailSender(): EmailSender {
  const url = getServerEnv().EMAIL_CAPTURE_URL;
  return url === undefined ? notConfiguredSender : httpCaptureSender(url);
}
