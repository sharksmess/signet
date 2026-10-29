"use client";
/**
 * Formulaire d'invitation (`POST .../invitations`), rendu par la page
 * d'organisation pour l'owner SEULEMENT (role lu cote serveur dans
 * `listMembers`). Props : le seul identifiant de l'organisation.
 */
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { chooseMessage, MESSAGES } from "../messages";
import { buildInviteRequest, isSuccess, sendRequest } from "../requests";
import { FormMessage } from "./form-message";
import { browserFetch, fieldOf, useSubmit } from "./use-submit";

export function InviteForm(props: { organizationId: string }) {
  const router = useRouter();
  const submission = useSubmit();

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = event.currentTarget;
    void submission.run(async () => {
      const result = await sendRequest(browserFetch, buildInviteRequest(props.organizationId, { email: fieldOf(form, "email") }));
      if (!isSuccess(result.status)) {
        submission.fail(chooseMessage("invite", result.status, result.body), result.status, result.body);
        return;
      }
      form.reset();
      submission.setMessage(MESSAGES.invitationSent);
      router.refresh();
    });
  }

  return (
    <form data-testid="invite-form" onSubmit={onSubmit}>
      <h2>Inviter</h2>
      <label>
        Adresse e-mail
        <input type="email" name="email" required />
      </label>
      <button type="submit" disabled={submission.pending}>
        Inviter
      </button>
      <FormMessage message={submission.message} offerSignIn />
    </form>
  );
}
