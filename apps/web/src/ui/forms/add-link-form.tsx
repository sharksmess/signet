"use client";
/**
 * Formulaire « Ajouter un lien » (`POST .../links`). Props : les seuls
 * identifiants de l'organisation et de la collection. Succes : champs vides,
 * puis relecture serveur de la page (L-3).
 */
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { chooseMessage } from "../messages";
import { buildAddLinkRequest, isSuccess, sendRequest } from "../requests";
import { FormMessage } from "./form-message";
import { browserFetch, fieldOf, useSubmit } from "./use-submit";

export function AddLinkForm(props: { organizationId: string; collectionId: string }) {
  const router = useRouter();
  const submission = useSubmit();

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = event.currentTarget;
    void submission.run(async () => {
      const result = await sendRequest(
        browserFetch,
        buildAddLinkRequest(props.organizationId, props.collectionId, { url: fieldOf(form, "url"), title: fieldOf(form, "title") }),
      );
      if (!isSuccess(result.status)) {
        submission.fail(chooseMessage("add-link", result.status, result.body), result.status, result.body);
        return;
      }
      form.reset();
      router.refresh();
    });
  }

  return (
    <form data-testid="add-link-form" onSubmit={onSubmit}>
      <h2>Ajouter un lien</h2>
      <label>
        URL
        <input type="url" name="url" required />
      </label>
      <label>
        Titre
        <input type="text" name="title" required />
      </label>
      <button type="submit" disabled={submission.pending}>
        Ajouter le lien
      </button>
      <FormMessage message={submission.message} offerSignIn />
    </form>
  );
}
