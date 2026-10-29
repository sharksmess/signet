"use client";
/**
 * Formulaire d'inscription (better-auth `sign-up/email`, `name` = adresse).
 *
 * `withOrganization` (page `/inscription`, D-144 Q-1) : adresse, mot de passe,
 * nom de l'organisation ; inscription puis UNE SEULE creation d'organisation
 * (`signUpWithOrganization`) ; succes : page de l'organisation ; creation en
 * echec : `/organisations?creation=echec`, sans nouvelle tentative.
 *
 * Sans organisation (page d'acceptation) : adresse et mot de passe ; apres
 * succes, relecture de la page sans changer d'adresse (le fragment reste).
 */
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { chooseMessage } from "../messages";
import { buildSignUpRequest, isSuccess, sendRequest, signUpWithOrganization } from "../requests";
import { FormMessage } from "./form-message";
import { browserFetch, fieldOf, useSubmit } from "./use-submit";

export function SignUpForm(props: { withOrganization: boolean }) {
  const router = useRouter();
  const submission = useSubmit();

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = event.currentTarget;
    const email = fieldOf(form, "email");
    const password = fieldOf(form, "password");
    void submission.run(async () => {
      if (props.withOrganization) {
        const outcome = await signUpWithOrganization(browserFetch, { email, password, organizationName: fieldOf(form, "organizationName") });
        if (outcome.kind === "refused") {
          submission.setMessage(outcome.message);
          return;
        }
        router.push(outcome.destination);
        return;
      }
      const result = await sendRequest(browserFetch, buildSignUpRequest({ email, password }));
      if (!isSuccess(result.status)) {
        submission.fail(chooseMessage("sign-up", result.status, result.body), result.status, result.body);
        return;
      }
      router.refresh();
    });
  }

  return (
    <form data-testid="sign-up-form" onSubmit={onSubmit}>
      <h2>Creer un compte</h2>
      <label>
        Adresse e-mail
        <input type="email" name="email" autoComplete="email" required />
      </label>
      <label>
        Mot de passe (8 caracteres minimum)
        <input type="password" name="password" autoComplete="new-password" required />
      </label>
      {props.withOrganization ? (
        <label>
          Nom de l&apos;organisation
          <input type="text" name="organizationName" required />
        </label>
      ) : null}
      <button type="submit" disabled={submission.pending}>
        Creer le compte
      </button>
      <FormMessage message={submission.message} />
    </form>
  );
}
