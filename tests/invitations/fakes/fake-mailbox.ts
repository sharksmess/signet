/**
 * Fausse messagerie de la tranche 003 (D-083, D-087) : un serveur `node:http`
 * demarre par les fichiers de test sur un port fixe (`fileParallelism: false`),
 * auquel l'expediteur de production est raccorde par `EMAIL_CAPTURE_URL`.
 *
 * PROTOCOLE (le contrat de la tranche ne le fixe pas ; choix du test-writer,
 * a reprendre tel quel par l'expediteur de production) :
 *   POST <EMAIL_CAPTURE_URL>            (n'importe quel chemin)
 *   Idempotency-Key: <identifiant de l'invitation>
 *   Content-Type: application/json
 *   { "to": "<adresse>", "subject": "<sujet>", "text": "<texte brut>" }
 * Reponse attendue en cas de succes : tout statut 2xx.
 *
 * Le faux est tolerant sur les NOMS de champs (`to` | `recipient` | `email`,
 * `text` | `body`, `Idempotency-Key` en en-tete ou `idempotencyKey` dans le
 * corps) : l'implementation n'est pas piegee par une orthographe. Un corps qui
 * n'est pas du JSON est refuse (400) et conserve dans `rejected` pour que le
 * message d'echec dise ce qui a ete recu.
 *
 * Modes : ok (200, enregistre), fail (500, n'enregistre pas), hang (ne repond
 * jamais, n'enregistre pas), lose-response (enregistre puis coupe la connexion
 * sans repondre : « la messagerie a accepte mais la reponse est perdue », AC4 d).
 *
 * Aucun appel reseau reel : le port est local.
 */
import http from "node:http";

export interface CapturedMail {
  to: string | undefined;
  subject: string | undefined;
  text: string | undefined;
  idempotencyKey: string | undefined;
  /** Corps JSON complet tel que recu (pour verifier l'absence de champ html, de secret, etc.). */
  body: Record<string, unknown>;
  rawBody: string;
}

export type MailboxMode = "ok" | "fail" | "hang" | "lose-response";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  }
  return undefined;
}

export class FakeMailbox {
  /** Messages acceptes (mode ok ou lose-response). */
  readonly messages: CapturedMail[] = [];
  /** Corps non JSON recus, pour les messages d'echec. */
  readonly rejected: string[] = [];
  /** Nombre de requetes POST recues, quel que soit le mode. */
  attempts = 0;
  private mode: MailboxMode = "ok";

  private constructor(private readonly server: http.Server) {}

  static async start(port: number): Promise<FakeMailbox> {
    const holder: { fake?: FakeMailbox } = {};
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => holder.fake?.handle(req, res, Buffer.concat(chunks).toString("utf8")));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", (error: NodeJS.ErrnoException) => {
        reject(
          new Error(`[fake-mailbox] impossible d'ecouter sur le port ${port} (${error.code ?? "?"} : ${error.message}).`),
        );
      });
      server.listen(port, resolve);
    });
    const fake = new FakeMailbox(server);
    holder.fake = fake;
    return fake;
  }

  succeed(): void {
    this.mode = "ok";
  }

  failWith500(): void {
    this.mode = "fail";
  }

  hang(): void {
    this.mode = "hang";
  }

  loseResponse(): void {
    this.mode = "lose-response";
  }

  reset(): void {
    this.messages.length = 0;
    this.rejected.length = 0;
    this.attempts = 0;
    this.mode = "ok";
    this.server.closeAllConnections();
  }

  /** Messages adresses a `address` (comparaison exacte : les tests utilisent des adresses uniques). */
  messagesTo(address: string): CapturedMail[] {
    return this.messages.filter((m) => m.to === address);
  }

  /** Messages dont le corps brut contient `needle`. */
  messagesMentioning(needle: string): CapturedMail[] {
    return this.messages.filter((m) => m.rawBody.includes(needle));
  }

  async stop(): Promise<void> {
    this.reset();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse, rawBody: string): void {
    if (req.method !== "POST") {
      res.statusCode = 200;
      res.end("{}");
      return;
    }
    this.attempts += 1;
    if (this.mode === "hang") return;
    if (this.mode === "fail") {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "fake-mailbox : echec programme" }));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      this.rejected.push(rawBody);
      res.statusCode = 400;
      res.end(`[fake-mailbox] corps non JSON : ${rawBody.slice(0, 200)}`);
      return;
    }
    const body = isRecord(parsed) ? parsed : {};
    const header = req.headers["idempotency-key"];
    this.messages.push({
      to: firstString(body.to, body.recipient, body.email),
      subject: firstString(body.subject),
      text: firstString(body.text, body.body),
      idempotencyKey: firstString(header, body.idempotencyKey, body.idempotency_key),
      body,
      rawBody,
    });
    if (this.mode === "lose-response") {
      req.socket.destroy();
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ id: `mail_${this.messages.length}` }));
  }
}
