/**
 * Faux point d'entree d'evenements Inngest de la tranche 002 (D-059).
 *
 * Le serveur de test tourne en mode developpement d'Inngest (INNGEST_DEV =
 * URL de ce faux) : le SDK y poste ses evenements en `POST /e/<cle>` avec un
 * corps JSON (un evenement ou un tableau). Le faux les enregistre, ou echoue sur
 * demande (AC14) : reponse 500, ou aucune reponse.
 *
 * Il n'execute rien : la fonction Inngest est executee dans le processus de
 * test par @inngest/test, avec un evenement capture ici.
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";

export interface CapturedInngestEvent {
  id?: string;
  name: string;
  data: Record<string, unknown>;
  ts?: number;
}

export type InngestMode = "ok" | "fail" | "hang";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toEvent(value: unknown): CapturedInngestEvent | undefined {
  if (!isRecord(value) || typeof value.name !== "string") return undefined;
  return {
    id: typeof value.id === "string" ? value.id : undefined,
    name: value.name,
    data: isRecord(value.data) ? value.data : {},
    ts: typeof value.ts === "number" ? value.ts : undefined,
  };
}

export class FakeInngest {
  readonly events: CapturedInngestEvent[] = [];
  /** Corps bruts recus sur le point d'entree d'evenements, pour les messages d'echec. */
  readonly rawBodies: string[] = [];
  private mode: InngestMode = "ok";
  private failStatus = 500;
  private failBody: unknown = { error: "fake-inngest : echec programme" };

  private constructor(private readonly server: http.Server) {}

  static async start(port: number): Promise<FakeInngest> {
    const holder: { fake?: FakeInngest } = {};
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks);
        const body = req.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw;
        holder.fake?.handle(req, res, body.toString("utf8"));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", (error: NodeJS.ErrnoException) => {
        reject(
          new Error(
            `[fake-inngest] impossible d'ecouter sur le port ${port} (${error.code ?? "?"} : ${error.message}).`,
          ),
        );
      });
      server.listen(port, resolve);
    });
    const fake = new FakeInngest(server);
    holder.fake = fake;
    return fake;
  }

  /** Repond 200 et enregistre (etat par defaut). */
  succeed(): void {
    this.mode = "ok";
  }

  /** Repond en echec (500 par defaut) a toute transmission d'evenement. Le corps contient un marqueur a ne jamais retrouver cote client. */
  failWith(status = 500, body: unknown = this.failBody): void {
    this.mode = "fail";
    this.failStatus = status;
    this.failBody = body;
  }

  /** Ne repond jamais (jusqu'a `reset()` / `stop()`). */
  hang(): void {
    this.mode = "hang";
  }

  reset(): void {
    this.events.length = 0;
    this.rawBodies.length = 0;
    this.mode = "ok";
    this.failStatus = 500;
    this.failBody = { error: "fake-inngest : echec programme" };
    this.server.closeAllConnections();
  }

  /** Evenements enregistres dont la representation JSON contient `needle` (ex. l'id d'un evenement Stripe). */
  eventsMentioning(needle: string): CapturedInngestEvent[] {
    return this.events.filter((e) => JSON.stringify(e).includes(needle));
  }

  async stop(): Promise<void> {
    this.reset();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse, rawBody: string): void {
    const path = new URL(req.url ?? "/", "http://fake-inngest.invalid").pathname;
    const isEventPost = req.method === "POST" && path.startsWith("/e/");
    if (!isEventPost) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end("{}");
      return;
    }
    this.rawBodies.push(rawBody);
    if (this.mode === "hang") return;
    if (this.mode === "fail") {
      res.statusCode = this.failStatus;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(this.failBody));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      res.statusCode = 400;
      res.end(`[fake-inngest] corps non JSON : ${rawBody.slice(0, 200)}`);
      return;
    }
    const received = (Array.isArray(parsed) ? parsed : [parsed]).map(toEvent);
    const ids: string[] = [];
    for (const event of received) {
      if (!event) continue;
      this.events.push(event);
      ids.push(event.id ?? randomUUID());
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ids, status: 200 }));
  }
}
