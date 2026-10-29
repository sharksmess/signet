"use client";
/**
 * Formulaire « Nouvelle collection » (`POST .../collections`). Props : le seul
 * identifiant de l'organisation (lu cote serveur). Succes : champ vide, puis
 * relecture serveur de la page (`router.refresh()`, L-3).
 */
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { chooseMessage } from "../messages";
import { buildCreateCollectionRequest, isSuccess, sendRequest } from "../requests";
import { FormMessage } from "./form-message";
import { browserFetch, fieldOf, useSubmit } from "./use-submit";

export function CreateCollectionForm(props: { organizationId: string }) {
  const router = useRouter();
  const submission = useSubmit();

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = event.currentTarget;
    void submission.run(async () => {
      const result = await sendRequest(browserFetch, buildCreateCollectionRequest(props.organizationId, { name: fieldOf(form, "name") }));
      if (!isSuccess(result.status)) {
        submission.fail(chooseMessage("create-collection", result.status, result.body), result.status, result.body);
        return;
      }
      form.reset();
      router.refresh();
    });
  }

  return (
    <form data-testid="create-collection-form" onSubmit={onSubmit}>
      <h2>Nouvelle collection</h2>
      <label>
        Nom
        <input type="text" name="name" required />
      </label>
      <button type="submit" disabled={submission.pending}>
        Creer la collection
      </button>
      <FormMessage message={submission.message} offerSignIn />
    </form>
  );
}
