"use client";
/**
 * Formulaire de connexion (better-auth `sign-in/email`). `after` : apres succes,
 * navigation vers `/organisations` (page `/connexion`), ou relecture de la page
 * sans changer d'adresse (page d'acceptation : le fragment reste en place).
 */
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { chooseMessage } from "../messages";
import { buildSignInRequest, isSuccess, sendRequest } from "../requests";
import { FormMessage } from "./form-message";
import { browserFetch, fieldOf, useSubmit } from "./use-submit";

export function SignInForm(props: { after: "organisations" | "refresh" }) {
  const router = useRouter();
  const submission = useSubmit();

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = event.currentTarget;
    void submission.run(async () => {
      const result = await sendRequest(browserFetch, buildSignInRequest({ email: fieldOf(form, "email"), password: fieldOf(form, "password") }));
      if (!isSuccess(result.status)) {
        submission.fail(chooseMessage("sign-in", result.status, result.body), result.status, result.body);
        return;
      }
      if (props.after === "organisations") router.push("/organisations");
      else router.refresh();
    });
  }

  return (
    <form data-testid="sign-in-form" onSubmit={onSubmit}>
      <h2>Se connecter</h2>
      <label>
        Adresse e-mail
        <input type="email" name="email" autoComplete="email" required />
      </label>
      <label>
        Mot de passe
        <input type="password" name="password" autoComplete="current-password" required />
      </label>
      <button type="submit" disabled={submission.pending}>
        Se connecter
      </button>
      <FormMessage message={submission.message} />
    </form>
  );
}
