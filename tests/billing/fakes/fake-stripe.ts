/**
 * Faux Stripe de la tranche 002 (D-059) : un serveur `node:http` demarre par les
 * fichiers de test sur un port fixe, auquel le serveur Next de test est raccorde
 * par STRIPE_API_BASE_URL. Il enregistre chaque requete recue (methode, chemin,
 * corps brut, formulaire decode) et repond selon des regles programmees par
 * chaque test, y compris une erreur 500 ou un delai (AC10).
 *
 * Aucun appel reseau reel : le port est local, aucune cle reelle n'est utilisee.
 * Le SDK Stripe encode ses corps en `application/x-www-form-urlencoded` avec la
 * notation a crochets (`line_items[0][price]`) : `form` expose ces cles telles
 * quelles, les assertions des tests les citent a l'identique.
 */
import http from "node:http";

export interface RecordedStripeRequest {
  method: string;
  /** Chemin sans query string, ex. `/v1/subscriptions/sub_123`. */
  path: string;
  query: Record<string, string>;
  headers: http.IncomingHttpHeaders;
  rawBody: string;
  /** Corps decode comme un formulaire ; vide si le corps n'en est pas un. */
  form: Record<string, string>;
}

export interface StripeReply {
  status?: number;
  body?: unknown;
  /** Delai avant de repondre. Une valeur tres grande simule un Stripe qui ne repond pas. */
  delayMs?: number;
}

export type StripeReplyOrFn = StripeReply | ((request: RecordedStripeRequest) => StripeReply);

interface Rule {
  method: string;
  path: string | RegExp;
  reply: StripeReplyOrFn;
}

function pathMatches(pattern: string | RegExp, path: string): boolean {
  return typeof pattern === "string" ? pattern === path : pattern.test(path);
}

export class FakeStripe {
  readonly requests: RecordedStripeRequest[] = [];
  private rules: Rule[] = [];
  private readonly timers = new Set<NodeJS.Timeout>();

  private constructor(private readonly server: http.Server) {}

  static async start(port: number): Promise<FakeStripe> {
    const holder: { fake?: FakeStripe } = {};
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => holder.fake?.handle(req, res, Buffer.concat(chunks).toString("utf8")));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", (error: NodeJS.ErrnoException) => {
        reject(
          new Error(
            `[fake-stripe] impossible d'ecouter sur le port ${port} (${error.code ?? "?"} : ${error.message}). ` +
              `Un autre processus l'occupe peut-etre ; fileParallelism est desactive, le port est cense etre libre.`,
          ),
        );
      });
      server.listen(port, resolve);
    });
    const fake = new FakeStripe(server);
    holder.fake = fake;
    return fake;
  }

  /** Programme une reponse. La regle la plus recente l'emporte sur les precedentes. */
  on(method: string, path: string | RegExp, reply: StripeReplyOrFn): void {
    this.rules.unshift({ method: method.toUpperCase(), path, reply });
  }

  /** Oublie les requetes enregistrees et les reponses programmees (a appeler avant chaque test). */
  reset(): void {
    this.requests.length = 0;
    this.rules = [];
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.server.closeAllConnections();
  }

  requestsTo(method: string, path: string | RegExp): RecordedStripeRequest[] {
    return this.requests.filter((r) => r.method === method.toUpperCase() && pathMatches(path, r.path));
  }

  async stop(): Promise<void> {
    this.reset();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse, rawBody: string): void {
    const url = new URL(req.url ?? "/", "http://fake-stripe.invalid");
    const recorded: RecordedStripeRequest = {
      method: (req.method ?? "GET").toUpperCase(),
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: req.headers,
      rawBody,
      form: Object.fromEntries(new URLSearchParams(rawBody).entries()),
    };
    this.requests.push(recorded);

    const rule = this.rules.find((r) => r.method === recorded.method && pathMatches(r.path, recorded.path));
    const reply: StripeReply = rule
      ? typeof rule.reply === "function"
        ? rule.reply(recorded)
        : rule.reply
      : {
          status: 404,
          body: {
            error: {
              type: "invalid_request_error",
              message: `[fake-stripe] aucune reponse programmee pour ${recorded.method} ${recorded.path}`,
            },
          },
        };

    const send = (): void => {
      if (res.writableEnded || res.destroyed) return;
      res.statusCode = reply.status ?? 200;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Request-Id", "req_fake_stripe");
      res.end(JSON.stringify(reply.body ?? {}));
    };
    if (reply.delayMs && reply.delayMs > 0) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        send();
      }, reply.delayMs);
      this.timers.add(timer);
    } else {
      send();
    }
  }
}
