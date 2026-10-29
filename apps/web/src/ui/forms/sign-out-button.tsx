"use client";
/**
 * Bouton « Se deconnecter » (L-9, better-auth `sign-out`). `after` : navigation
 * vers `/connexion` (pages privees), ou relecture de la page sans changer
 * d'adresse (page d'acceptation : changer de compte en gardant le fragment).
 */
import { useRouter } from "next/navigation";
import { MESSAGES } from "../messages";
import { buildSignOutRequest, isSuccess, sendRequest } from "../requests";
import { FormMessage } from "./form-message";
import { browserFetch, useSubmit } from "./use-submit";

export function SignOutButton(props: { after: "connexion" | "refresh" }) {
  const router = useRouter();
  const submission = useSubmit();

  function onClick(): void {
    void submission.run(async () => {
      const result = await sendRequest(browserFetch, buildSignOutRequest());
      if (!isSuccess(result.status)) {
        submission.setMessage(MESSAGES.generic);
        return;
      }
      if (props.after === "connexion") router.push("/connexion");
      else router.refresh();
    });
  }

  return (
    <div className="sign-out">
      <button type="button" onClick={onClick} disabled={submission.pending}>
        Se deconnecter
      </button>
      <FormMessage message={submission.message} />
    </div>
  );
}
