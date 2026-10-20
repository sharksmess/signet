/**
 * Parcours d'arrangement de la tranche 003 : une invitation reellement emise par
 * la route (owner d'une organisation reelle), avec l'evenement capture par le
 * faux Inngest. Sert aux tests d'envoi, qui partent d'un evenement authentique.
 */
import { randomUUID } from "node:crypto";
import type { CapturedInngestEvent } from "../billing/fakes/fake-inngest";
import { expectStatus, type HttpResult } from "./billing";
import { createOrganizationFixture, type OrganizationFixture } from "./fixtures";
import {
  inviteeEmail,
  postInvitation,
  singleInvitationEvent,
  type InvitationFakes,
} from "./invitations";
import { readSingleInvitation, type InvitationRow } from "./invitations-db";

export interface EmittedInvitation {
  org: OrganizationFixture;
  email: string;
  invitationId: string;
  event: CapturedInngestEvent;
  row: InvitationRow;
  response: HttpResult;
}

export async function emitInvitation(
  fakes: InvitationFakes,
  options?: { org?: OrganizationFixture; email?: string; label?: string },
): Promise<EmittedInvitation> {
  const org = options?.org ?? (await createOrganizationFixture(`Org ${options?.label ?? "envoi"} ${randomUUID().slice(0, 8)}`));
  const email = options?.email ?? inviteeEmail();
  const response = await postInvitation(org.owner, org.organizationId, { email });
  expectStatus(response, 201, `POST invitation (${options?.label ?? "arrangement"})`);
  const invitationId = (response.body as { id?: string } | undefined)?.id;
  if (!invitationId) throw new Error(`POST invitation : reponse 201 sans champ "id". Corps brut : ${response.text}`);
  const event = singleInvitationEvent(fakes.inngest, invitationId);
  const row = await readSingleInvitation(org.organizationId, email);
  return { org, email, invitationId, event, row, response };
}
