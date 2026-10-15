/**
 * Point de service Inngest (ADR-0006, ADR-0016, AC15).
 *
 * Hors mode developpement, le SDK verifie la signature de chaque appel avec
 * `INNGEST_SIGNING_KEY` (exigee par `env.ts`) : un appel non signe ou mal signe
 * recoit 401 et n'execute rien. Le mode developpement n'est possible qu'avec
 * `APP_ENV=test` ou `development` (garde dans `env.ts`).
 *
 * Les gestionnaires du SDK sont enveloppes dans la signature standard d'un
 * Route Handler (`(request) => Response`) : celle du SDK exige un second
 * argument que Next ne fournit pas sous cette forme.
 *
 * Imports relatifs : ce module est charge par la suite de tests hors de Next.
 */
import { NextRequest } from "next/server";
import { serve } from "inngest/next";
import { inngest } from "../../../lib/inngest/client";
import { processStripeEvent } from "../../../lib/inngest/process-stripe-event";

const handler = serve({ client: inngest, functions: [processStripeEvent] });

function asNextRequest(request: Request): NextRequest {
  return request instanceof NextRequest ? request : new NextRequest(request);
}

export function GET(request: Request): Promise<Response> {
  return handler.GET(asNextRequest(request), undefined);
}

export function POST(request: Request): Promise<Response> {
  return handler.POST(asNextRequest(request), undefined);
}

export function PUT(request: Request): Promise<Response> {
  return handler.PUT(asNextRequest(request), undefined);
}
