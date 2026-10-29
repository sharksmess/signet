"use client";
/**
 * Formulaire « Nouvelle organisation » (`POST /api/organizations`). Succes :
 * navigation vers la page de l'organisation creee (L-3), identifiant verifie
 * (forme UUID) avant d'entrer dans l'adresse.
 */
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { chooseMessage, MESSAGES } from "../messages";
import { buildCreateOrganizationRequest, createdIdOf, isSuccess, sendRequest } from "../requests";
import { FormMessage } from "./form-message";
import { browserFetch, fieldOf, useSubmit } from "./use-submit";

export function CreateOrganizationForm() {
  const router = useRouter();
  const submission = useSubmit();

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = event.currentTarget;
    void submission.run(async () => {
      const result = await sendRequest(browserFetch, buildCreateOrganizationRequest({ name: fieldOf(form, "name") }));
      if (!isSuccess(result.status)) {
        submission.fail(chooseMessage("create-organization", result.status, result.body), result.status, result.body);
        return;
      }
      const id = createdIdOf(result.body);
      if (id === null) {
        submission.setMessage(MESSAGES.generic);
        return;
      }
      router.push(`/organisations/${id}`);
    });
  }

  return (
    <form data-testid="create-organization-form" onSubmit={onSubmit}>
      <h2>Nouvelle organisation</h2>
      <label>
        Nom
        <input type="text" name="name" required />
      </label>
      <button type="submit" disabled={submission.pending}>
        Creer l&apos;organisation
      </button>
      <FormMessage message={submission.message} offerSignIn />
    </form>
  );
}
